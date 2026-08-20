const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { extractPage } = require("../page-extractor.js");

test("vendored Defuddle bundle exposes its browser constructor", () => {
  const context = {};
  context.self = context;
  const source = fs.readFileSync(
    path.join(__dirname, "..", "vendor", "defuddle", "defuddle.js"),
    "utf8",
  );
  vm.runInNewContext(source, context);
  assert.equal(typeof context.Defuddle, "function");
});

test("extractPage returns article text and heading offsets", () => {
  let defuddleOptions = null;
  const title = { tagName: "H1", textContent: "記事タイトル" };
  const section = { tagName: "H2", textContent: "次の節" };
  const article = {
    querySelectorAll() {
      return [title, section];
    },
  };
  const rawText = "  記事タイトル\n本文です。\n次の節\n続きです。  ";
  const prefixes = new Map([
    [title, "  "],
    [section, "  記事タイトル\n本文です。\n"],
  ]);
  const document = {
    body: article,
    querySelector() {
      return article;
    },
    createRange() {
      let endElement = null;
      return {
        selectNodeContents() {},
        setEndBefore(element) {
          endElement = element;
        },
        toString() {
          return endElement ? prefixes.get(endElement) : rawText;
        },
      };
    },
    createElement() {
      return article;
    },
  };
  class FakeDefuddle {
    constructor(sourceDocument, options) {
      assert.equal(sourceDocument, document);
      defuddleOptions = options;
    }

    parse() {
      return { content: "<h1>記事タイトル</h1><p>本文です。</p><h2>次の節</h2><p>続きです。</p>" };
    }
  }

  assert.deepEqual(extractPage(document, FakeDefuddle), {
    text: "記事タイトル\n本文です。\n次の節\n続きです。",
    readingContext: {
      headings: [
        { text: "記事タイトル", level: 1 },
        { text: "次の節", level: 2 },
      ],
      sectionTransitions: [
        { offset: 0, headingIndex: 0 },
        { offset: 13, headingIndex: 1 },
      ],
      initialHeadingIndex: -1,
    },
  });
  assert.equal(defuddleOptions.useAsync, false);
  assert.equal(defuddleOptions.removeExactSelectors, true);
  assert.equal(defuddleOptions.removeLowScoring, true);
});

test("extractPage returns no content when the page body is unavailable", () => {
  assert.equal(extractPage({ querySelector() { return null; }, body: null }), null);
});

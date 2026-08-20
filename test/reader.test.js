const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const RsvpCore = require("../core.js");

class FakeElement {
  constructor(tagName, textContent = "") {
    this.tagName = tagName.toUpperCase();
    this.textContent = textContent;
    this.style = {};
    this.attributes = {};
    this.children = [];
    this.parent = null;
    this.clientWidth = 500;
    this.scrollWidth = 800;
  }

  append(...children) {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener() {}

  animate() {}

  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }

  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }
}

function findElement(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
}

test("reader shows the article outline beside the focal point", () => {
  const headingBeforeSelection = new FakeElement("h1", "記事タイトル");
  const headingInSelection = new FakeElement("h2", "次の節");
  const documentElement = new FakeElement("html");
  const document = {
    documentElement,
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    getElementById(id) {
      return findElement(documentElement, (element) => element.id === id);
    },
    querySelectorAll() {
      return [headingBeforeSelection, headingInSelection];
    },
  };
  let messageListener = null;
  const selection = {
    rangeCount: 1,
    isCollapsed: false,
    toString() {
      return "最初の節です。次の節です。";
    },
    getRangeAt() {
      return {
        comparePoint(element) {
          return element === headingBeforeSelection ? -1 : 0;
        },
        cloneRange() {
          let endElement = null;
          return {
            setEndBefore(element) {
              endElement = element;
            },
            toString() {
              return endElement === headingInSelection ? "最初の節です。" : "";
            },
          };
        },
      };
    },
  };
  const context = {
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          },
        },
      },
    },
    document,
    getSelection() {
      return selection;
    },
    matchMedia() {
      return { matches: false };
    },
    getComputedStyle() {
      return { fontSize: "64px" };
    },
    RsvpCore,
    Intl,
    console,
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
  };
  context.globalThis = context;
  const source = fs.readFileSync(path.join(__dirname, "..", "reader.js"), "utf8");
  assert.doesNotMatch(source, /#0a84ff/i);
  for (const match of source.matchAll(/rgba?\((\d+),(\d+),(\d+)/g)) {
    assert.equal(match[1], match[2]);
    assert.equal(match[2], match[3]);
  }
  vm.runInNewContext(source, context);

  const text = selection.toString();
  messageListener({ type: "PREPARE_RSVP", text, requestId: "request-1" });
  messageListener({ type: "START_RSVP", text, morphologyTokens: null, requestId: "request-1" });

  const overlay = document.getElementById("__rsvp-reader-root");
  const minimap = findElement(overlay, (element) => element.tagName === "ASIDE");
  const stage = findElement(overlay, (element) => element.style.display === "grid");
  const activeMarker = findElement(minimap, (element) => element.attributes["aria-current"] === "location");
  const outline = findElement(minimap, (element) => element.attributes["aria-label"] === "記事の構成");
  const display = findElement(
    overlay,
    (element) => element.style.whiteSpace === "nowrap" && element.style.justifyContent === "center",
  );

  assert.equal(stage.style.gridTemplateColumns, "280px minmax(0, 1fr)");
  assert.equal(stage.style.columnGap, "32px");
  assert.equal(stage.children[0], minimap);
  assert.equal(minimap.style.position, "relative");
  assert.equal(minimap.style.width, "100%");
  assert.equal(outline.children.length, 2);
  assert.equal(outline.children[0].textContent, "記事タイトル");
  assert.equal(outline.children[1].textContent, "次の節");
  assert.equal(outline.style.scrollbarWidth, "none");
  assert.match(source, /::-webkit-scrollbar/);
  assert.ok(activeMarker);
  assert.equal(activeMarker.style.boxShadow, "none");
  assert.equal(display.style.fontSize, "38.4px");

  selection.isCollapsed = true;
  const pageReadingContext = {
    headings: [
      { text: "ページタイトル", level: 1 },
      { text: "概要", level: 2 },
    ],
    sectionTransitions: [
      { offset: 0, headingIndex: 0 },
      { offset: 7, headingIndex: 1 },
    ],
    initialHeadingIndex: -1,
  };
  messageListener({
    type: "PREPARE_RSVP",
    text,
    requestId: "request-2",
    readingContext: pageReadingContext,
  });
  messageListener({ type: "START_RSVP", text, morphologyTokens: null, requestId: "request-2" });

  const pageOverlay = document.getElementById("__rsvp-reader-root");
  const pageOutline = findElement(
    pageOverlay,
    (element) => element.attributes["aria-label"] === "記事の構成",
  );
  assert.equal(pageOutline.children[0].textContent, "ページタイトル");
  assert.equal(pageOutline.children[1].style.paddingLeft, "19px");
});

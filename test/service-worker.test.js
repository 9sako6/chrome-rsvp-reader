const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("service worker registers selection and whole-page entry points", async () => {
  const listeners = {};
  let createdMenu = null;
  const scriptCalls = [];
  const messages = [];
  const readingContext = {
    headings: [{ text: "記事タイトル", level: 1 }],
    sectionTransitions: [{ offset: 0, headingIndex: 0 }],
    initialHeadingIndex: -1,
  };
  const chrome = {
    runtime: {
      onInstalled: {
        addListener(listener) {
          listeners.installed = listener;
        },
      },
    },
    action: {
      onClicked: {
        addListener(listener) {
          listeners.actionClicked = listener;
        },
      },
    },
    scripting: {
      async executeScript(options) {
        scriptCalls.push(options);
        if (options.func) return [{ result: { text: "記事本文", readingContext } }];
        return [];
      },
    },
    tabs: {
      async sendMessage(tabId, message) {
        messages.push({ tabId, message });
      },
    },
    contextMenus: {
      removeAll(callback) {
        callback();
      },
      create(menu) {
        createdMenu = menu;
      },
      onClicked: {
        addListener(listener) {
          listeners.clicked = listener;
        },
      },
    },
  };
  const source = fs.readFileSync(path.join(__dirname, "..", "service-worker.js"), "utf8");

  vm.runInNewContext(source, {
    chrome,
    console,
    WebAssembly,
    setTimeout,
    clearTimeout,
    kagome_ready: true,
    kagome_tokenize() {
      return [];
    },
  });

  assert.equal(typeof listeners.installed, "function");
  assert.equal(typeof listeners.clicked, "function");
  assert.equal(typeof listeners.actionClicked, "function");
  listeners.installed();
  assert.equal(createdMenu.id, "read-selection-rsvp");
  assert.equal(createdMenu.title, "RSVPで読む");
  assert.equal(createdMenu.contexts.join(","), "selection");

  await listeners.actionClicked({ id: 7 });
  assert.equal(
    scriptCalls[0].files.join(","),
    "vendor/defuddle/defuddle.js,page-extractor.js",
  );
  assert.equal(scriptCalls[2].files.join(","), "core.js,reader.js");
  assert.equal(messages[0].tabId, 7);
  assert.equal(messages[0].message.type, "PREPARE_RSVP");
  assert.equal(messages[0].message.readingContext.headings[0].text, "記事タイトル");
  assert.equal(messages[1].message.type, "START_RSVP");
});

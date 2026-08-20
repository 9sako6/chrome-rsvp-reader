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
    this.listeners = new Map();
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

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    event.target ||= this;
    for (const listener of this.listeners.get(event.type) || []) listener(event);
  }

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
  const documentListeners = new Map();
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
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) || [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    },
    removeEventListener(type, listener) {
      documentListeners.set(
        type,
        (documentListeners.get(type) || []).filter((candidate) => candidate !== listener),
      );
    },
    dispatchEvent(event) {
      for (const listener of documentListeners.get(event.type) || []) listener(event);
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
  let nextTimerId = 1;
  const timers = new Map();
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
    setTimeout(callback, delay) {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
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

  const playPauseButton = findElement(overlay, (element) => element.textContent === "一時停止");
  const backButton = findElement(overlay, (element) => element.textContent === "1文戻る");
  assert.equal(playPauseButton.style.width, "92px");
  assert.equal(backButton.style.width, "92px");

  let prevented = false;
  document.dispatchEvent({
    type: "keydown",
    code: "Space",
    target: documentElement,
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(playPauseButton.textContent, "再生");
  assert.equal(playPauseButton.style.width, "92px");

  document.dispatchEvent({
    type: "keydown",
    code: "Space",
    target: documentElement,
    preventDefault() {},
  });
  const firstTimer = [...timers.values()][0];
  timers.clear();
  firstTimer.callback();
  assert.match(display.textContent, /次の節/);
  document.dispatchEvent({
    type: "keydown",
    code: "ArrowLeft",
    target: documentElement,
    preventDefault() {},
  });
  assert.match(display.textContent, /最初の節/);

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

test("reader inserts a text-only fade break without an instruction label", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "reader.js"), "utf8");
  assert.doesNotMatch(source, /まばたき/);

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
      return [];
    },
    addEventListener() {},
    removeEventListener() {},
  };
  let messageListener = null;
  let nextTimerId = 1;
  const timers = new Map();
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
      return { rangeCount: 0, isCollapsed: true };
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
    setTimeout(callback, delay) {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  context.globalThis = context;
  vm.runInNewContext(source, context);

  const text = Array.from({ length: 30 }, (_, index) => `${index + 1}文目です。`).join("");
  messageListener({ type: "PREPARE_RSVP", text, requestId: "blink-request" });
  messageListener({ type: "START_RSVP", text, morphologyTokens: null, requestId: "blink-request" });

  const overlay = document.getElementById("__rsvp-reader-root");
  const display = findElement(
    overlay,
    (element) => element.style.whiteSpace === "nowrap" && element.style.justifyContent === "center",
  );
  for (let index = 0; index < 25; index += 1) {
    const [timerId, timer] = [...timers.entries()][0];
    timers.delete(timerId);
    timer.callback();
  }

  assert.equal(display.style.opacity, "0.12");
  assert.notEqual(display.textContent, "");
  const blinkTimer = [...timers.values()][0];
  assert.equal(blinkTimer.delay, 850);
  blinkTimer.callback();
  assert.equal(display.style.opacity, "1");
});

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_WORDS_PER_UNIT,
  segmentText,
  splitStructuralSpans,
  findPreviousSentenceStart,
  findActiveHeadingIndex,
} = require("../core.js");

test("segmentText preserves the selected source text and offsets", () => {
  const source = "Redisを利用して排他制御を実現する場合（ただし、一部は別処理です）。";
  const units = segmentText(source);

  assert.ok(units.length > 0);
  assert.equal(units.map((unit) => unit.text).join(""), source);
  for (const unit of units) {
    assert.equal(source.slice(unit.start, unit.end), unit.text);
  }
});

test("segmentText prefers Japanese phrase boundaries", () => {
  assert.equal(MAX_WORDS_PER_UNIT, 7);
  assert.deepEqual(
    segmentText("Redisを利用して排他制御を実現する場合").map((unit) => unit.text),
    ["Redisを利用して", "排他制御を", "実現する場合"],
  );
});

test("Japanese corner brackets stay together as a quote unit", () => {
  const units = segmentText("「アドバイザリロック」と呼ばれる仕組みを利用する。");

  assert.equal(units[0].text, "「アドバイザリロック」");
  assert.equal(units[0].kind, "quote");
});

test("a quote remains one unit even when it contains sentence punctuation", () => {
  const source = "「これは重要です。必ず確認してください」と説明する。";
  const units = segmentText(source);

  assert.equal(units[0].text, "「これは重要です。必ず確認してください」");
  assert.equal(units[0].kind, "quote");
  assert.equal(units.map((unit) => unit.text).join(""), source);
});

test("parenthetical text is marked as aside", () => {
  const units = segmentText("本文です（ただし、一部は例外です）。");
  const asideUnits = units.filter((unit) => unit.kind === "aside");

  assert.ok(asideUnits.length > 0);
  assert.ok(asideUnits.some((unit) => unit.text.includes("ただし")));
});

test("splitStructuralSpans identifies body, quote, and aside", () => {
  assert.deepEqual(
    splitStructuralSpans("前「引用」後（補足）").map((span) => span.kind),
    ["body", "quote", "body", "aside"],
  );
});

test("segmentText assigns sentence indices in order", () => {
  const units = segmentText("一文目です。二文目です。三文目です。");
  const sentenceIndices = [...new Set(units.map((unit) => unit.sentenceIndex))];

  assert.deepEqual(sentenceIndices, [0, 1, 2]);
});

test("findPreviousSentenceStart moves to the start of the previous sentence", () => {
  const units = segmentText("最初の文です。次の文です。最後の文です。");
  const thirdSentenceIndex = units.findIndex((unit) => unit.sentenceIndex === 2);
  const expected = units.findIndex((unit) => unit.sentenceIndex === 1);

  assert.equal(findPreviousSentenceStart(units, thirdSentenceIndex), expected);
});

test("findActiveHeadingIndex follows section transitions", () => {
  const transitions = [
    { offset: 10, headingIndex: 2 },
    { offset: 30, headingIndex: 3 },
  ];

  assert.equal(findActiveHeadingIndex(transitions, 5, 1), 1);
  assert.equal(findActiveHeadingIndex(transitions, 10, 1), 2);
  assert.equal(findActiveHeadingIndex(transitions, 42, 1), 3);
});

test("empty text produces no units", () => {
  assert.deepEqual(segmentText(""), []);
  assert.equal(findPreviousSentenceStart([], 0), 0);
});

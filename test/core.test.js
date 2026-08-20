const test = require("node:test");
const assert = require("node:assert/strict");

const { segmentText, findPreviousSentenceStart } = require("../core.js");

test("segmentText preserves the selected source text", () => {
  const source = "Redisを使う。ただし、失敗時は再試行する。";
  const units = segmentText(source);

  assert.ok(units.length > 0);
  assert.equal(
    units.map((unit) => unit.text).join(""),
    source,
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

test("findPreviousSentenceStart stays at the first sentence", () => {
  const units = segmentText("最初の文です。次の文です。");
  const firstSentenceMiddle = Math.max(
    0,
    units.findLastIndex((unit) => unit.sentenceIndex === 0),
  );

  assert.equal(findPreviousSentenceStart(units, firstSentenceMiddle), 0);
});

test("empty text produces no units", () => {
  assert.deepEqual(segmentText(""), []);
  assert.equal(findPreviousSentenceStart([], 0), 0);
});

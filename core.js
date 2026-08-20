(function installRsvpCore(root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.RsvpCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createRsvpCore() {
  const DEFAULT_WORDS_PER_UNIT = 3;

  function segmentText(text, locale = "ja", wordsPerUnit = DEFAULT_WORDS_PER_UNIT) {
    if (!text) return [];

    const sentenceSegmenter = new Intl.Segmenter(locale, {
      granularity: "sentence",
    });
    const wordSegmenter = new Intl.Segmenter(locale, {
      granularity: "word",
    });
    const maxWords = Math.max(
      1,
      Number.isInteger(wordsPerUnit) ? wordsPerUnit : DEFAULT_WORDS_PER_UNIT,
    );

    const units = [];
    let sentenceIndex = 0;

    for (const sentencePart of sentenceSegmenter.segment(text)) {
      const sentence = sentencePart.segment;
      const sentenceUnits = [];
      let unitText = "";
      let wordLikeCount = 0;

      for (const wordPart of wordSegmenter.segment(sentence)) {
        const segment = wordPart.segment;
        if (!segment) continue;

        if (wordPart.isWordLike && wordLikeCount >= maxWords) {
          sentenceUnits.push(unitText);
          unitText = "";
          wordLikeCount = 0;
        }

        unitText += segment;
        if (wordPart.isWordLike) {
          wordLikeCount += 1;
        }
      }

      if (unitText) {
        sentenceUnits.push(unitText);
      }

      for (const unitText of sentenceUnits) {
        units.push({ text: unitText, sentenceIndex });
      }

      if (sentenceUnits.length > 0) {
        sentenceIndex += 1;
      }
    }

    return units;
  }

  function findPreviousSentenceStart(units, currentUnitIndex) {
    if (!Array.isArray(units) || units.length === 0) return 0;

    const safeIndex = Math.min(
      Math.max(Number.isInteger(currentUnitIndex) ? currentUnitIndex : 0, 0),
      units.length - 1,
    );
    const currentSentenceIndex = units[safeIndex].sentenceIndex;
    const targetSentenceIndex = Math.max(0, currentSentenceIndex - 1);
    const targetIndex = units.findIndex(
      (unit) => unit.sentenceIndex === targetSentenceIndex,
    );

    return targetIndex === -1 ? 0 : targetIndex;
  }

  return {
    DEFAULT_WORDS_PER_UNIT,
    segmentText,
    findPreviousSentenceStart,
  };
});

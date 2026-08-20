(function installRsvpCore(root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.RsvpCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createRsvpCore() {
  function segmentText(text, locale = "ja") {
    if (!text) return [];

    const sentenceSegmenter = new Intl.Segmenter(locale, {
      granularity: "sentence",
    });
    const wordSegmenter = new Intl.Segmenter(locale, {
      granularity: "word",
    });

    const units = [];
    let sentenceIndex = 0;

    for (const sentencePart of sentenceSegmenter.segment(text)) {
      const sentence = sentencePart.segment;
      const sentenceUnits = [];

      for (const wordPart of wordSegmenter.segment(sentence)) {
        const segment = wordPart.segment;
        if (!segment) continue;

        if (wordPart.isWordLike || sentenceUnits.length === 0) {
          sentenceUnits.push(segment);
        } else {
          sentenceUnits[sentenceUnits.length - 1] += segment;
        }
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
    segmentText,
    findPreviousSentenceStart,
  };
});

(function installRsvpPageExtractor(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RsvpPageExtractor = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createRsvpPageExtractor() {
  function extractPage(sourceDocument = document, DefuddleClass = globalThis.Defuddle) {
    if (typeof DefuddleClass !== "function" || typeof sourceDocument.createRange !== "function") return null;

    const result = new DefuddleClass(sourceDocument, {
      markdown: false,
      useAsync: false,
      removeExactSelectors: true,
      removePartialSelectors: true,
      removeHiddenElements: true,
      removeLowScoring: true,
      removeImages: true,
      standardize: true,
      includeReplies: false,
    }).parse();
    if (typeof result?.content !== "string" || !result.content.trim()) return null;

    const contentRoot = sourceDocument.createElement("article");
    contentRoot.innerHTML = result.content;

    const fullRange = sourceDocument.createRange();
    fullRange.selectNodeContents(contentRoot);
    const rawText = fullRange.toString();
    const leadingWhitespaceLength = rawText.length - rawText.trimStart().length;
    const text = rawText.trim();
    if (!text) return null;

    const headingEntries = [...contentRoot.querySelectorAll("h1, h2, h3, h4, h5, h6")]
      .map((element) => ({
        element,
        text: (element.textContent || "").trim(),
        level: Number(element.tagName?.slice(1)) || 1,
      }))
      .filter(({ text: headingText }) => headingText.length > 0);
    const title = typeof result.title === "string" ? result.title.trim() : "";
    const includeTitle = title.length > 0 && headingEntries[0]?.text !== title;
    const sectionTransitions = headingEntries.map(({ element }, headingIndex) => {
      const prefixRange = sourceDocument.createRange();
      prefixRange.selectNodeContents(contentRoot);
      prefixRange.setEndBefore(element);
      const offset = Math.min(text.length, Math.max(0, prefixRange.toString().length - leadingWhitespaceLength));
      return { offset, headingIndex: headingIndex + (includeTitle ? 1 : 0) };
    });
    const headings = headingEntries.map(({ text: headingText, level }) => ({ text: headingText, level }));
    if (includeTitle) headings.unshift({ text: title, level: 1 });

    return {
      text,
      readingContext: {
        headings,
        sectionTransitions,
        initialHeadingIndex: includeTitle ? 0 : -1,
      },
    };
  }

  return { extractPage };
});

const MENU_ID = "read-selection-rsvp";

let requestSequence = 0;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "RSVPで読む",
      contexts: ["selection"],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;

  const text = info.selectionText;
  if (!text || text.trim().length === 0) return;

  await startReader(tab.id, text);
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["vendor/defuddle/defuddle.js", "page-extractor.js"],
    });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => globalThis.RsvpPageExtractor.extractPage(),
    });
    if (!result?.text) return;
    await startReader(tab.id, result.text, result.readingContext);
  } catch (error) {
    console.error("Failed to read the page with RSVP Reader", error);
  }
});

async function startReader(tabId, text, readingContext = null) {
  const requestId = `${Date.now()}-${requestSequence += 1}`;
  let readerReady = false;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["core.js", "reader.js"],
    });
    readerReady = true;

    await chrome.tabs.sendMessage(tabId, {
      type: "PREPARE_RSVP",
      text,
      requestId,
      readingContext,
    });

    await chrome.tabs.sendMessage(tabId, {
      type: "START_RSVP",
      text,
      requestId,
    });
  } catch (error) {
    console.error("Failed to start RSVP Reader", error);
    if (readerReady) {
      await chrome.tabs.sendMessage(tabId, {
        type: "RSVP_ERROR",
        requestId,
      }).catch(() => {});
    }
  }
}

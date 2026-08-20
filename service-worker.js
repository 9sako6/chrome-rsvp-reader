const MENU_ID = "read-selection-rsvp";

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

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["core.js", "reader.js"],
    });

    await chrome.tabs.sendMessage(tab.id, {
      type: "START_RSVP",
      text,
    });
  } catch (error) {
    console.error("Failed to start RSVP Reader", error);
  }
});

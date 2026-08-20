importScripts("vendor/kagome/wasm_exec.js");

const MENU_ID = "read-selection-rsvp";
const KAGOME_WASM_PATH = "vendor/kagome/kagome-unidic.wasm";

let kagomeInitPromise = null;
let kagomeGo = null;
let kagomeRunPromise = null;

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
    const morphologyTokens = await tokenizeWithKagome(text);

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["core.js", "reader.js"],
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (tokens) => {
        globalThis.__rsvpMorphologyTokens = tokens;
      },
      args: [morphologyTokens],
    });

    await chrome.tabs.sendMessage(tab.id, {
      type: "START_RSVP",
      text,
    });
  } catch (error) {
    console.error("Failed to start RSVP Reader", error);
  }
});

async function tokenizeWithKagome(text) {
  try {
    await ensureKagome();
    const tokens = globalThis.kagome_tokenize?.(text);
    if (!Array.isArray(tokens)) return null;

    return tokens
      .filter((token) => typeof token?.surface === "string" && token.surface.length > 0)
      .map((token) => ({
        surface: token.surface,
        pos: typeof token.pos === "string" ? token.pos : "",
      }));
  } catch (error) {
    console.warn("Kagome unavailable; falling back to Intl.Segmenter", error);
    return null;
  }
}

async function ensureKagome() {
  if (globalThis.kagome_ready && typeof globalThis.kagome_tokenize === "function") {
    return;
  }

  if (!kagomeInitPromise) {
    kagomeInitPromise = initializeKagome().catch((error) => {
      kagomeInitPromise = null;
      throw error;
    });
  }

  await kagomeInitPromise;
}

async function initializeKagome() {
  kagomeGo = new Go();
  const response = await fetch(chrome.runtime.getURL(KAGOME_WASM_PATH));
  if (!response.ok) throw new Error(`Failed to load Kagome WASM: ${response.status}`);

  let result;
  try {
    result = await WebAssembly.instantiateStreaming(response.clone(), kagomeGo.importObject);
  } catch {
    result = await WebAssembly.instantiate(await response.arrayBuffer(), kagomeGo.importObject);
  }

  kagomeRunPromise = kagomeGo.run(result.instance).catch((error) => {
    console.error("Kagome WASM exited", error);
    globalThis.kagome_ready = false;
  });

  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (globalThis.kagome_ready && typeof globalThis.kagome_tokenize === "function") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Kagome WASM did not become ready");
}

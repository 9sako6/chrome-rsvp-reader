const MENU_ID = "read-selection-rsvp";
const KAGOME_WASM_PATH = "vendor/kagome/kagome-unidic.wasm";

let kagomeInitPromise = null;
let kagomeGo = null;
let kagomeRunPromise = null;
let kagomeRuntimeLoaded = false;
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

    const morphologyTokens = tokenizeWithReadyKagome(text);

    await chrome.tabs.sendMessage(tabId, {
      type: "START_RSVP",
      text,
      morphologyTokens,
      requestId,
    });

    if (!globalThis.kagome_ready) {
      void ensureKagome().catch((error) => {
        console.warn("Failed to warm up Kagome", error);
      });
    }
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

function tokenizeWithReadyKagome(text) {
  if (!globalThis.kagome_ready || typeof globalThis.kagome_tokenize !== "function") {
    return null;
  }

  try {
    const tokens = globalThis.kagome_tokenize(text);
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
  if (!kagomeRuntimeLoaded) {
    importScripts("vendor/kagome/wasm_exec.js");
    kagomeRuntimeLoaded = true;
  }

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

(() => {
  if (globalThis.__rsvpReaderInstalled) return;
  globalThis.__rsvpReaderInstalled = true;

  const INTERVAL_MS = 350;
  const ROOT_ID = "__rsvp-reader-root";

  let units = [];
  let currentUnitIndex = 0;
  let playing = false;
  let timerId = null;
  let root = null;
  let display = null;
  let playPauseButton = null;

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "START_RSVP" || typeof message.text !== "string") {
      return;
    }

    start(message.text);
  });

  function start(text) {
    stopTimer();
    removeOverlay();

    units = globalThis.RsvpCore.segmentText(text);
    if (units.length === 0) return;

    currentUnitIndex = 0;
    createOverlay();
    renderCurrentUnit();
    play();
  }

  function createOverlay() {
    root = document.createElement("div");
    root.id = ROOT_ID;
    Object.assign(root.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "48px",
      background: "rgba(12, 12, 14, 0.96)",
      color: "#ffffff",
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", sans-serif',
    });

    display = document.createElement("div");
    Object.assign(display.style, {
      minHeight: "1.4em",
      maxWidth: "80vw",
      fontSize: "clamp(40px, 6vw, 84px)",
      fontWeight: "600",
      lineHeight: "1.35",
      textAlign: "center",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
    });

    const controls = document.createElement("div");
    Object.assign(controls.style, {
      display: "flex",
      alignItems: "center",
      gap: "12px",
    });

    const backButton = createButton("1文戻る", goBackOneSentence);
    playPauseButton = createButton("一時停止", togglePlayPause);
    const closeButton = createButton("閉じる", close);

    controls.append(backButton, playPauseButton, closeButton);
    root.append(display, controls);
    document.documentElement.append(root);
  }

  function createButton(label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    Object.assign(button.style, {
      appearance: "none",
      border: "1px solid rgba(255,255,255,0.35)",
      borderRadius: "10px",
      padding: "10px 16px",
      background: "rgba(255,255,255,0.08)",
      color: "#ffffff",
      font: "inherit",
      fontSize: "16px",
      cursor: "pointer",
    });
    button.addEventListener("click", onClick);
    return button;
  }

  function renderCurrentUnit() {
    if (!display || units.length === 0) return;
    display.textContent = units[currentUnitIndex].text;
  }

  function scheduleNext() {
    stopTimer();
    if (!playing) return;

    timerId = globalThis.setTimeout(() => {
      if (!playing) return;

      if (currentUnitIndex >= units.length - 1) {
        pause();
        return;
      }

      currentUnitIndex += 1;
      renderCurrentUnit();
      scheduleNext();
    }, INTERVAL_MS);
  }

  function play() {
    if (units.length === 0) return;
    playing = true;
    updatePlayPauseButton();
    scheduleNext();
  }

  function pause() {
    playing = false;
    stopTimer();
    updatePlayPauseButton();
  }

  function togglePlayPause() {
    if (playing) {
      pause();
    } else {
      play();
    }
  }

  function goBackOneSentence() {
    if (units.length === 0) return;
    currentUnitIndex = globalThis.RsvpCore.findPreviousSentenceStart(
      units,
      currentUnitIndex,
    );
    renderCurrentUnit();
    if (playing) scheduleNext();
  }

  function updatePlayPauseButton() {
    if (!playPauseButton) return;
    playPauseButton.textContent = playing ? "一時停止" : "再生";
  }

  function stopTimer() {
    if (timerId !== null) {
      globalThis.clearTimeout(timerId);
      timerId = null;
    }
  }

  function removeOverlay() {
    document.getElementById(ROOT_ID)?.remove();
    root = null;
    display = null;
    playPauseButton = null;
  }

  function close() {
    pause();
    removeOverlay();
    units = [];
    currentUnitIndex = 0;
  }
})();

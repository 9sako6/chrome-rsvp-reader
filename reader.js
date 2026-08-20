(() => {
  if (globalThis.__rsvpReaderInstalled) return;
  globalThis.__rsvpReaderInstalled = true;

  const INTERVAL_MS = 300;
  const ROOT_ID = "__rsvp-reader-root";

  let units = [];
  let currentUnitIndex = 0;
  let playing = false;
  let timerId = null;
  let root = null;
  let display = null;
  let playPauseButton = null;
  let headings = [];
  let headingNodes = [];
  let sectionTransitions = [];
  let initialHeadingIndex = -1;

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "START_RSVP" || typeof message.text !== "string") {
      return;
    }

    start(message.text);
  });

  function start(text) {
    stopTimer();
    removeOverlay();

    const readingContext = collectReadingContext(text);
    headings = readingContext.headings;
    sectionTransitions = readingContext.sectionTransitions;
    initialHeadingIndex = readingContext.initialHeadingIndex;

    units = globalThis.RsvpCore.segmentText(text);
    if (units.length === 0) return;

    currentUnitIndex = 0;
    createOverlay();
    renderCurrentUnit();
    play();
  }

  function collectReadingContext(sourceText) {
    const headingEntries = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")]
      .map((element) => ({
        element,
        text: (element.textContent || "").trim(),
        level: Number(element.tagName.slice(1)),
      }))
      .filter((entry) => entry.text.length > 0);

    const context = {
      headings: headingEntries.map(({ text, level }) => ({ text, level })),
      sectionTransitions: [],
      initialHeadingIndex: -1,
    };

    const selection = globalThis.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return context;
    }

    const range = selection.getRangeAt(0);
    const selectionMatchesSource = selection.toString() === sourceText;

    headingEntries.forEach(({ element }, headingIndex) => {
      try {
        const position = range.comparePoint(element, 0);
        if (position === -1) {
          context.initialHeadingIndex = headingIndex;
          return;
        }

        if (position === 0 && selectionMatchesSource) {
          const prefixRange = range.cloneRange();
          prefixRange.setEndBefore(element);
          context.sectionTransitions.push({
            offset: prefixRange.toString().length,
            headingIndex,
          });
        }
      } catch {
        // Ignore headings that cannot be compared with the selection range.
      }
    });

    context.sectionTransitions.sort((left, right) => left.offset - right.offset);
    return context;
  }

  function createOverlay() {
    root = document.createElement("div");
    root.id = ROOT_ID;
    Object.assign(root.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      background: "rgba(12, 12, 14, 0.97)",
      color: "#ffffff",
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", sans-serif',
    });

    if (headings.length > 0) {
      root.append(createMinimap());
    }

    const main = document.createElement("div");
    Object.assign(main.style, {
      position: "absolute",
      inset: "0",
    });

    display = document.createElement("div");
    Object.assign(display.style, {
      position: "absolute",
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      width: "min(80vw, 960px)",
      maxWidth: "calc(100% - 64px)",
      height: "1.35em",
      boxSizing: "border-box",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "0 12px",
      borderRadius: "12px",
      fontSize: "clamp(36px, 4.5vw, 64px)",
      fontWeight: "600",
      lineHeight: "1.35",
      textAlign: "center",
      whiteSpace: "nowrap",
      overflow: "hidden",
      overflowWrap: "normal",
      wordBreak: "keep-all",
      transition: "color 120ms ease, background-color 120ms ease, opacity 120ms ease",
    });

    const controls = document.createElement("div");
    Object.assign(controls.style, {
      position: "absolute",
      left: "50%",
      bottom: "32px",
      transform: "translateX(-50%)",
      display: "flex",
      alignItems: "center",
      gap: "12px",
    });

    const backButton = createButton("1文戻る", goBackOneSentence);
    playPauseButton = createButton("一時停止", togglePlayPause);
    const closeButton = createButton("閉じる", close);

    controls.append(backButton, playPauseButton, closeButton);
    main.append(display, controls);
    root.append(main);
    document.documentElement.append(root);
  }

  function createMinimap() {
    const minimap = document.createElement("aside");
    Object.assign(minimap.style, {
      position: "absolute",
      left: "0",
      top: "0",
      bottom: "0",
      width: "280px",
      boxSizing: "border-box",
      zIndex: "1",
      padding: "28px 16px",
      borderRight: "1px solid rgba(255,255,255,0.12)",
      overflowY: "auto",
      background: "rgba(12,12,14,0.92)",
    });

    headingNodes = headings.map((heading) => {
      const item = document.createElement("div");
      item.textContent = heading.text;
      Object.assign(item.style, {
        marginBottom: "6px",
        padding: "7px 8px",
        paddingLeft: `${8 + Math.max(0, heading.level - 1) * 12}px`,
        borderLeft: "2px solid transparent",
        borderRadius: "6px",
        color: "rgba(255,255,255,0.48)",
        fontSize: "13px",
        lineHeight: "1.35",
        overflow: "hidden",
        textOverflow: "ellipsis",
      });
      minimap.append(item);
      return item;
    });

    return minimap;
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

    const unit = units[currentUnitIndex];
    display.textContent = unit.text;
    applyUnitStyle(unit.kind);
    updateMinimap(unit.start);
  }

  function applyUnitStyle(kind) {
    Object.assign(display.style, {
      color: "#ffffff",
      backgroundColor: "transparent",
      opacity: "1",
    });

    if (kind === "aside") {
      Object.assign(display.style, {
        color: "rgba(255,255,255,0.58)",
        backgroundColor: "rgba(255,255,255,0.025)",
      });
    } else if (kind === "quote") {
      Object.assign(display.style, {
        color: "rgba(220,232,255,0.94)",
        backgroundColor: "rgba(255,255,255,0.04)",
      });
    }
  }

  function updateMinimap(currentOffset) {
    if (headingNodes.length === 0) return;

    const activeHeadingIndex = globalThis.RsvpCore.findActiveHeadingIndex(
      sectionTransitions,
      currentOffset,
      initialHeadingIndex,
    );

    headingNodes.forEach((node, index) => {
      const active = index === activeHeadingIndex;
      Object.assign(node.style, {
        color: active ? "#ffffff" : "rgba(255,255,255,0.48)",
        background: active ? "rgba(255,255,255,0.10)" : "transparent",
        borderLeftColor: active ? "rgba(255,255,255,0.85)" : "transparent",
        fontWeight: active ? "600" : "400",
      });
    });
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
    currentUnitIndex = globalThis.RsvpCore.findPreviousSentenceStart(units, currentUnitIndex);
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
    headingNodes = [];
  }

  function close() {
    pause();
    removeOverlay();
    units = [];
    currentUnitIndex = 0;
    headings = [];
    sectionTransitions = [];
    initialHeadingIndex = -1;
  }
})();

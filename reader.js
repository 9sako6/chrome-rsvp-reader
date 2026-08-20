(() => {
  if (globalThis.__rsvpReaderInstalled) return;
  globalThis.__rsvpReaderInstalled = true;

  const INTERVAL_MS = 300;
  const BLINK_INTERVAL_MS = 20000;
  const BLINK_BREAK_MS = 1200;
  const BLINK_FADE_OPACITY = "0.12";
  const ROOT_ID = "__rsvp-reader-root";
  const DISPLAY_FONT_SIZE = "clamp(36px, 4.5vw, 64px)";

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
  let activeRequestId = null;
  let preparedText = null;
  let preparedReadingContext = null;
  let progressLabel = null;
  let progressBar = null;
  let displayResizeObserver = null;
  let blinkIndicator = null;
  let playbackSinceBlinkMs = 0;
  let blinkBreakActive = false;
  let figures = [];
  let nextFigureIndex = 0;
  let figurePanel = null;
  let figureActive = false;
  let readerMain = null;
  let readerControls = null;

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "PREPARE_RSVP" && typeof message.text === "string") {
      prepare(message.text, message.requestId, message.readingContext);
      return;
    }

    if (message?.type === "START_RSVP" && typeof message.text === "string") {
      start(message.text, message.morphologyTokens, message.requestId);
      return;
    }

    if (message?.type === "RSVP_ERROR") {
      showError(message.requestId);
    }
  });

  function prepare(text, requestId, readingContext) {
    stopTimer();
    removeOverlay();
    activeRequestId = requestId;
    preparedText = text;
    preparedReadingContext = readingContext || collectReadingContext(text);
    createLoadingOverlay();
  }

  function start(text, morphologyTokens, requestId) {
    if (requestId !== activeRequestId) return;

    stopTimer();
    removeOverlay();

    const readingContext = preparedText === text && preparedReadingContext
      ? preparedReadingContext
      : collectReadingContext(text);
    headings = readingContext.headings;
    sectionTransitions = readingContext.sectionTransitions;
    initialHeadingIndex = readingContext.initialHeadingIndex;
    figures = Array.isArray(readingContext.figures) ? readingContext.figures : [];
    nextFigureIndex = 0;
    figureActive = false;

    units = globalThis.RsvpCore.segmentText(text, "ja", morphologyTokens);
    if (units.length === 0) {
      close();
      return;
    }

    currentUnitIndex = 0;
    playbackSinceBlinkMs = 0;
    blinkBreakActive = false;
    createOverlay();
    renderCurrentUnit();
    play();
  }

  function createLoadingOverlay() {
    root = createRoot();

    const status = document.createElement("div");
    Object.assign(status.style, {
      position: "absolute",
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      textAlign: "center",
    });

    const indicator = document.createElement("div");
    indicator.textContent = "文章を解析しています…";
    Object.assign(indicator.style, {
      fontSize: "clamp(24px, 3vw, 36px)",
      fontWeight: "600",
    });
    indicator.animate(
      [{ opacity: 0.45 }, { opacity: 1 }, { opacity: 0.45 }],
      { duration: 1400, iterations: Infinity },
    );

    const note = document.createElement("div");
    note.textContent = "初回は読み込みに時間がかかることがあります";
    Object.assign(note.style, {
      marginTop: "14px",
      color: "rgba(255,255,255,0.58)",
      fontSize: "14px",
    });

    const closeButton = createButton("閉じる", close);
    Object.assign(closeButton.style, {
      position: "absolute",
      left: "50%",
      bottom: "32px",
      transform: "translateX(-50%)",
    });

    status.append(indicator, note);
    root.append(status, closeButton);
    document.documentElement.append(root);
  }

  function showError(requestId) {
    if (requestId !== activeRequestId || !root) return;
    root.replaceChildren();

    const status = document.createElement("div");
    status.textContent = "文章を読み込めませんでした";
    Object.assign(status.style, {
      position: "absolute",
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      fontSize: "clamp(22px, 3vw, 34px)",
      fontWeight: "600",
    });

    const closeButton = createButton("閉じる", close);
    Object.assign(closeButton.style, {
      position: "absolute",
      left: "50%",
      bottom: "32px",
      transform: "translateX(-50%)",
    });
    root.append(status, closeButton);
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
      headings: [],
      sectionTransitions: [],
      initialHeadingIndex: -1,
      figures: [],
    };

    const selection = globalThis.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return context;
    }

    const range = selection.getRangeAt(0);
    let precedingHeadingIndex = -1;
    const transitions = [];

    headingEntries.forEach(({ element }, headingIndex) => {
      try {
        const position = range.comparePoint(element, 0);
        if (position === -1) {
          precedingHeadingIndex = headingIndex;
          return;
        }

        if (position === 0) {
          const prefixRange = range.cloneRange();
          prefixRange.setEndBefore(element);
          transitions.push({
            offset: prefixRange.toString().length,
            headingIndex,
          });
        }
      } catch {
        // Ignore headings that cannot be compared with the selection range.
      }
    });

    const relevantHeadingIndexes = [...new Set([
      precedingHeadingIndex,
      ...transitions.map(({ headingIndex }) => headingIndex),
    ].filter((index) => index >= 0))];
    const remappedIndexes = new Map(
      relevantHeadingIndexes.map((headingIndex, index) => [headingIndex, index]),
    );

    context.headings = relevantHeadingIndexes.map((headingIndex) => {
      const { text, level } = headingEntries[headingIndex];
      return { text, level };
    });
    context.initialHeadingIndex = remappedIndexes.get(precedingHeadingIndex) ?? -1;
    context.sectionTransitions = transitions
      .map(({ offset, headingIndex }) => ({
        offset: Math.min(offset, sourceText.length),
        headingIndex: remappedIndexes.get(headingIndex),
      }))
      .sort((left, right) => left.offset - right.offset);
    return context;
  }

  function createOverlay() {
    root = createRoot();
    document.documentElement.append(root);

    const stage = document.createElement("div");
    Object.assign(stage.style, {
      position: "absolute",
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      width: "min(980px, calc(100% - 48px))",
      height: "calc(100% - 48px)",
      display: "grid",
      gridTemplateColumns: headings.length > 0 ? "280px minmax(0, 1fr)" : "minmax(0, 1fr)",
      columnGap: headings.length > 0 ? "32px" : "0",
      alignItems: "stretch",
    });

    if (headings.length > 0) {
      stage.append(createMinimap());
    }

    const main = document.createElement("div");
    Object.assign(main.style, {
      position: "relative",
      minWidth: "0",
      height: "100%",
    });
    readerMain = main;

    display = document.createElement("div");
    Object.assign(display.style, {
      position: "absolute",
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      width: "min(100%, 640px)",
      maxWidth: "calc(100% - 32px)",
      height: "1.35em",
      boxSizing: "border-box",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "0 12px",
      borderRadius: "12px",
      fontSize: DISPLAY_FONT_SIZE,
      fontWeight: "600",
      lineHeight: "1.35",
      textAlign: "center",
      whiteSpace: "nowrap",
      overflow: "hidden",
      overflowWrap: "normal",
      wordBreak: "keep-all",
      transition: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "none"
        : "color 120ms ease, background-color 120ms ease, opacity 240ms ease-out",
    });

    blinkIndicator = createBlinkIndicator();

    const controls = document.createElement("div");
    Object.assign(controls.style, {
      position: "absolute",
      left: "50%",
      bottom: "8px",
      transform: "translateX(-50%)",
      display: "flex",
      alignItems: "center",
      gap: "4px",
      padding: "5px",
      border: "1px solid rgba(255,255,255,0.10)",
      borderRadius: "999px",
      background: "rgba(44,44,44,0.72)",
      boxShadow: "0 18px 48px rgba(0,0,0,0.34)",
      backdropFilter: "blur(24px) saturate(140%)",
      WebkitBackdropFilter: "blur(24px) saturate(140%)",
    });
    readerControls = controls;

    const backButton = createButton("1文戻る", goBackOneSentence);
    playPauseButton = createButton("一時停止", togglePlayPause);
    const closeButton = createButton("閉じる", close);
    Object.assign(backButton.style, { width: "92px", flex: "0 0 92px" });
    Object.assign(playPauseButton.style, { width: "92px", flex: "0 0 92px" });
    Object.assign(closeButton.style, { width: "92px", flex: "0 0 92px" });
    backButton.setAttribute("aria-keyshortcuts", "ArrowLeft");
    playPauseButton.setAttribute("aria-keyshortcuts", "Space");

    controls.append(backButton, playPauseButton, closeButton);
    main.append(display, blinkIndicator, controls);
    stage.append(main);
    root.append(stage);
    document.addEventListener("keydown", handleKeyDown);

    if (typeof globalThis.ResizeObserver === "function") {
      displayResizeObserver = new globalThis.ResizeObserver(fitDisplayText);
      displayResizeObserver.observe(main);
    }
  }

  function createRoot() {
    const element = document.createElement("div");
    element.id = ROOT_ID;
    Object.assign(element.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      background: "radial-gradient(circle at 68% 44%, rgba(44,44,44,0.32), transparent 38%), #090909",
      color: "#ffffff",
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", sans-serif',
      WebkitFontSmoothing: "antialiased",
    });
    const style = document.createElement("style");
    style.textContent = `
      #${ROOT_ID} nav::-webkit-scrollbar { display: none; }
      #${ROOT_ID} nav button:focus-visible { outline: 1px solid rgba(255,255,255,0.72); outline-offset: -2px; }
    `;
    element.append(style);
    return element;
  }

  function createBlinkIndicator() {
    const namespace = "http://www.w3.org/2000/svg";
    const icon = document.createElementNS(namespace, "svg");
    icon.setAttribute("viewBox", "0 0 44 28");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("data-rsvp-blink-indicator", "true");
    Object.assign(icon.style, {
      position: "absolute",
      left: "50%",
      top: "calc(50% + 62px)",
      transform: "translate(-50%, -50%) scaleY(1)",
      transformOrigin: "center",
      width: "34px",
      height: "22px",
      color: "rgba(255,255,255,0.72)",
      opacity: "0",
      pointerEvents: "none",
      transition: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "none"
        : "opacity 220ms ease-out",
    });

    const outline = document.createElementNS(namespace, "path");
    outline.setAttribute("d", "M2 14C7.5 6.2 14.3 2.5 22 2.5S36.5 6.2 42 14c-5.5 7.8-12.3 11.5-20 11.5S7.5 21.8 2 14Z");
    outline.setAttribute("fill", "none");
    outline.setAttribute("stroke", "currentColor");
    outline.setAttribute("stroke-width", "1.8");

    const pupil = document.createElementNS(namespace, "circle");
    pupil.setAttribute("cx", "22");
    pupil.setAttribute("cy", "14");
    pupil.setAttribute("r", "4.2");
    pupil.setAttribute("fill", "currentColor");
    icon.append(outline, pupil);
    return icon;
  }

  function createMinimap() {
    const minimap = document.createElement("aside");
    minimap.setAttribute("aria-label", "読書位置");
    Object.assign(minimap.style, {
      position: "relative",
      width: "100%",
      maxHeight: "min(72vh, 640px)",
      boxSizing: "border-box",
      zIndex: "1",
      display: "flex",
      flexDirection: "column",
      alignSelf: "center",
      padding: "14px 10px 10px",
      border: "1px solid rgba(255,255,255,0.11)",
      borderRadius: "18px",
      background: "rgba(36,36,36,0.72)",
      boxShadow: "0 18px 50px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.05)",
      backdropFilter: "blur(28px) saturate(150%)",
      WebkitBackdropFilter: "blur(28px) saturate(150%)",
    });

    const location = document.createElement("div");
    Object.assign(location.style, {
      minWidth: "0",
      padding: "0 6px 10px",
    });

    const locationMeta = document.createElement("div");
    Object.assign(locationMeta.style, {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      marginBottom: "5px",
      color: "rgba(235,235,235,0.60)",
      fontSize: "11px",
      fontWeight: "600",
      letterSpacing: "0.02em",
      fontVariantNumeric: "tabular-nums",
    });
    const locationLabel = document.createElement("span");
    locationLabel.textContent = "記事の構成";
    progressLabel = document.createElement("span");
    progressLabel.textContent = "0%";
    locationMeta.append(locationLabel, progressLabel);

    const progressTrack = document.createElement("div");
    Object.assign(progressTrack.style, {
      position: "relative",
      height: "4px",
      margin: "10px 0 0",
      borderRadius: "999px",
      background: "rgba(120,120,120,0.24)",
    });
    progressBar = document.createElement("div");
    Object.assign(progressBar.style, {
      width: "0%",
      height: "100%",
      borderRadius: "inherit",
      background: "rgba(255,255,255,0.68)",
      transition: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "none"
        : "width 220ms ease-out",
    });
    progressTrack.append(progressBar);

    const outline = document.createElement("nav");
    outline.setAttribute("aria-label", "記事の構成");
    Object.assign(outline.style, {
      minHeight: "0",
      overflowY: "auto",
      padding: "2px 0",
      scrollbarWidth: "none",
      msOverflowStyle: "none",
    });

    headingNodes = headings.map((heading, headingIndex) => {
      const item = document.createElement("button");
      item.type = "button";
      item.textContent = heading.text;
      item.title = heading.text;
      Object.assign(item.style, {
        appearance: "none",
        width: "100%",
        marginBottom: "2px",
        padding: "7px 8px",
        paddingLeft: `${8 + Math.max(0, heading.level - 1) * 11}px`,
        border: "0",
        borderRadius: "8px",
        background: "transparent",
        color: "rgba(235,235,235,0.58)",
        fontFamily: "inherit",
        fontSize: "13px",
        fontWeight: heading.level === 1 ? "600" : "450",
        lineHeight: "1.35",
        textAlign: "left",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        boxSizing: "border-box",
        cursor: "pointer",
        transition: "color 180ms ease, background-color 180ms ease",
      });
      item.addEventListener("click", () => jumpToHeading(headingIndex));
      outline.append(item);
      return item;
    });

    location.append(locationMeta, progressTrack);
    minimap.append(location, outline);

    return minimap;
  }

  function createButton(label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    Object.assign(button.style, {
      appearance: "none",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      border: "1px solid transparent",
      borderRadius: "999px",
      padding: "10px 16px",
      boxSizing: "border-box",
      background: "rgba(118,118,118,0.18)",
      color: "#ffffff",
      font: "inherit",
      fontSize: "14px",
      fontWeight: "500",
      textAlign: "center",
      whiteSpace: "nowrap",
      cursor: "pointer",
      backdropFilter: "blur(18px)",
      WebkitBackdropFilter: "blur(18px)",
      transition: "background-color 180ms ease, transform 120ms ease",
    });
    button.addEventListener("pointerenter", () => {
      button.style.background = "rgba(174,174,174,0.26)";
    });
    button.addEventListener("pointerleave", () => {
      button.style.background = "rgba(118,118,118,0.18)";
      button.style.scale = "1";
    });
    button.addEventListener("pointerdown", () => {
      button.style.scale = "0.97";
    });
    button.addEventListener("pointerup", () => {
      button.style.scale = "1";
    });
    button.addEventListener("focus", () => {
      button.style.borderColor = "rgba(255,255,255,0.86)";
    });
    button.addEventListener("blur", () => {
      button.style.borderColor = "transparent";
    });
    button.addEventListener("click", onClick);
    return button;
  }

  function renderCurrentUnit() {
    if (!display || units.length === 0) return;

    const unit = units[currentUnitIndex];
    display.textContent = unit.text;
    fitDisplayText();
    applyUnitStyle(unit.kind);
    updateMinimap(unit.start, unit.end);
  }

  function fitDisplayText() {
    if (!display) return;

    display.style.fontSize = DISPLAY_FONT_SIZE;
    const availableWidth = Math.max(0, display.clientWidth - 24);
    const requiredWidth = measureDisplayTextWidth();
    if (availableWidth <= 0 || requiredWidth <= availableWidth) return;

    const computedFontSize = Number.parseFloat(globalThis.getComputedStyle?.(display).fontSize);
    if (!Number.isFinite(computedFontSize) || computedFontSize <= 0) return;
    display.style.fontSize = `${computedFontSize * (availableWidth / requiredWidth) * 0.96}px`;
  }

  function measureDisplayTextWidth() {
    let range = null;
    try {
      range = document.createRange?.();
      range?.selectNodeContents(display);
      const rangeWidth = range?.getBoundingClientRect().width;
      if (Number.isFinite(rangeWidth)) return Math.max(display.scrollWidth, rangeWidth);
    } catch {
      return display.scrollWidth;
    } finally {
      range?.detach?.();
    }
    return display.scrollWidth;
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
        color: "rgba(255,255,255,0.90)",
        backgroundColor: "rgba(255,255,255,0.04)",
      });
    }
  }

  function updateMinimap(currentOffset, currentEnd) {
    if (headingNodes.length === 0) return;

    const activeHeadingIndex = globalThis.RsvpCore.findActiveHeadingIndex(
      sectionTransitions,
      currentOffset,
      initialHeadingIndex,
    );

    const progress = globalThis.RsvpCore.calculateReadingProgress(
      currentEnd,
      preparedText?.length || 0,
    );
    if (progressLabel) progressLabel.textContent = `${progress}%`;
    if (progressBar) progressBar.style.width = `${progress}%`;
    headingNodes.forEach((node, index) => {
      const active = index === activeHeadingIndex;
      Object.assign(node.style, {
        color: active ? "rgba(255,255,255,0.98)" : "rgba(235,235,235,0.58)",
        background: active ? "rgba(118,118,118,0.18)" : "transparent",
        boxShadow: "none",
        fontWeight: active ? "600" : headings[index].level === 1 ? "600" : "450",
      });
      node.setAttribute("aria-current", active ? "location" : "false");
    });
  }

  function scheduleNext() {
    stopTimer();
    if (!playing) return;

    timerId = globalThis.setTimeout(() => {
      if (!playing) return;

      const nextFigure = figures[nextFigureIndex];
      if (nextFigure && nextFigure.referenceEnd <= units[currentUnitIndex].end) {
        nextFigureIndex += 1;
        showFigure(nextFigure);
        return;
      }

      if (currentUnitIndex >= units.length - 1) {
        pause();
        return;
      }

      playbackSinceBlinkMs += INTERVAL_MS;
      const nextUnit = units[currentUnitIndex + 1];
      const atSentenceBoundary = nextUnit.sentenceIndex !== units[currentUnitIndex].sentenceIndex;
      if (playbackSinceBlinkMs >= BLINK_INTERVAL_MS && atSentenceBoundary) {
        beginBlinkBreak();
        return;
      }

      currentUnitIndex += 1;
      renderCurrentUnit();
      scheduleNext();
    }, INTERVAL_MS);
  }

  function showFigure(figure) {
    if (!readerMain || !display) return;
    stopTimer();
    playing = false;
    figureActive = true;
    playbackSinceBlinkMs = 0;
    blinkBreakActive = false;
    if (blinkIndicator) blinkIndicator.style.opacity = "0";
    updatePlayPauseButton();

    display.style.opacity = "0";
    display.style.pointerEvents = "none";
    if (readerControls) {
      readerControls.style.opacity = "0";
      readerControls.style.pointerEvents = "none";
    }

    figurePanel = document.createElement("section");
    figurePanel.setAttribute("aria-label", "参照図表");
    Object.assign(figurePanel.style, {
      position: "absolute",
      inset: "0",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "12px",
      padding: "20px 16px 8px",
      boxSizing: "border-box",
    });

    const reference = document.createElement("div");
    reference.textContent = figure.referenceSentence || "本文で参照されている図表";
    Object.assign(reference.style, {
      width: "min(720px, 100%)",
      color: "rgba(255,255,255,0.72)",
      fontSize: "14px",
      lineHeight: "1.55",
      textAlign: "center",
    });

    const imageSurface = document.createElement("div");
    imageSurface.setAttribute("data-rsvp-image-surface", "true");
    Object.assign(imageSurface.style, {
      position: "relative",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "min(760px, 100%)",
      minHeight: "0",
      overflow: "hidden",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: "16px",
      background: "rgba(28,28,28,0.82)",
      boxShadow: "0 20px 64px rgba(0,0,0,0.42)",
      cursor: "pointer",
      touchAction: "none",
    });

    const image = document.createElement("img");
    image.src = figure.src;
    image.alt = figure.alt || figure.caption || "参照図表";
    Object.assign(image.style, {
      display: "block",
      maxWidth: "100%",
      maxHeight: "min(54vh, 560px)",
      objectFit: "contain",
    });

    const veil = document.createElement("div");
    veil.setAttribute("data-rsvp-image-veil", "true");
    Object.assign(veil.style, {
      position: "absolute",
      inset: "0",
      background: "rgba(0,0,0,0.22)",
      opacity: "1",
      pointerEvents: "none",
      transition: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ? "none"
        : "opacity 140ms ease-out",
    });

    const revealImage = () => {
      veil.style.opacity = "0";
    };
    const dimImage = () => {
      veil.style.opacity = "1";
    };
    imageSurface.addEventListener("pointerdown", revealImage);
    imageSurface.addEventListener("pointerup", dimImage);
    imageSurface.addEventListener("pointercancel", dimImage);
    imageSurface.addEventListener("pointerleave", dimImage);
    imageSurface.append(image, veil);

    const caption = document.createElement("div");
    caption.textContent = figure.caption || figure.alt || "";
    Object.assign(caption.style, {
      width: "min(720px, 100%)",
      minHeight: "1.4em",
      color: "rgba(255,255,255,0.58)",
      fontSize: "13px",
      lineHeight: "1.4",
      textAlign: "center",
    });

    const continueButton = createButton("続きを読む", resumeAfterFigure);
    continueButton.setAttribute("aria-keyshortcuts", "Space");
    Object.assign(continueButton.style, {
      minWidth: "112px",
      marginTop: "2px",
    });

    figurePanel.append(reference, imageSurface, caption, continueButton);
    readerMain.append(figurePanel);
  }

  function resumeAfterFigure() {
    if (!figureActive) return;
    dismissFigurePanel();
    if (currentUnitIndex >= units.length - 1) {
      pause();
      return;
    }
    currentUnitIndex += 1;
    renderCurrentUnit();
    play();
  }

  function dismissFigurePanel() {
    figureActive = false;
    figurePanel?.remove();
    figurePanel = null;
    if (display) {
      display.style.opacity = "1";
      display.style.pointerEvents = "auto";
    }
    if (readerControls) {
      readerControls.style.opacity = "1";
      readerControls.style.pointerEvents = "auto";
    }
  }

  function syncNextFigureIndex() {
    const currentOffset = units[currentUnitIndex]?.start ?? 0;
    nextFigureIndex = figures.findIndex((figure) => figure.referenceEnd > currentOffset);
    if (nextFigureIndex < 0) nextFigureIndex = figures.length;
  }

  function beginBlinkBreak() {
    if (!display || !blinkIndicator || !playing) return;
    playbackSinceBlinkMs = 0;
    blinkBreakActive = true;
    display.style.opacity = BLINK_FADE_OPACITY;
    blinkIndicator.style.opacity = "0.56";
    if (!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      blinkIndicator.animate(
        [
          { transform: "translate(-50%, -50%) scaleY(1)" },
          { transform: "translate(-50%, -50%) scaleY(0.08)", offset: 0.46 },
          { transform: "translate(-50%, -50%) scaleY(1)" },
        ],
        { duration: 900, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
      );
    }
    timerId = globalThis.setTimeout(() => {
      if (!playing) return;
      blinkBreakActive = false;
      blinkIndicator.style.opacity = "0";
      currentUnitIndex += 1;
      renderCurrentUnit();
      scheduleNext();
    }, BLINK_BREAK_MS);
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
    if (blinkBreakActive) {
      blinkBreakActive = false;
      if (blinkIndicator) blinkIndicator.style.opacity = "0";
      renderCurrentUnit();
    }
    updatePlayPauseButton();
  }

  function togglePlayPause() {
    if (figureActive) {
      resumeAfterFigure();
      return;
    }
    if (playing) {
      pause();
    } else {
      play();
    }
  }

  function goBackOneSentence() {
    if (units.length === 0) return;
    dismissFigurePanel();
    blinkBreakActive = false;
    playbackSinceBlinkMs = 0;
    if (blinkIndicator) blinkIndicator.style.opacity = "0";
    currentUnitIndex = globalThis.RsvpCore.findPreviousSentenceStart(units, currentUnitIndex);
    syncNextFigureIndex();
    renderCurrentUnit();
    if (playing) scheduleNext();
  }

  function jumpToHeading(headingIndex) {
    if (units.length === 0) return;
    dismissFigurePanel();
    const transition = sectionTransitions.find((entry) => entry.headingIndex === headingIndex);
    const targetOffset = transition?.offset ?? 0;
    const targetIndex = units.findIndex((unit) => unit.end > targetOffset);
    stopTimer();
    blinkBreakActive = false;
    playbackSinceBlinkMs = 0;
    if (blinkIndicator) blinkIndicator.style.opacity = "0";
    currentUnitIndex = targetIndex < 0 ? units.length - 1 : targetIndex;
    syncNextFigureIndex();
    renderCurrentUnit();
    if (playing) scheduleNext();
  }

  function updatePlayPauseButton() {
    if (!playPauseButton) return;
    playPauseButton.textContent = playing ? "一時停止" : "再生";
  }

  function handleKeyDown(event) {
    if (!display || event.repeat || isEditableTarget(event.target)) return;
    if (event.code === "Space" || event.key === " ") {
      event.preventDefault();
      togglePlayPause();
    } else if (event.code === "ArrowLeft" || event.key === "ArrowLeft") {
      event.preventDefault();
      goBackOneSentence();
    }
  }

  function isEditableTarget(target) {
    const tagName = target?.tagName?.toLowerCase();
    return target?.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
  }

  function stopTimer() {
    if (timerId !== null) {
      globalThis.clearTimeout(timerId);
      timerId = null;
    }
  }

  function removeOverlay() {
    document.removeEventListener("keydown", handleKeyDown);
    displayResizeObserver?.disconnect();
    displayResizeObserver = null;
    document.getElementById(ROOT_ID)?.remove();
    root = null;
    display = null;
    readerMain = null;
    readerControls = null;
    blinkIndicator = null;
    playPauseButton = null;
    headingNodes = [];
    progressLabel = null;
    progressBar = null;
    playbackSinceBlinkMs = 0;
    blinkBreakActive = false;
    figurePanel = null;
    figureActive = false;
  }

  function close() {
    pause();
    removeOverlay();
    activeRequestId = null;
    preparedText = null;
    preparedReadingContext = null;
    units = [];
    currentUnitIndex = 0;
    headings = [];
    sectionTransitions = [];
    initialHeadingIndex = -1;
    figures = [];
    nextFigureIndex = 0;
  }
})();

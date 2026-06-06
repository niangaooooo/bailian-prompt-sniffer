(function () {
  "use strict";

  const MIN_IMAGE_SIZE = 80;
  const MAX_TEXT_CHARS = 12000;
  const MAX_IMAGES = 40;
  const MENU_CLASS = "dsc-image-menu";
  const MENU_VISIBLE_CLASS = "is-visible";
  const PANEL_CLASS = "dsc-result-panel";
  const TABS = [
    { key: "json", label: "JSON" },
    { key: "zh", label: "Chinese" },
    { key: "en", label: "English" },
  ];

  let menuEl = null;
  let activeImage = null;
  let hideTimer = null;
  let hoverPromptTimer = null;
  let panelEl = null;
  let activeTab = "json";
  let activeRequestId = null;
  let settingsCache = null;
  let settingsCacheAt = 0;
  let panelContent = { json: "", zh: "", en: "" };
  const promptCache = new Map();

  function absoluteUrl(value) {
    if (!value) return "";
    try {
      return new URL(value, window.location.href).href;
    } catch {
      return "";
    }
  }

  function cleanText(value, limit) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, limit || 2000);
  }

  function pageBasics() {
    const description =
      document.querySelector('meta[name="description"]')?.getAttribute("content") ||
      document.querySelector('meta[property="og:description"]')?.getAttribute("content") ||
      "";
    return {
      title: document.title || "",
      url: window.location.href,
      origin: window.location.origin,
      description: cleanText(description, 800),
    };
  }

  function getVisibleText() {
    const text = document.body?.innerText || document.body?.textContent || "";
    return cleanText(text, MAX_TEXT_CHARS);
  }

  function getSelectionText() {
    return cleanText(window.getSelection()?.toString() || "", MAX_TEXT_CHARS);
  }

  function nearbyTextFor(el) {
    const parts = [];
    const figure = el.closest?.("figure");
    const figcaption = figure?.querySelector("figcaption")?.innerText;
    if (figcaption) parts.push(figcaption);
    const aria = el.getAttribute?.("aria-label");
    if (aria) parts.push(aria);
    if (el.parentElement?.innerText) parts.push(el.parentElement.innerText);
    if (el.parentElement?.parentElement?.innerText) parts.push(el.parentElement.parentElement.innerText);
    return cleanText(parts.join("\n"), 1200);
  }

  function imageContextFromElement(img) {
    const rect = img.getBoundingClientRect();
    return {
      src: absoluteUrl(img.currentSrc || img.src),
      alt: cleanText(img.alt || "", 500),
      title: cleanText(img.title || "", 500),
      width: img.naturalWidth || img.width || null,
      height: img.naturalHeight || img.height || null,
      displayWidth: Math.round(rect.width || 0),
      displayHeight: Math.round(rect.height || 0),
      nearbyText: nearbyTextFor(img),
    };
  }

  function imageContextFromSrc(src) {
    const abs = absoluteUrl(src);
    const target = Array.from(document.images).find((img) => {
      const current = absoluteUrl(img.currentSrc || img.src);
      return current === abs || img.src === src || img.currentSrc === src;
    });
    return target
      ? imageContextFromElement(target)
      : {
          src: abs,
          alt: "",
          title: "",
          width: null,
          height: null,
          displayWidth: null,
          displayHeight: null,
          nearbyText: "",
        };
  }

  function extractImages() {
    const seen = new Set();
    const images = [];
    const add = (image) => {
      if (!image.src || seen.has(image.src) || image.src.startsWith("data:")) return;
      seen.add(image.src);
      images.push(image);
    };

    Array.from(document.images).forEach((img) => {
      const width = img.naturalWidth || img.width || 0;
      const height = img.naturalHeight || img.height || 0;
      if (width >= MIN_IMAGE_SIZE && height >= MIN_IMAGE_SIZE) add(imageContextFromElement(img));
    });

    document.querySelectorAll("video[poster]").forEach((video) => {
      const src = absoluteUrl(video.getAttribute("poster"));
      if (src) {
        add({
          src,
          alt: "",
          title: cleanText(video.getAttribute("title") || "", 500),
          width: video.videoWidth || null,
          height: video.videoHeight || null,
          nearbyText: nearbyTextFor(video),
        });
      }
    });

    return images.slice(0, MAX_IMAGES);
  }

  function extractPageContext() {
    return {
      page: pageBasics(),
      selection: getSelectionText(),
      visibleText: getVisibleText(),
      images: extractImages(),
    };
  }

  function extractSelectionContext() {
    return {
      page: pageBasics(),
      selection: getSelectionText(),
      visibleText: "",
      images: [],
    };
  }

  function isEligibleImage(img) {
    if (!(img instanceof HTMLImageElement)) return false;
    const src = absoluteUrl(img.currentSrc || img.src);
    if (!src || src.startsWith("data:")) return false;
    const width = img.naturalWidth || img.width || 0;
    const height = img.naturalHeight || img.height || 0;
    return width >= MIN_IMAGE_SIZE && height >= MIN_IMAGE_SIZE;
  }

  async function getPublicSettings() {
    const now = Date.now();
    if (settingsCache && now - settingsCacheAt < 5000) return settingsCache;
    settingsCache = (await chrome.runtime.sendMessage({ action: "GET_SETTINGS" })) || {};
    settingsCacheAt = now;
    return settingsCache;
  }

  function initImageMenu() {
    document.addEventListener("mouseover", handleMouseOver, true);
    document.addEventListener("mouseout", handleMouseOut, true);
    window.addEventListener("scroll", scheduleMenuPosition, { passive: true, capture: true });
    window.addEventListener("resize", scheduleMenuPosition, { passive: true });
  }

  function handleMouseOver(event) {
    const img = event.target instanceof HTMLImageElement ? event.target : null;
    if (!img || !isEligibleImage(img)) return;
    activeImage = img;
    clearHideTimer();
    const menu = ensureMenu();
    positionMenu(img, menu);
    menu.classList.add(MENU_VISIBLE_CLASS);
    scheduleAutoPrompt(img);
  }

  function handleMouseOut(event) {
    const related = event.relatedTarget;
    if (related instanceof Node && menuEl?.contains(related)) return;
    if (related instanceof Node && related === activeImage) return;
    clearHoverPromptTimer();
    scheduleHideMenu();
  }

  function ensureMenu() {
    if (menuEl) return menuEl;
    const menu = document.createElement("div");
    menu.className = MENU_CLASS;

    const ask = document.createElement("button");
    ask.type = "button";
    ask.textContent = "Extract prompt";
    ask.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void extractPromptForActiveImage({ force: true });
    });

    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy context";
    copy.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void copyActiveImageContext();
    });

    menu.append(ask, copy);
    menu.addEventListener("mouseenter", clearHideTimer);
    menu.addEventListener("mouseleave", scheduleHideMenu);
    document.body.appendChild(menu);
    menuEl = menu;
    return menu;
  }

  function positionMenu(img, menu) {
    const rect = img.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    const gap = 10;
    const width = menu.offsetWidth || 260;
    const height = menu.offsetHeight || 42;
    const fitsRight = rect.right + gap + width <= vw - margin;
    const fitsLeft = rect.left - gap - width >= margin;
    let left;
    let top;

    if (fitsRight) {
      left = rect.right + gap;
      top = rect.top;
    } else if (fitsLeft) {
      left = rect.left - gap - width;
      top = rect.top;
    } else if (rect.bottom + gap + height <= vh - margin) {
      left = rect.left;
      top = rect.bottom + gap;
    } else if (rect.top - gap - height >= margin) {
      left = rect.left;
      top = rect.top - gap - height;
    } else {
      left = Math.min(Math.max(rect.left, margin), vw - width - margin);
      top = Math.min(Math.max(rect.top, margin), vh - height - margin);
    }

    left = Math.min(Math.max(left, margin), vw - width - margin);
    top = Math.min(Math.max(top, margin), vh - height - margin);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  let menuRaf = 0;
  function scheduleMenuPosition() {
    if (!activeImage || !menuEl?.classList.contains(MENU_VISIBLE_CLASS) || menuRaf) return;
    menuRaf = requestAnimationFrame(() => {
      menuRaf = 0;
      if (activeImage && menuEl) positionMenu(activeImage, menuEl);
    });
  }

  function scheduleHideMenu() {
    clearHideTimer();
    hideTimer = window.setTimeout(() => {
      menuEl?.classList.remove(MENU_VISIBLE_CLASS);
      activeImage = null;
    }, 260);
  }

  function clearHideTimer() {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  async function scheduleAutoPrompt(img) {
    clearHoverPromptTimer();
    const src = absoluteUrl(img.currentSrc || img.src);
    if (!src || promptCache.has(src)) return;
    let settings;
    try {
      settings = await getPublicSettings();
    } catch {
      return;
    }
    if (!settings.autoExtractOnHover) return;
    hoverPromptTimer = window.setTimeout(() => {
      if (activeImage === img) void extractPromptForActiveImage({ force: false });
    }, settings.hoverDelayMs || 900);
  }

  function clearHoverPromptTimer() {
    if (hoverPromptTimer !== null) {
      window.clearTimeout(hoverPromptTimer);
      hoverPromptTimer = null;
    }
  }

  async function extractPromptForActiveImage({ force }) {
    if (!activeImage) return;
    const image = imageContextFromElement(activeImage);
    if (!force && promptCache.has(image.src)) {
      showResultPanel(promptCache.get(image.src));
      return;
    }
    const requestId = `img-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    activeRequestId = requestId;
    showStreamingPanel(requestId, image);
    try {
      const response = await chrome.runtime.sendMessage({
        action: "EXTRACT_IMAGE_PROMPT",
        requestId,
        image,
        page: pageBasics(),
      });
      if (response?.ok) {
        promptCache.set(image.src, response);
        showResultPanel(response);
      } else {
        showResultPanel({ ok: false, content: response?.error || "Request failed" });
      }
    } catch (error) {
      showResultPanel({ ok: false, content: error?.message || String(error) });
    }
  }

  async function copyActiveImageContext() {
    if (!activeImage) return;
    const image = imageContextFromElement(activeImage);
    await navigator.clipboard.writeText(JSON.stringify({ page: pageBasics(), image }, null, 2));
    showToast("Image context copied");
  }

  function showToast(text) {
    const existing = document.querySelector(".dsc-toast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.className = "dsc-toast";
    toast.textContent = text;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    window.setTimeout(() => {
      toast.classList.remove("is-visible");
      window.setTimeout(() => toast.remove(), 220);
    }, 2200);
  }

  function showStreamingPanel(requestId, image) {
    activeTab = "json";
    const panel = ensureResultPanel();
    panel.dataset.requestId = requestId;
    panel.classList.add("is-visible", "is-loading");
    setPanelTitle("Extracting image prompt");
    setPanelMeta(`Pinned on top - ${image.width || "?"}x${image.height || "?"}`);
    updatePanelContent("Waiting for model stream...", { streaming: true });
  }

  function showResultPanel(result) {
    ensureResultPanel();
    activeRequestId = null;
    panelEl.classList.add("is-visible");
    panelEl.classList.remove("is-loading");
    setPanelTitle(result.ok === false ? "Prompt extraction failed" : "Image prompt");
    setPanelMeta(buildResultMeta(result));
    updatePanelContent(result.content || "(empty)", { streaming: false });
  }

  function buildResultMeta(result) {
    const parts = [];
    if (result.cacheHit) parts.push("Cache hit");
    if (result.deduped) parts.push("Deduped");
    if (result.model) parts.push(result.model);
    if (result.usage?.total_tokens) parts.push(`${result.usage.total_tokens} tokens`);
    if (result.estimatedImageTokens) parts.push(`~${result.estimatedImageTokens} image tokens`);
    if (result.optimizedBytes && result.originalBytes && result.optimizedBytes < result.originalBytes) {
      parts.push(`${formatBytes(result.originalBytes)} -> ${formatBytes(result.optimizedBytes)}`);
    }
    return parts.join(" - ") || "Pinned on top";
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return "";
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  function ensureResultPanel() {
    if (panelEl) return panelEl;
    const panel = document.createElement("div");
    panel.className = PANEL_CLASS;

    const header = document.createElement("div");
    header.className = "dsc-result-header";
    const titleWrap = document.createElement("div");
    const title = document.createElement("div");
    title.className = "dsc-result-title";
    const meta = document.createElement("div");
    meta.className = "dsc-result-meta";
    titleWrap.append(title, meta);
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "x";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", () => panel.classList.remove("is-visible"));
    header.append(titleWrap, close);

    const tabs = document.createElement("div");
    tabs.className = "dsc-result-tabs";
    TABS.forEach((tab) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "dsc-result-tab";
      button.dataset.tab = tab.key;
      button.textContent = tab.label;
      button.addEventListener("click", () => setActiveTab(tab.key));
      tabs.appendChild(button);
    });

    const panels = document.createElement("div");
    panels.className = "dsc-result-panels";
    TABS.forEach((tab) => {
      const pre = document.createElement("pre");
      pre.className = "dsc-result-body";
      pre.dataset.panel = tab.key;
      panels.appendChild(pre);
    });

    const toolbar = document.createElement("div");
    toolbar.className = "dsc-result-toolbar";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "dsc-result-copy";
    copy.textContent = "Copy active tab";
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(panelContent[activeTab] || "");
      showToast("Result copied");
    });
    toolbar.appendChild(copy);

    panel.append(header, tabs, panels, toolbar);
    document.body.appendChild(panel);
    panelEl = panel;
    setActiveTab("json");
    return panel;
  }

  function setPanelTitle(text) {
    const title = panelEl?.querySelector(".dsc-result-title");
    if (title) title.textContent = text;
  }

  function setPanelMeta(text) {
    const meta = panelEl?.querySelector(".dsc-result-meta");
    if (meta) meta.textContent = text;
  }

  function updatePanelContent(raw, { streaming }) {
    panelContent = formatPromptTabs(raw, streaming);
    TABS.forEach((tab) => {
      const pre = panelEl?.querySelector(`.dsc-result-body[data-panel="${tab.key}"]`);
      if (pre) {
        pre.textContent = panelContent[tab.key] || "";
        if (tab.key === activeTab) pre.scrollTop = pre.scrollHeight;
      }
    });
    setActiveTab(activeTab);
  }

  function setActiveTab(key) {
    activeTab = key;
    if (!panelEl) return;
    panelEl.querySelectorAll(".dsc-result-tab").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.tab === key);
    });
    panelEl.querySelectorAll(".dsc-result-body").forEach((pre) => {
      pre.classList.toggle("is-active", pre.dataset.panel === key);
    });
  }

  function formatPromptTabs(raw, streaming) {
    const parsed = parsePromptJson(raw);
    if (!parsed) {
      return {
        json: raw || "",
        zh: streaming ? "Waiting for complete JSON..." : raw || "",
        en: streaming ? "Waiting for complete JSON..." : raw || "",
      };
    }
    return {
      json: JSON.stringify(parsed, null, 2),
      zh: buildChineseTab(parsed),
      en: buildEnglishTab(parsed),
    };
  }

  function parsePromptJson(raw) {
    const text = String(raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    if (!text) return null;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  function buildChineseTab(data) {
    const pool = buildPromptPoolText(data.prompt_pool);
    const fingerprint = buildStyleFingerprintText(data.style_fingerprint);
    return [
      data.zh_prompt || "",
      data.gptimage2_prompt ? `\n\nGPTImage2 prompt:\n${data.gptimage2_prompt}` : "",
      fingerprint ? `\nStyle fingerprint:\n${fingerprint}` : "",
      data.similarity_anchors?.length ? `\nSimilarity anchors: ${data.similarity_anchors.join(", ")}` : "",
      data.must_keep?.length ? `\nMust keep: ${data.must_keep.join(", ")}` : "",
      data.must_avoid?.length ? `\nMust avoid: ${data.must_avoid.join(", ")}` : "",
      data.aspect_or_crop ? `\nAspect/crop: ${data.aspect_or_crop}` : "",
      pool ? `\n\nPrompt pool:\n${pool}` : "",
      data.negative_prompt ? `\nNegative prompt: ${data.negative_prompt}` : "",
      data.style_tags?.length ? `\nStyle tags: ${data.style_tags.join(", ")}` : "",
      data.subject ? `\nSubject: ${data.subject}` : "",
      data.composition ? `\nComposition: ${data.composition}` : "",
      data.lighting ? `\nLighting: ${data.lighting}` : "",
      data.color ? `\nColor: ${data.color}` : "",
      data.materials ? `\nMaterials: ${data.materials}` : "",
      data.camera ? `\nCamera: ${data.camera}` : "",
      data.text_or_logo ? `\nText/logo: ${data.text_or_logo}` : "",
      data.notes ? `\nNotes: ${data.notes}` : "",
    ].join("").trim();
  }

  function buildEnglishTab(data) {
    const pool = buildPromptPoolText(data.prompt_pool);
    const fingerprint = buildStyleFingerprintText(data.style_fingerprint);
    return [
      data.en_prompt || "",
      data.gptimage2_prompt ? `\n\nGPTImage2 prompt:\n${data.gptimage2_prompt}` : "",
      fingerprint ? `\nStyle fingerprint:\n${fingerprint}` : "",
      data.similarity_anchors?.length ? `\nSimilarity anchors: ${data.similarity_anchors.join(", ")}` : "",
      data.must_keep?.length ? `\nMust keep: ${data.must_keep.join(", ")}` : "",
      data.must_avoid?.length ? `\nMust avoid: ${data.must_avoid.join(", ")}` : "",
      data.aspect_or_crop ? `\nAspect/crop: ${data.aspect_or_crop}` : "",
      pool ? `\n\nPrompt pool:\n${pool}` : "",
      data.negative_prompt ? `\nNegative prompt: ${data.negative_prompt}` : "",
      data.style_tags?.length ? `\nStyle tags: ${data.style_tags.join(", ")}` : "",
      data.subject ? `\nSubject: ${data.subject}` : "",
      data.composition ? `\nComposition: ${data.composition}` : "",
      data.lighting ? `\nLighting: ${data.lighting}` : "",
      data.color ? `\nColor: ${data.color}` : "",
      data.materials ? `\nMaterials: ${data.materials}` : "",
      data.camera ? `\nCamera: ${data.camera}` : "",
      data.text_or_logo ? `\nText/logo: ${data.text_or_logo}` : "",
    ].join("").trim();
  }

  function buildPromptPoolText(pool) {
    if (!pool || typeof pool !== "object") return "";
    return Object.entries(pool)
      .filter(([, values]) => Array.isArray(values) && values.length)
      .map(([key, values]) => `${key}: ${values.join(", ")}`)
      .join("\n");
  }

  function buildStyleFingerprintText(fingerprint) {
    if (!fingerprint || typeof fingerprint !== "object") return "";
    return Object.entries(fingerprint)
      .filter(([, value]) => String(value || "").trim())
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const msg = message || {};
    if (msg.action === "PING") {
      sendResponse({ ok: true });
      return;
    }
    if (msg.action === "EXTRACT_PAGE_CONTEXT") {
      sendResponse(extractPageContext());
      return;
    }
    if (msg.action === "EXTRACT_SELECTION_CONTEXT") {
      sendResponse(extractSelectionContext());
      return;
    }
    if (msg.action === "EXTRACT_IMAGE_BY_SRC") {
      sendResponse({ page: pageBasics(), image: imageContextFromSrc(msg.src) });
      return;
    }
    if (msg.action === "SHOW_PROMPT_RESULT") {
      showResultPanel(msg.result || { ok: false, content: "Empty result" });
      sendResponse({ ok: true });
      return;
    }
    if (msg.action === "PROMPT_STREAM_STATUS") {
      if (!msg.requestId || msg.requestId === activeRequestId) setPanelMeta(msg.status || "");
      return;
    }
    if (msg.action === "PROMPT_STREAM_DELTA") {
      if (!msg.requestId || msg.requestId === activeRequestId) {
        setPanelMeta(msg.model ? `Streaming - ${msg.model}` : "Streaming...");
        updatePanelContent(msg.content || "", { streaming: true });
      }
      return;
    }
    if (msg.action === "PROMPT_STREAM_DONE") {
      if (!msg.requestId || msg.requestId === activeRequestId) showResultPanel(msg.result);
    }
  });

  initImageMenu();
})();

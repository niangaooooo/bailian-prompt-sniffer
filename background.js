(function () {
  "use strict";

  const DEFAULT_SETTINGS = {
    apiBase: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "",
    model: "qwen3.6-plus",
    thinking: "disabled",
    reasoningEffort: "high",
    maxTokens: 1400,
    visionApiBase: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    visionApiKey: "",
    visionModel: "qwen3.6-plus",
    autoExtractOnHover: false,
    hoverDelayMs: 1500,
    costOptimizedVersion: 2,
    systemPrompt:
      "You are a browser collection assistant. Use only the supplied page, selection, image, and image metadata. For image prompt extraction, produce reusable generation prompts and visual attributes.",
  };

  const SETTINGS_KEY = "bailianPromptSnifferSettings";
  const LEGACY_SETTINGS_KEYS = ["kimiPromptSnifferSettings", "deepseekCollectorSettings"];
  const LAST_RESULT_KEY = "bailianPromptSnifferLastResult";
  const PROMPT_CACHE_KEY = "bailianPromptSnifferPromptCacheV1";
  const PROMPT_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const PROMPT_CACHE_MAX_ENTRIES = 120;
  const PROMPT_PROMPT_VERSION = "gptimage2-complete-compact-v5";
  const MAX_ORIGINAL_IMAGE_BYTES = 18 * 1024 * 1024;
  const IMAGE_MAX_EDGE = 768;
  const IMAGE_JPEG_QUALITY = 0.74;
  const inflightPromptRequests = new Map();

  function normalizeSettings(raw) {
    const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
    merged.apiBase = migrateProviderBase(String(merged.apiBase || DEFAULT_SETTINGS.apiBase)).replace(/\/+$/, "");
    merged.visionApiBase = migrateProviderBase(
      String(merged.visionApiBase || DEFAULT_SETTINGS.visionApiBase)
    ).replace(/\/+$/, "");
    merged.apiKey = String(merged.apiKey || "");
    merged.visionApiKey = String(merged.visionApiKey || "");
    merged.model = migrateModel(String(merged.model || DEFAULT_SETTINGS.model));
    merged.visionModel = migrateModel(String(merged.visionModel || DEFAULT_SETTINGS.visionModel));
    merged.thinking = merged.thinking === "enabled" ? "enabled" : "disabled";
    merged.reasoningEffort = merged.reasoningEffort === "max" ? "max" : "high";
    const rawCostVersion = Number(raw?.costOptimizedVersion || 0);
    if (raw && rawCostVersion < DEFAULT_SETTINGS.costOptimizedVersion) {
      merged.maxTokens = DEFAULT_SETTINGS.maxTokens;
      merged.autoExtractOnHover = DEFAULT_SETTINGS.autoExtractOnHover;
      merged.hoverDelayMs = DEFAULT_SETTINGS.hoverDelayMs;
      merged.costOptimizedVersion = DEFAULT_SETTINGS.costOptimizedVersion;
    }
    merged.autoExtractOnHover = merged.autoExtractOnHover === true;
    const parsedDelay = Number(merged.hoverDelayMs);
    merged.hoverDelayMs = Number.isFinite(parsedDelay)
      ? Math.min(Math.max(Math.floor(parsedDelay), 250), 5000)
      : DEFAULT_SETTINGS.hoverDelayMs;
    const parsedMax = Number(merged.maxTokens);
    merged.maxTokens = Number.isFinite(parsedMax)
      ? Math.min(Math.max(Math.floor(parsedMax), 256), 8192)
      : DEFAULT_SETTINGS.maxTokens;
    merged.systemPrompt = String(merged.systemPrompt || DEFAULT_SETTINGS.systemPrompt);
    merged.costOptimizedVersion = DEFAULT_SETTINGS.costOptimizedVersion;
    return merged;
  }

  function migrateProviderBase(apiBase) {
    if (!apiBase || /siliconflow\.cn/i.test(apiBase) || /deepseek\.com/i.test(apiBase)) {
      return DEFAULT_SETTINGS.apiBase;
    }
    return apiBase;
  }

  function migrateModel(model) {
    if (!model || /kimi-k2/i.test(model) || /^Qwen\//.test(model) || /^deepseek-/i.test(model)) {
      return DEFAULT_SETTINGS.model;
    }
    return model;
  }

  async function getSettings() {
    const result = await chrome.storage.local.get([SETTINGS_KEY, ...LEGACY_SETTINGS_KEYS]);
    const raw =
      result[SETTINGS_KEY] ||
      LEGACY_SETTINGS_KEYS.map((key) => result[key]).find((value) => value && typeof value === "object");
    const settings = normalizeSettings(raw);
    if (!result[SETTINGS_KEY] || raw?.costOptimizedVersion !== settings.costOptimizedVersion) {
      await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    }
    return settings;
  }

  async function saveSettings(next) {
    const current = await getSettings();
    const settings = normalizeSettings({ ...current, ...(next || {}) });
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    return withoutSecret(settings);
  }

  function withoutSecret(settings) {
    return {
      ...settings,
      apiKey: settings.apiKey ? "********" : "",
      visionApiKey: settings.visionApiKey ? "********" : "",
      hasApiKey: !!settings.apiKey,
      hasVisionApiKey: !!settings.visionApiKey,
    };
  }

  function makeUserMessage(kind, prompt, context) {
    const safePrompt = prompt && prompt.trim()
      ? prompt.trim()
      : "Summarize the collected browser context and list actionable takeaways.";
    return [
      "The browser extension collected the following context. Complete the task without inventing unsupported facts.",
      "",
      JSON.stringify(
        {
          task: safePrompt,
          kind,
          collected_at: new Date().toISOString(),
          context,
        },
        null,
        2
      ),
    ].join("\n");
  }

  async function callTextModel({ kind, prompt, context }) {
    const settings = await getSettings();
    if (!settings.apiKey) throw new Error("NO_API_KEY");
    const response = await fetch(`${settings.apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: "system", content: settings.systemPrompt },
          { role: "user", content: makeUserMessage(kind, prompt, context) },
        ],
        max_tokens: settings.maxTokens,
        stream: false,
      }),
    });
    const data = await readJsonOrText(response);
    if (!response.ok) throw new Error(`CHAT_${response.status}: ${extractErrorMessage(data)}`);
    const message = data?.choices?.[0]?.message;
    const result = {
      ok: true,
      kind,
      content: message?.content || "",
      reasoning: message?.reasoning_content || "",
      model: data?.model || settings.model,
      usage: data?.usage || null,
      createdAt: Date.now(),
    };
    await chrome.storage.local.set({ [LAST_RESULT_KEY]: result });
    return result;
  }

  async function readJsonOrText(response) {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  function extractErrorMessage(data) {
    return data?.error?.message || data?.message || data?.raw || "unknown error";
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("NO_ACTIVE_TAB");
    return tab;
  }

  async function ensureContentScript(tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { action: "PING" });
      return;
    } catch {
      await chrome.scripting.insertCSS({ target: { tabId }, files: ["styles/content.css"] });
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    }
  }

  async function collectFromTab(tab, action, extra) {
    await ensureContentScript(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { action, ...(extra || {}) });
    if (response?.error) throw new Error(response.error);
    return response;
  }

  async function askActivePage(prompt) {
    const tab = await getActiveTab();
    const context = await collectFromTab(tab, "EXTRACT_PAGE_CONTEXT");
    return callTextModel({ kind: "page", prompt, context });
  }

  async function askSelection(prompt) {
    const tab = await getActiveTab();
    const context = await collectFromTab(tab, "EXTRACT_SELECTION_CONTEXT");
    if (!context.selection) throw new Error("NO_SELECTION");
    return callTextModel({ kind: "selection", prompt, context });
  }

  async function imageListPrompt(prompt) {
    const tab = await getActiveTab();
    const context = await collectFromTab(tab, "EXTRACT_PAGE_CONTEXT");
    context.visibleText = "";
    return callTextModel({
      kind: "image_list",
      prompt:
        prompt ||
        "Organize the page image list. Identify likely purpose, pick the 5 most useful images, and suggest reuse ideas.",
      context,
    });
  }

  async function blobToDataUrl(blob) {
    const buffer = await blob.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
  }

  async function sha256Hex(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  async function hashText(value) {
    return sha256Hex(new TextEncoder().encode(String(value || "")));
  }

  function clipText(value, limit) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, limit);
  }

  function estimateImageTokens(width, height) {
    if (!width || !height) return null;
    return Math.ceil((width * height) / (32 * 32) + 2);
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return "";
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  async function fetchImageForPrompt(src) {
    const response = await fetch(src, { credentials: "omit", cache: "force-cache" });
    if (!response.ok) throw new Error(`IMAGE_FETCH_${response.status}`);
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) throw new Error(`NOT_IMAGE: ${blob.type || "unknown"}`);
    if (blob.size > MAX_ORIGINAL_IMAGE_BYTES) throw new Error("IMAGE_TOO_LARGE");

    const originalBuffer = await blob.arrayBuffer();
    const imageHash = await sha256Hex(originalBuffer);
    const optimized = await optimizeImageBlob(blob);
    const dataUrl = await blobToDataUrl(optimized.blob);
    return {
      dataUrl,
      imageHash,
      originalBytes: blob.size,
      optimizedBytes: optimized.blob.size,
      originalType: blob.type,
      optimizedType: optimized.blob.type || blob.type,
      width: optimized.width,
      height: optimized.height,
      optimized: optimized.optimized,
      estimatedImageTokens: estimateImageTokens(optimized.width, optimized.height),
    };
  }

  async function optimizeImageBlob(blob) {
    if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
      return { blob, width: null, height: null, optimized: false };
    }

    let bitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch {
      return { blob, width: null, height: null, optimized: false };
    }

    const originalWidth = bitmap.width;
    const originalHeight = bitmap.height;
    const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(originalWidth, originalHeight));
    const width = Math.max(1, Math.round(originalWidth * scale));
    const height = Math.max(1, Math.round(originalHeight * scale));

    try {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return { blob, width: originalWidth, height: originalHeight, optimized: false };
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      const nextBlob = await canvas.convertToBlob({
        type: "image/jpeg",
        quality: IMAGE_JPEG_QUALITY,
      });
      if (!nextBlob?.size) return { blob, width: originalWidth, height: originalHeight, optimized: false };
      if (scale < 1 || nextBlob.size < blob.size) {
        return { blob: nextBlob, width, height, optimized: true };
      }
      return { blob, width: originalWidth, height: originalHeight, optimized: false };
    } catch {
      return { blob, width: originalWidth, height: originalHeight, optimized: false };
    } finally {
      bitmap.close?.();
    }
  }

  async function readPromptCache() {
    const stored = await chrome.storage.local.get(PROMPT_CACHE_KEY);
    const cache = stored[PROMPT_CACHE_KEY];
    if (!cache || typeof cache !== "object") return { entries: {} };
    return { entries: cache.entries && typeof cache.entries === "object" ? cache.entries : {} };
  }

  async function writePromptCache(cache) {
    prunePromptCache(cache);
    await chrome.storage.local.set({ [PROMPT_CACHE_KEY]: cache });
  }

  function prunePromptCache(cache) {
    const now = Date.now();
    const entries = Object.entries(cache.entries || {}).filter(([, entry]) => {
      const createdAt = Number(entry?.createdAt || 0);
      return createdAt && now - createdAt <= PROMPT_CACHE_TTL_MS;
    });
    entries.sort((a, b) => Number(b[1]?.lastHitAt || b[1]?.createdAt || 0) - Number(a[1]?.lastHitAt || a[1]?.createdAt || 0));
    cache.entries = Object.fromEntries(entries.slice(0, PROMPT_CACHE_MAX_ENTRIES));
  }

  async function getPromptCacheEntry(key) {
    const cache = await readPromptCache();
    prunePromptCache(cache);
    const entry = cache.entries[key];
    if (!entry?.result) {
      await writePromptCache(cache);
      return null;
    }
    entry.lastHitAt = Date.now();
    entry.hitCount = Number(entry.hitCount || 0) + 1;
    await writePromptCache(cache);
    return entry.result;
  }

  async function setPromptCacheEntry(key, result, meta) {
    const cache = await readPromptCache();
    const now = Date.now();
    cache.entries[key] = {
      result,
      meta: meta || {},
      createdAt: now,
      lastHitAt: now,
      hitCount: 0,
    };
    await writePromptCache(cache);
  }

  async function makePromptCacheKey(settings, imageHash, userPrompt) {
    const promptHash = await hashText(userPrompt || "");
    return [PROMPT_PROMPT_VERSION, settings.visionModel, imageHash, promptHash].join(":");
  }

  function buildVisionPrompt(image, page, userPrompt) {
    return [
      userPrompt || "Reverse-engineer this image into GPTImage2-ready generation prompts.",
      "",
      "Return compact STRICT JSON only. No markdown fence. No explanation outside JSON.",
      "The JSON must be complete and valid. If space is limited, shorten arrays and notes instead of cutting off the closing braces.",
      "Output the most useful fields first: zh_prompt, en_prompt, gptimage2_prompt, negative_prompt, then compact diagnostics.",
      "Each array may contain at most 5 short phrases. Avoid duplicate phrases across fields.",
      "Do not use a fixed house style or a repeated category template. The next image may be any category, medium, subject, or visual style.",
      "Goal: make GPTImage2 output look as close as possible to this exact image, not a cleaner or prettier version.",
      "First infer this image's own category, medium, and fidelity level. Do not assume DSLR, cinematic lighting, shallow depth of field, high detail, or polished realism unless clearly visible.",
      "For illustrated or stylized images, lock the render grammar: flat/vector/cartoon, clean line art, watercolor, oil paint, manga, thick paint, paper texture, 3D, collage, UI, etc. Distinguish clean flat cartoon illustration from textured painterly anime.",
      "Lock the complexity level. If the source uses simple linework, loose hand-drawn outlines, few facial details, broad flat color blocks, minimal shading, or simplified scenery, state that strongly. Do not let GPTImage2 upgrade it into polished anime scenery, detailed background painting, smooth gradients, or high-detail character art.",
      "For line-style images, describe line thickness, line color, whether lines are wobbly/loose/clean, whether shapes are rounded blob-like, whether fills are flat, and whether highlights are sparse white strokes/dots.",
      "For composition, preserve how much of the frame the subject occupies and how much background is simplified. If the original is avatar-like or sticker-like, do not turn it into a wide scenic poster.",
      "The first phrase of zh_prompt and en_prompt must name the exact visual medium/fidelity. Examples: low-res phone snapshot, clean flat cartoon illustration, vector-like avatar art, rough pencil sketch, textured painterly anime poster. Pick only what the current image shows.",
      "Capture drift-prone details: crop/aspect, subject scale and placement, camera height/distance/angle, pose, gaze, expression, clothing shapes/materials/colors, background geometry, visible lines/signs, lighting/weather, depth of field, resolution, compression, blur, grain, and other imperfections.",
      "If the source looks like a low-res social-media photo, phone snapshot, screenshot, scanned image, illustration, UI, product photo, or any other specific medium, say that directly.",
      "Negative prompt must block the most likely wrong style for this image: for example painterly texture when the source is flat, realistic photography when the source is cartoon, cinematic sunset when the source is pastel daylight, high-detail rendering when the source is simple.",
      "The prompt_pool should be a similarity pool, not a style preset. Put common GPTImage2 failure modes for this image into avoid and negative_prompt.",
      'Use this schema exactly: {"zh_prompt":"","en_prompt":"","gptimage2_prompt":"","negative_prompt":"","style_fingerprint":{"medium":"","rendering":"","linework":"","shape_language":"","palette":"","texture":"","shadow":"","detail_density":"","complexity_level":"","background_simplicity":""},"must_keep":[],"must_avoid":[],"prompt_pool":{"core_style":[],"subject":[],"composition":[],"palette":[],"linework_simplicity":[],"avoid":[]},"similarity_anchors":[],"aspect_or_crop":"","text_or_logo":"","notes":""}',
      "zh_prompt and en_prompt should be directly usable in GPTImage2.",
      "gptimage2_prompt should be the best single copy-paste prompt, more detailed than zh_prompt, but not bloated.",
    ].join("\n");
  }

  function buildVisionMetadata(image, page) {
    return [
      "Image metadata, use only if helpful:",
      JSON.stringify({
        page_title: clipText(page?.title, 120),
        image_alt: clipText(image?.alt, 180),
        image_title: clipText(image?.title, 120),
        image_size: image?.width && image?.height ? `${image.width}x${image.height}` : "",
        nearby_text: clipText(image?.nearbyText, 420),
      }),
    ].join("\n");
  }

  function buildVisionRequest(settings, dataUrl, image, page, prompt, stream) {
    return {
      model: settings.visionModel,
      messages: [
        {
          role: "system",
          content:
            "You are an expert image-to-prompt extractor. Return accurate reusable prompts and visual attributes.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: buildVisionPrompt(image, page, prompt) },
            { type: "image_url", image_url: { url: dataUrl } },
            { type: "text", text: buildVisionMetadata(image, page) },
          ],
        },
      ],
      max_tokens: settings.maxTokens,
      stream,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
    };
  }

  async function callVisionEndpoint(settings, dataUrl, image, page, prompt, streamTarget) {
    const apiBase = settings.visionApiBase;
    const apiKey = settings.visionApiKey || settings.apiKey;
    const model = settings.visionModel;
    if (!apiBase || !apiKey || !model) throw new Error("NO_VISION_CONFIG");

    const stream = !!streamTarget?.tabId;
    const response = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildVisionRequest(settings, dataUrl, image, page, prompt, stream)),
    });

    if (!response.ok) {
      const data = await readJsonOrText(response);
      throw new Error(`VISION_${response.status}: ${extractErrorMessage(data)}`);
    }

    if (stream && response.body) {
      return readStreamingCompletion(response, streamTarget, model);
    }

    const data = await readJsonOrText(response);
    return {
      content: data?.choices?.[0]?.message?.content || "",
      model: data?.model || model,
      usage: data?.usage || null,
    };
  }

  async function readStreamingCompletion(response, streamTarget, fallbackModel) {
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = "";
    let content = "";
    let usage = null;
    let model = fallbackModel;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let data;
        try {
          data = JSON.parse(payload);
        } catch {
          continue;
        }
        if (data.model) model = data.model;
        if (data.usage) usage = data.usage;
        const choice = data.choices?.[0];
        const delta = choice?.delta?.content || choice?.message?.content || "";
        if (delta) {
          content += delta;
          await sendToTab(streamTarget.tabId, {
            action: "PROMPT_STREAM_DELTA",
            requestId: streamTarget.requestId,
            delta,
            content,
            model,
          });
        }
      }
    }

    return { content, model, usage };
  }

  async function sendToTab(tabId, message) {
    if (!tabId) return;
    try {
      await chrome.tabs.sendMessage(tabId, message);
    } catch {
      // The content script may be gone if the user navigated away.
    }
  }

  async function extractPromptFromImage(payload, streamTarget) {
    const settings = await getSettings();
    const page = payload.page || null;
    const image = payload.image || null;
    if (!image?.src) throw new Error("NO_IMAGE");

    await sendToTab(streamTarget?.tabId, {
      action: "PROMPT_STREAM_STATUS",
      requestId: streamTarget?.requestId,
      status: "Fetching image...",
    });
    const asset = await fetchImageForPrompt(image.src);
    const cacheKey = await makePromptCacheKey(settings, asset.imageHash, payload.prompt);
    const cached = await getPromptCacheEntry(cacheKey);
    if (cached) {
      const result = {
        ...cached,
        cacheHit: true,
        createdAt: Date.now(),
      };
      await chrome.storage.local.set({ [LAST_RESULT_KEY]: result });
      await sendToTab(streamTarget?.tabId, {
        action: "PROMPT_STREAM_STATUS",
        requestId: streamTarget?.requestId,
        status: "Cache hit. Reusing local prompt.",
      });
      await sendToTab(streamTarget?.tabId, {
        action: "PROMPT_STREAM_DONE",
        requestId: streamTarget?.requestId,
        result,
      });
      return result;
    }

    const existing = inflightPromptRequests.get(cacheKey);
    if (existing) {
      await sendToTab(streamTarget?.tabId, {
        action: "PROMPT_STREAM_STATUS",
        requestId: streamTarget?.requestId,
        status: "Same image is already being analyzed...",
      });
      const result = { ...(await existing), deduped: true, createdAt: Date.now() };
      await chrome.storage.local.set({ [LAST_RESULT_KEY]: result });
      await sendToTab(streamTarget?.tabId, {
        action: "PROMPT_STREAM_DONE",
        requestId: streamTarget?.requestId,
        result,
      });
      return result;
    }

    await sendToTab(streamTarget?.tabId, {
      action: "PROMPT_STREAM_STATUS",
      requestId: streamTarget?.requestId,
      status: [
        "Reading optimized image...",
        asset.optimized ? `${formatBytes(asset.originalBytes)} -> ${formatBytes(asset.optimizedBytes)}` : formatBytes(asset.optimizedBytes),
        asset.estimatedImageTokens ? `~${asset.estimatedImageTokens} image tokens` : "",
      ]
        .filter(Boolean)
        .join(" "),
    });

    const visionPromise = (async () => {
      const vision = await callVisionEndpoint(settings, asset.dataUrl, image, page, payload.prompt, streamTarget);
      const result = {
        ok: true,
        kind: "image_prompt",
        content: vision.content,
        reasoning: "",
        model: vision.model || settings.visionModel,
        usage: vision.usage || null,
        rawVisionPrompt: vision.content,
        cacheHit: false,
        imageHash: asset.imageHash,
        originalBytes: asset.originalBytes,
        optimizedBytes: asset.optimizedBytes,
        estimatedImageTokens: asset.estimatedImageTokens,
        createdAt: Date.now(),
      };
      await setPromptCacheEntry(cacheKey, result, {
        model: result.model,
        imageHash: asset.imageHash,
        optimized: asset.optimized,
        originalBytes: asset.originalBytes,
        optimizedBytes: asset.optimizedBytes,
        estimatedImageTokens: asset.estimatedImageTokens,
      });
      return result;
    })().finally(() => {
      inflightPromptRequests.delete(cacheKey);
    });

    inflightPromptRequests.set(cacheKey, visionPromise);
    const result = await visionPromise;
    await chrome.storage.local.set({ [LAST_RESULT_KEY]: result });
    await sendToTab(streamTarget?.tabId, {
      action: "PROMPT_STREAM_DONE",
      requestId: streamTarget?.requestId,
      result,
    });
    return result;
  }

  async function showResultInTab(tabId, result) {
    try {
      await ensureContentScript(tabId);
      await chrome.tabs.sendMessage(tabId, { action: "SHOW_PROMPT_RESULT", result });
    } catch {
      chrome.runtime.sendMessage({ action: "PROMPT_RESULT", result }).catch(() => {});
    }
  }

  async function handleContextMenu(info, tab) {
    if (!tab?.id) return;
    try {
      let result;
      if (info.menuItemId === "qwen-page") {
        const context = await collectFromTab(tab, "EXTRACT_PAGE_CONTEXT");
        result = await callTextModel({
          kind: "page",
          prompt: "Summarize this page and extract useful material.",
          context,
        });
      } else if (info.menuItemId === "qwen-selection") {
        const context = await collectFromTab(tab, "EXTRACT_SELECTION_CONTEXT");
        context.selection = info.selectionText || context.selection;
        result = await callTextModel({
          kind: "selection",
          prompt: "Explain this selected text and list follow-up questions.",
          context,
        });
      } else if (info.menuItemId === "qwen-image" && info.srcUrl) {
        const context = await collectFromTab(tab, "EXTRACT_IMAGE_BY_SRC", { src: info.srcUrl });
        result = await extractPromptFromImage(context, {
          tabId: tab.id,
          requestId: `ctx-${Date.now()}`,
        });
      }
      if (result) await showResultInTab(tab.id, result);
    } catch (error) {
      await showResultInTab(tab.id, {
        ok: false,
        content: friendlyError(error),
        createdAt: Date.now(),
      });
    }
  }

  function friendlyError(error) {
    const message = error?.message || String(error);
    if (message === "NO_API_KEY") {
      return "No DashScope/Bailian API key saved. Open the popup and save your key first.";
    }
    if (message === "NO_SELECTION") return "No selected text on this page.";
    return message;
  }

  async function rebuildContextMenus() {
    await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));
    chrome.contextMenus.create({
      id: "qwen-page",
      title: "Use Qwen to summarize this page",
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: "qwen-selection",
      title: "Use Qwen to analyze selection",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "qwen-image",
      title: "Extract image prompt",
      contexts: ["image"],
    });
  }

  chrome.runtime.onInstalled.addListener(() => {
    void rebuildContextMenus();
  });

  chrome.runtime.onStartup.addListener(() => {
    void rebuildContextMenus();
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    void handleContextMenu(info, tab);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      const msg = message || {};
      switch (msg.action) {
        case "GET_SETTINGS":
          return withoutSecret(await getSettings());
        case "SAVE_SETTINGS":
          return saveSettings(msg.settings);
        case "GET_LAST_RESULT": {
          const stored = await chrome.storage.local.get(LAST_RESULT_KEY);
          return stored[LAST_RESULT_KEY] || null;
        }
        case "ASK_ACTIVE_PAGE":
          return askActivePage(msg.prompt);
        case "ASK_SELECTION":
          return askSelection(msg.prompt);
        case "EXTRACT_IMAGE_PROMPT":
          return extractPromptFromImage(msg, {
            tabId: sender?.tab?.id,
            requestId: msg.requestId,
          });
        case "ASK_IMAGE_LIST":
          return imageListPrompt(msg.prompt);
        default:
          return { ok: false, error: "UNKNOWN_ACTION" };
      }
    })()
      .then(sendResponse)
      .catch((error) => {
        sendResponse({ ok: false, error: friendlyError(error) });
      });
    return true;
  });
})();

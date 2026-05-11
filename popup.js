(function () {
  "use strict";

  const els = {};
  let lastContent = "";

  function bindElements() {
    [
      "api-key",
      "model",
      "thinking",
      "reasoning-effort",
      "max-tokens",
      "vision-api-base",
      "vision-model",
      "vision-api-key",
      "auto-extract-on-hover",
      "save-settings",
      "prompt",
      "ask-page",
      "ask-selection",
      "ask-images",
      "copy-result",
      "status",
      "result-text",
    ].forEach((id) => {
      els[id] = document.getElementById(id);
    });
  }

  async function send(action, payload) {
    const response = await chrome.runtime.sendMessage({ action, ...(payload || {}) });
    if (response?.ok === false || response?.error) {
      throw new Error(response.error || "Request failed");
    }
    return response;
  }

  async function loadSettings() {
    const settings = await send("GET_SETTINGS");
    const model = settings.model || "qwen3.6-plus";
    ensureModelOption(model);
    els.model.value = model;
    els.thinking.value = settings.thinking || "disabled";
    els["reasoning-effort"].value = settings.reasoningEffort || "high";
    els["max-tokens"].value = settings.maxTokens || 1400;
    els["vision-api-base"].value =
      settings.visionApiBase || "https://dashscope.aliyuncs.com/compatible-mode/v1";
    els["vision-model"].value = settings.visionModel || "qwen3.6-plus";
    els["auto-extract-on-hover"].checked = settings.autoExtractOnHover !== false;
    els["api-key"].placeholder = settings.hasApiKey ? "saved; leave blank to keep" : "sk-...";
    els["vision-api-key"].placeholder = settings.hasVisionApiKey
      ? "saved; leave blank to keep"
      : "blank = reuse DashScope key";

    const last = await chrome.runtime.sendMessage({ action: "GET_LAST_RESULT" }).catch(() => null);
    if (last?.content) renderResult(last);
  }

  function ensureModelOption(model) {
    if ([...els.model.options].some((option) => option.value === model)) return;
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    els.model.appendChild(option);
  }

  function readSettingsForm() {
    const settings = {
      model: els.model.value,
      thinking: els.thinking.value,
      reasoningEffort: els["reasoning-effort"].value,
      maxTokens: Number(els["max-tokens"].value) || 1400,
      visionApiBase: els["vision-api-base"].value.trim(),
      visionModel: els["vision-model"].value.trim(),
      autoExtractOnHover: els["auto-extract-on-hover"].checked,
    };
    const key = els["api-key"].value.trim();
    if (key) settings.apiKey = key;
    const visionKey = els["vision-api-key"].value.trim();
    if (visionKey) settings.visionApiKey = visionKey;
    return settings;
  }

  async function saveSettings() {
    setStatus("Saving...");
    await send("SAVE_SETTINGS", { settings: readSettingsForm() });
    els["api-key"].value = "";
    els["vision-api-key"].value = "";
    els["api-key"].placeholder = "saved; leave blank to keep";
    els["vision-api-key"].placeholder = "saved; leave blank to keep";
    setStatus("Settings saved");
  }

  async function runAction(action) {
    const prompt = els.prompt.value.trim();
    setBusy(true);
    setStatus("Thinking...");
    try {
      const result = await send(action, { prompt });
      renderResult(result);
      setStatus("Done");
    } catch (error) {
      renderError(error?.message || String(error));
      setStatus("Failed");
    } finally {
      setBusy(false);
    }
  }

  function renderResult(result) {
    lastContent = result.content || "";
    const usage = result.usage?.total_tokens ? ` - ${result.usage.total_tokens} tokens` : "";
    els["result-text"].textContent = [
      result.reasoning ? `Reasoning\n${result.reasoning}\n` : "",
      result.content || "(empty)",
      result.model ? `\n\n- ${result.model}${usage}` : "",
    ].join("");
  }

  function renderError(message) {
    lastContent = "";
    els["result-text"].textContent = message;
  }

  function setStatus(text) {
    els.status.textContent = text;
  }

  function setBusy(busy) {
    ["ask-page", "ask-selection", "ask-images", "save-settings"].forEach((id) => {
      els[id].disabled = busy;
    });
  }

  async function copyResult() {
    const text = lastContent || els["result-text"].textContent || "";
    if (!text.trim()) return;
    await navigator.clipboard.writeText(text);
    setStatus("Copied");
  }

  function bindEvents() {
    els["save-settings"].addEventListener("click", () => void saveSettings());
    els["ask-page"].addEventListener("click", () => void runAction("ASK_ACTIVE_PAGE"));
    els["ask-selection"].addEventListener("click", () => void runAction("ASK_SELECTION"));
    els["ask-images"].addEventListener("click", () => void runAction("ASK_IMAGE_LIST"));
    els["copy-result"].addEventListener("click", () => void copyResult());

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.action === "PROMPT_RESULT" && message.result) {
        renderResult(message.result);
      }
    });
  }

  function start() {
    bindElements();
    bindEvents();
    loadSettings().catch((error) => {
      renderError(error?.message || String(error));
      setStatus("Init failed");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();

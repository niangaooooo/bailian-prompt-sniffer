# Project Notes

This project is a local Chrome MV3 extension. Treat the folder containing this `AGENTS.md` file as `<project-root>`.

## Current State

- Extension name: `Bailian Prompt Sniffer`.
- Default API base: `https://dashscope.aliyuncs.com/compatible-mode/v1`.
- Default text and vision model: `qwen3.6-plus`.
- Vision fallback model options exposed in the popup: `qwen3-vl-plus`, `qwen-vl-plus-latest`.
- The popup stores API keys only in `chrome.storage.local`; do not write keys into files.
- Image extraction streams model output into a pinned top-right content-script panel with JSON / Chinese / English tabs.

## Prompt Extraction

- Current prompt schema/cache version: `gptimage2-complete-compact-v5`.
- If prompt instructions or JSON shape change, bump `PROMPT_PROMPT_VERSION` in `background.js` so old image-hash cache entries do not reuse stale extraction behavior.
- The JSON puts `zh_prompt`, `en_prompt`, `gptimage2_prompt`, and `negative_prompt` first to avoid losing the copy-paste prompt if output is clipped.
- The extraction style is GPTImage2-focused and similarity-first. It should preserve the source image's medium, fidelity, render grammar, linework, complexity, crop, subject scale, and imperfections instead of upgrading every image into a polished style.

## Cost Controls

- Images are downscaled to max edge `768` and encoded as JPEG quality `0.74` before model input.
- Local prompt cache key includes prompt schema version, vision model, image SHA-256, and user prompt hash.
- Cache TTL is 30 days, capped at 120 entries.
- Default `maxTokens` is `1400` to reduce clipped JSON while staying modest.
- Auto extract on hover is off by default.

## Main Files

- `manifest.json`: MV3 manifest, permissions, host permissions.
- `background.js`: settings migration, DashScope calls, image fetch/resize/cache, streaming parser, context menus.
- `content.js`: page/image extraction, hover menu, pinned result panel, JSON tab formatting.
- `popup.html`, `popup.js`, `styles/popup.css`: settings and popup actions.
- `styles/content.css`: hover menu and pinned panel styling.
- `README.md`: user-facing load/use notes.
- `docs/handoff.md`: development history and current handoff summary.

## Validation

Use these checks from `<project-root>` after code changes:

```powershell
node --check .\background.js
node --check .\content.js
node --check .\popup.js
Get-Content -Raw -Path .\manifest.json | ConvertFrom-Json | Out-Null
```

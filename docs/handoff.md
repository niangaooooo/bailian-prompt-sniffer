# Handoff

Last reconciled: 2026-05-08.

## What This Is

`Bailian Prompt Sniffer` is a local unpacked Chrome MV3 extension inspired by the original Framia collector pattern. It sniffs browser images, sends hovered/context-menu images to Alibaba Bailian/DashScope through an OpenAI-compatible chat completion endpoint, and displays GPTImage2-ready reverse prompts in a pinned page panel.

## Development History

- Started from a review of the sibling `framia` extension, reusing the content-script extraction plus background API bridge pattern, without Framia's auth-token capture, project binding, S3 upload, or canvas insertion behavior.
- Initial provider experiments used DeepSeek and SiliconFlow Kimi K2.6.
- SiliconFlow attempts failed for the user's key with `VISION_403: Model is private. You can not access it` and then `VISION_403: Model disabled`.
- The extension was switched to Alibaba Bailian / DashScope Beijing compatible mode with default model `qwen3.6-plus`.
- Streaming image prompt extraction, a pinned top-right panel, and JSON / Chinese / English tabs were added.
- Token controls were added: image downscale/compress, request dedupe, local image-hash prompt cache, fixed prompt prefix ordering, default auto-hover off.
- GPTImage2 prompt extraction was iterated from generic image-to-prompt into similarity-first output with `style_fingerprint`, `must_keep`, `must_avoid`, and compact prompt pools.
- The current schema version `gptimage2-complete-compact-v5` puts `zh_prompt`, `en_prompt`, `gptimage2_prompt`, and `negative_prompt` first to avoid clipped JSON losing the usable prompt.

## Current Defaults

- Base URL: `https://dashscope.aliyuncs.com/compatible-mode/v1`.
- Model: `qwen3.6-plus`.
- Vision model: `qwen3.6-plus`.
- Fallback vision model options: `qwen3-vl-plus`, `qwen-vl-plus-latest`.
- Max output tokens: `1400`.
- Image max edge before upload: `768`.
- JPEG quality before upload: `0.74`.
- Prompt cache TTL: 30 days.
- Prompt cache max entries: 120.
- Auto extract on hover: disabled by default.

## Known Operational Notes

- If `qwen3.6-plus` rejects image input for the user's account, switch `Vision Model` in the popup to `qwen3-vl-plus` or `qwen-vl-plus-latest`.
- The extension intentionally does not run a real API smoke test during cleanup because that consumes the user's DashScope quota.
- When the prompt schema changes, bump `PROMPT_PROMPT_VERSION` in `background.js`.
- If JSON is clipped again, first shorten schema arrays or increase the popup `Max Tokens`; do not add large repeated fields to the schema.

## Verification

Use these checks from the extension root:

```powershell
node --check .\background.js
node --check .\content.js
node --check .\popup.js
Get-Content -Raw -Path .\manifest.json | ConvertFrom-Json | Out-Null
```

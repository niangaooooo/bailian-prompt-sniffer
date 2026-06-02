# Bailian Prompt Sniffer

An open-source Chrome MV3 extension for extracting reusable, structured image-generation prompts from browser images.

Bailian Prompt Sniffer helps designers, creators, and developers reverse-engineer image prompts from the current browser page. Hover over an image, click **Extract prompt**, and the extension returns structured JSON, Chinese prompts, English prompts, style fingerprints, negative prompts, and reuse notes in a pinned panel.

The project is early-stage, but it focuses on a practical and security-sensitive workflow: browser content extraction, image fetching, local API key handling, model API calls, and prompt schema stability.

## Why this project exists

Image-to-prompt workflows are often fragile. A generic prompt may accidentally change the visual medium, simplify or over-polish the style, ignore crop/aspect details, or turn flat illustrations into realistic photos. This extension tries to make the process more transparent and reproducible by extracting a per-image similarity pool instead of forcing every image into one fixed prompt template.

It is especially useful for:

- designers collecting visual references and rebuilding them as generation prompts;
- creators who need Chinese and English prompt variants;
- developers testing OpenAI-compatible vision endpoints;
- prompt engineers who want structured JSON for remixing, comparison, and debugging.

## Features

- **Chrome MV3 extension** with popup, background service worker, content script, and pinned in-page result panel.
- **Image prompt extraction** from browser pages by hovering over an image and clicking `Extract prompt`.
- **Structured outputs** including `zh_prompt`, `en_prompt`, `gptimage2_prompt`, `negative_prompt`, `style_fingerprint`, `must_keep`, `must_avoid`, and `prompt_pool`.
- **Style drift control** for medium, rendering method, linework, shape language, palette, texture amount, shadow model, complexity level, and background simplicity.
- **Token and cost controls** with local SHA-256 image caching, request dedupe, image downscaling, output token limits, and cache-friendly prompt ordering.
- **Separate text and vision settings** so users can configure different OpenAI-compatible providers for page text and image prompt extraction.
- **Local-first secret handling**: API keys are stored in Chrome local storage and are not hard-coded in the repository.

## Default provider

The current default provider is Alibaba Cloud Model Studio / Bailian through its OpenAI-compatible endpoint.

- Base URL: `https://dashscope.aliyuncs.com/compatible-mode/v1`
- Endpoint: `POST /chat/completions`
- Default model: `qwen3.6-plus`
- Auth: `Authorization: Bearer YOUR_DASHSCOPE_API_KEY`

If `qwen3.6-plus` rejects image input for your account, switch the Vision Model field to `qwen3-vl-plus`, `qwen3-vl-flash`, or `qwen-vl-plus-latest`.

## Usage

1. Clone or download this repository.
2. Open `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the `bailian-prompt-sniffer` extension folder.
6. Open the extension popup and save your API base URL, model, and API key.
7. Open any web page with images, hover over an image, and click **Extract prompt**.

The prompt window is pinned at the top-right of the page. It includes JSON, Chinese, and English tabs. JSON streams first; once complete, the Chinese and English tabs are populated from the structured result.

## Output shape

Image extraction currently uses prompt schema version `gptimage2-complete-compact-v5`. Bump `PROMPT_PROMPT_VERSION` in `background.js` whenever the schema or extraction instructions change so stale image-hash cache entries do not reuse older prompt behavior.

The model is instructed to return compact strict JSON in this shape:

```json
{
  "zh_prompt": "",
  "en_prompt": "",
  "gptimage2_prompt": "",
  "negative_prompt": "",
  "style_fingerprint": {
    "medium": "",
    "rendering": "",
    "linework": "",
    "shape_language": "",
    "palette": "",
    "texture": "",
    "shadow": "",
    "detail_density": "",
    "complexity_level": "",
    "background_simplicity": ""
  },
  "must_keep": [],
  "must_avoid": [],
  "prompt_pool": {
    "core_style": [],
    "subject": [],
    "composition": [],
    "palette": [],
    "linework_simplicity": [],
    "avoid": []
  },
  "similarity_anchors": [],
  "aspect_or_crop": "",
  "text_or_logo": "",
  "notes": ""
}
```

`gptimage2_prompt` is the safest single copy-paste prompt. The prompt pool is capped to short arrays so the response is less likely to end mid-JSON.

## Token controls

- **Local cache**: image prompt results are cached by SHA-256 image hash for 30 days, up to 120 entries.
- **Request dedupe**: if the same image is triggered twice while the first request is still running, later requests wait for the first result instead of starting another API call.
- **Image downscaling**: images are resized to a max edge of 768 px and converted to JPEG quality 0.74 before being sent to the model.
- **Safer defaults**: max output tokens is 1400, auto-extract-on-hover is off by default, and hover delay is 1500 ms if enabled.
- **Cache-friendly prompt order**: stable extraction instructions are sent before image/page-specific metadata to improve common-prefix cache hits.

Alibaba Cloud notes that visual tokens scale with image resolution. For most visual models, the estimate is roughly `height * width / (32 * 32) + 2`, so downscaling large images is the biggest input-token saver.

References:

- Visual token calculation: https://www.alibabacloud.com/help/en/model-studio/vision-understanding/
- Context cache: https://www.alibabacloud.com/help/en/model-studio/context-cache

## Privacy and security

This is a browser extension, so privacy and security are core maintenance concerns.

- API keys are entered by the user and stored locally in Chrome storage.
- The extension only sends selected page/image context to the configured model endpoint when the user triggers an action.
- Auto extraction is disabled by default.
- Image results are cached locally by image hash to reduce repeated network calls.
- The project should be reviewed carefully whenever permissions, content scripts, CSP, host permissions, or provider settings change.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and security review scope.

## Development

Run these from the extension root after editing code:

```powershell
node --check .\background.js
node --check .\content.js
node --check .\popup.js
Get-Content -Raw -Path .\manifest.json | ConvertFrom-Json | Out-Null
```

Recommended manual checks:

1. Load the unpacked extension in Chrome.
2. Confirm popup settings save and reload correctly.
3. Test page context extraction on a normal web page.
4. Test image prompt extraction on at least one photo and one illustration.
5. Confirm the JSON output is complete and parseable.
6. Confirm no API key appears in logs, screenshots, or committed files.

## Roadmap

- Add optional presets for more OpenAI-compatible vision providers.
- Add JSON schema validation for model outputs.
- Add regression examples for common image types: photos, flat illustrations, anime-style images, product images, UI screenshots, and low-resolution social-media images.
- Add automated checks for extension manifest permissions and CSP changes.
- Improve documentation for designers and non-technical creators.
- Add issue templates for bug reports, provider compatibility reports, and prompt-quality feedback.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening an issue or pull request.

Good first contributions include:

- provider compatibility notes;
- prompt schema improvements;
- examples of failure cases and drift-prone images;
- documentation improvements;
- security review suggestions for Chrome extension permissions.

## License

MIT

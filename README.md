# Bailian Prompt Sniffer

Chrome MV3 image prompt sniffer for Alibaba Cloud Model Studio / Bailian.

Default provider:

- Base URL: `https://dashscope.aliyuncs.com/compatible-mode/v1`
- Endpoint: `POST /chat/completions`
- Model: `qwen3.6-plus`
- Auth: `Authorization: Bearer YOUR_DASHSCOPE_API_KEY`

The extension sniffs images in the current browser page. Hover over an image, click `Extract prompt`, and it returns JSON / Chinese / English prompt tabs in a pinned top-right panel.

The image prompt extractor is tuned for a GPTImage2 workflow. It avoids a fixed style template and instead extracts a per-image similarity pool: subject, pose/expression, clothing/props, scene/background, composition/camera, light/color, medium/fidelity, texture/detail, avoid tokens, must-keep anchors, and must-avoid drift notes.

For stylized images, it also outputs a `style_fingerprint` that locks the source render grammar: medium, rendering method, linework, shape language, palette, texture amount, shadow model, and detail density. This helps prevent a clean flat cartoon from drifting into textured painterly anime, or an illustration from turning into a photo.

The extractor also records `complexity_level` and `background_simplicity`. This is important for loose line-style art: simple source images should stay simple instead of becoming polished anime scenery or a detailed poster.

## Usage

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select this extension folder, `deepseek-collector`.
5. Open the extension popup and save your DashScope/Bailian API key.

## Token Controls

- Local cache: image prompt results are cached by SHA-256 image hash for 30 days, up to 120 entries. The same image reuses the local result and does not call the model again.
- Request dedupe: if the same image is triggered twice while the first request is still running, later requests wait for the first result instead of starting another API call.
- Image downscaling: images are resized to a max edge of 768 px and converted to JPEG quality 0.74 before being sent to the model.
- Safer defaults: max output tokens is now 1400 to prevent clipped JSON, auto-extract-on-hover is off by default, and hover delay is 1500 ms if you enable it.
- Cache-friendly prompt order: the stable extraction instruction is sent before image/page-specific metadata to improve Bailian/Qwen common-prefix cache hits.

Alibaba Cloud notes that visual tokens scale with image resolution. For most visual models, the estimate is roughly `height * width / (32 * 32) + 2`, so downscaling large images is the biggest input-token saver. Bailian/Qwen also has context cache support for common prefixes, which is why the request keeps stable instructions before per-image metadata.

References:

- Visual token calculation: https://www.alibabacloud.com/help/en/model-studio/vision-understanding/
- Context cache: https://www.alibabacloud.com/help/en/model-studio/context-cache

## Output Shape

Image extraction currently uses prompt schema version `gptimage2-complete-compact-v5`. Bump `PROMPT_PROMPT_VERSION` in `background.js` whenever the schema or extraction instructions change, so stale image-hash cache entries do not reuse older prompt behavior.

The model is instructed to return complete strict JSON in this order:

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

`gptimage2_prompt` is the safest single copy-paste prompt for GPTImage2. The prompt pool is capped to short arrays so the response is less likely to end mid-JSON.

## Notes

- The Beijing region OpenAI-compatible base URL is `https://dashscope.aliyuncs.com/compatible-mode/v1`.
- If `qwen3.6-plus` rejects image input for your account, switch the Vision Model field to `qwen3-vl-plus`, `qwen3-vl-flash`, or `qwen-vl-plus-latest`.
- The popup exposes separate Vision Base URL / Vision Model / Vision Key fields so you can keep text and vision calls separate if needed.
- Image prompt extraction uses streaming responses. The page prompt window stays pinned at the top-right with the browser's maximum z-index.
- The prompt window has three tabs: JSON, Chinese, and English. JSON streams live first; once complete, Chinese and English tabs are populated from the structured JSON.
- The JSON output includes a `prompt_pool` designed for GPTImage2 reuse and remixing, so very different image categories do not get forced into one repeated prompt habit.
- The JSON puts `zh_prompt`, `en_prompt`, `gptimage2_prompt`, and `negative_prompt` first, then keeps diagnostic arrays short so the response is less likely to be clipped.
- For close recreation, the extractor now favors source fidelity over generic image quality. If the source is compressed, casual, flat, low-res, oddly cropped, or imperfect, those traits are preserved in the prompt instead of being cleaned up.
- The Chinese and English tabs show `Style fingerprint`, `Must keep`, and `Must avoid` so style drift is easy to catch before sending the prompt to GPTImage2.

## Validation

Run these from the extension root after editing code:

```powershell
node --check .\background.js
node --check .\content.js
node --check .\popup.js
Get-Content -Raw -Path .\manifest.json | ConvertFrom-Json | Out-Null
```

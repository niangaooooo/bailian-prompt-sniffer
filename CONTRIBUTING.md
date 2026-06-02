# Contributing

Thank you for your interest in Bailian Prompt Sniffer.

This project is an early-stage Chrome MV3 extension for structured image-to-prompt extraction. Contributions are welcome, especially around prompt quality, provider compatibility, documentation, and security review.

## Ways to contribute

You can help by:

- reporting bugs in image extraction, streaming, caching, or popup settings;
- adding examples of prompt drift or bad extraction results;
- improving prompt schema design and output stability;
- testing OpenAI-compatible vision providers;
- reviewing Chrome extension permissions, CSP, storage, and content-script behavior;
- improving README, setup instructions, or examples.

## Before opening an issue

Please include as much context as possible:

- browser and operating system;
- extension version or commit hash;
- provider base URL and model name, without your API key;
- whether the issue happens with all images or a specific image type;
- screenshots or sanitized sample outputs if helpful;
- browser console errors if available.

Do not paste API keys, private page content, private images, or secrets into issues.

## Pull request checklist

Before opening a pull request, please check:

```powershell
node --check .\background.js
node --check .\content.js
node --check .\popup.js
Get-Content -Raw -Path .\manifest.json | ConvertFrom-Json | Out-Null
```

For changes that affect image prompt extraction, please also manually test:

1. one normal photo;
2. one flat or cartoon-like illustration;
3. one low-resolution or compressed image;
4. one page with many images.

The output should be complete JSON and should not drift into a generic house style.

## Security-sensitive changes

Please be extra careful when changing:

- `manifest.json` permissions or host permissions;
- content-script injection behavior;
- CSP settings;
- API key storage or provider settings;
- network request behavior;
- image fetching and caching logic.

Security-sensitive pull requests should clearly explain why the change is needed and how user privacy is protected.

## Coding style

- Keep the extension lightweight and dependency-free unless a dependency is clearly justified.
- Prefer readable vanilla JavaScript.
- Avoid logging secrets or full private page content.
- Keep prompt schema changes versioned by updating `PROMPT_PROMPT_VERSION` when needed.
- Prefer explicit, conservative defaults over surprising automatic behavior.

## Project direction

The project aims to be useful for designers, creators, and developers who need transparent image-to-prompt workflows. The goal is not only to make outputs more beautiful, but to make them more faithful, reproducible, and debuggable.

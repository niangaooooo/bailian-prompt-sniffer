# Security Policy

Bailian Prompt Sniffer is a Chrome MV3 browser extension. It interacts with web pages, reads selected page and image context, stores user-provided API configuration locally, and sends requests to the model endpoint configured by the user. Because of this, security and privacy reviews are important parts of project maintenance.

## Supported versions

The project is currently early-stage. Security fixes should target the default branch unless a release branch is introduced later.

| Version | Supported |
| --- | --- |
| main | yes |

## Reporting a vulnerability

Please report suspected vulnerabilities privately when possible. If private reporting is not available, open a GitHub issue with a minimal description and avoid including secrets, private page content, private images, or exploitable details.

Useful information includes:

- affected file or feature;
- browser and operating system;
- whether the issue requires a malicious page, a malicious provider endpoint, or local access;
- steps to reproduce using non-sensitive sample data;
- expected impact.

## Security review scope

Security-sensitive areas include:

- Chrome extension permissions in `manifest.json`;
- host permissions and cross-origin image fetching;
- content script injection and page DOM access;
- Content Security Policy configuration;
- local storage of API keys and provider settings;
- streaming model responses into the in-page prompt panel;
- prompt/result caching by image hash;
- avoiding accidental logging of secrets or private page content.

## Current security posture

- API keys are configured by the user and stored locally in Chrome storage.
- Auto extraction is disabled by default.
- The extension sends image/page context only when the user triggers an extraction or page action.
- Image prompt results are cached locally to reduce repeated provider calls.
- Secrets should never be committed to the repository or pasted into issues.

## Responsible disclosure expectations

Please give the maintainer time to investigate and patch security issues before public disclosure. The goal is to protect users while keeping the project open and useful.

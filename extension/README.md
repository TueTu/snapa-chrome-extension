# Snapa Chrome Extension

React/Vite Chrome extension that lets each user chat with Gemini or OpenRouter using their own API key.

## How It Works

- The extension asks the user for a Gemini or OpenRouter API key in the popup.
- The key is stored in Chrome local extension storage on that user's device.
- Chat requests go directly from the extension to the selected AI provider.
- There is no Node/Express backend and no shared owner API key.
- Page text is only captured when the user chooses "Use this page".
- Selected text from the context menu is stored temporarily and cleared after the popup reads it.

## Release Notes

- The API key is saved locally in the browser extension's storage. Do not claim that it is encrypted.
- The extension needs `activeTab` and `scripting` so it can read the current page only after the user invokes the extension.
- Publish or link the privacy policy in [PRIVACY.md](./PRIVACY.md) before submitting to the Chrome Web Store.
- Test a fresh install, invalid API key, provider quota/rate limit, restricted Chrome page, context-menu selection, and switching tabs after using page context before publishing.

## Development

Install dependencies and build the extension:

```bash
npm install
npm run build
```

Load the generated `dist-release` folder in Chrome:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose "Load unpacked".
4. Select `extension/dist-release`.

Node.js is only needed for development/build commands. Users do not need a Node server running for the extension to work.

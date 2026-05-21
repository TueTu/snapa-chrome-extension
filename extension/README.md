# Snapa Chrome Extension

React/Vite Chrome extension that lets each user chat with Gemini using their own API key.

## How It Works

- The extension asks the user for a Gemini API key in the popup.
- The key is stored in Chrome local extension storage on that user's device.
- Chat requests go directly from the extension to the Gemini API.
- There is no Node/Express backend and no shared owner API key.

## Development

Install dependencies and build the extension:

```bash
npm install
npm run build
```

Load the generated `dist` folder in Chrome:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose "Load unpacked".
4. Select `extension/dist`.

Node.js is only needed for development/build commands. Users do not need a Node server running for the extension to work.

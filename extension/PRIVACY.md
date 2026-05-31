# Snapa Chat Privacy Policy

Last updated: May 31, 2026

Snapa Chat is a Chrome extension that lets users chat with Gemini or OpenRouter using their own API key. The extension does not run a developer-owned backend service.

## Data Stored Locally

Snapa Chat stores the following data in Chrome local extension storage on the user's device:

- The selected AI provider.
- The user's Gemini or OpenRouter API key.
- Recent chat history.
- Custom prompt templates created by the user.
- Temporary selected text from the context menu.
- Optional page context captured when the user chooses "Use this page".

API keys are stored locally by Chrome extension storage. They are not encrypted by Snapa Chat. Users can clear the saved API key from the extension.

## Data Sent To AI Providers

When the user sends a chat message, Snapa Chat sends the message and relevant recent conversation context directly from the browser extension to the selected provider.

If the user chooses "Use this page", Snapa Chat reads visible text from the active web page and may send relevant page text or a generated page summary to the selected provider so the provider can answer questions about that page.

Supported providers:

- Google Gemini API
- OpenRouter API

Snapa Chat does not sell user data, does not use user data for advertising, and does not share user data with third parties except as necessary to provide the user-requested AI chat feature through the selected provider.

## Page And Selection Access

Snapa Chat reads page content only after the user invokes the extension feature that uses the current page. Selected text from the context menu is stored temporarily so it can be inserted into the popup, then cleared after the popup reads it.

## Developer Access

The developer of Snapa Chat does not receive, store, or process user API keys, chat messages, selected text, or page content through a separate server controlled by the developer.

## Limited Use

The use of information received from Chrome APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Contact

For privacy questions, use the support contact listed on the Chrome Web Store listing or the public project repository.

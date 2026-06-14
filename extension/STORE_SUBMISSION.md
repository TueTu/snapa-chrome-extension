# Chrome Web Store Submission Copy

Use this copy in the Chrome Web Store Developer Dashboard for the next submission.

## Short Description

Use your own Gemini or OpenRouter API key to chat, send selected text, and ask about the current page.

## Full Description

Snapa Chat lets you chat from a Chrome extension popup using your own Gemini or OpenRouter API key. It is built for browser workflows where you want to ask about selected text or the current page without copying everything into another tab.

Features:

- Ask questions directly in the extension popup.
- Send highlighted page text to the chat from the right-click menu.
- Choose "Use this page" to ask questions about the current article or page.
- Save custom prompt instructions for repeated tasks.
- Store your selected provider, API key, chat history, and prompts locally in Chrome extension storage.
- Send API requests directly from your browser to Gemini or OpenRouter.

Snapa Chat does not run a developer-owned backend service. The developer does not receive or store your API key, chat messages, selected text, or page content.

Snapa Chat is not affiliated with, endorsed by, or sponsored by Google Gemini, OpenRouter, or Google Chrome.

The extension requires a user-provided Gemini API key or OpenRouter API key. It does not include a shared developer API key.

## Reviewer Notes

To test Snapa Chat:

1. Install the submitted extension package.
2. Open the extension popup.
3. Choose Gemini or OpenRouter.
4. Enter a valid reviewer-owned API key for the selected provider. The extension cannot complete a chat request without this key.
5. Send a chat message from the popup.
6. Select text on a normal https web page, right-click, and choose "Send to Snapa Chat".
7. Verify the selected text appears in the popup and can be sent by the reviewer.
8. Use the gear menu, choose "Use this page", and ask a question about the current page.
9. Use the gear menu to change provider, clear the saved key, or clear chat history.

The extension does not send notifications, does not send messages on behalf of users, does not manipulate ratings or installs, and is not a launcher for another app or web page.
The right-click menu only appears for selected text. Full-page context is captured only from the popup after the user chooses "Use this page".

## Changes In This Resubmission

- Updated the extension version to 1.0.1.
- Changed the context menu to appear only for selected text, matching the behavior it performs.
- Added setup-screen copy explaining that API requests go directly to the selected provider and that the API key is stored only in Chrome extension storage.
- Updated listing copy and reviewer notes to avoid generic keyword wording and to make the reviewer-owned API key requirement explicit.

## Appeal Text

Snapa Chat was rejected under Yellow Nickel / Spam. I believe this was a mistake.

The extension is not a duplicate submission, does not manipulate ratings, reviews, or installs, does not send notifications, and does not send messages on behalf of users.

Its core functionality is a Chrome extension popup that lets users chat with Gemini or OpenRouter using their own API key. It also provides browser-specific features: selected-text context menu support, optional user-triggered page context, local API key storage, chat history, and custom prompt templates.

The extension does not launch another app or web page as its sole purpose. API calls are made directly from the extension to the selected provider, and no developer-owned backend receives user API keys or chat content.

For this resubmission, I updated the listing metadata, reviewer notes, and extension UI to clearly describe the browser-specific functionality and avoid generic or excessive keyword wording. I also changed the context menu to appear only when text is selected, matching the feature behavior.

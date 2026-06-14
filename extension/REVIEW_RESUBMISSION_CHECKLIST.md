# Snapa Chat Chrome Web Store Resubmission Checklist

Use this checklist before submitting version 1.0.1.

## Package

1. Upload `snapa-chat-1.0.1.zip`.
2. Confirm the uploaded package shows manifest version `1.0.1`.
3. Confirm the zip contains these files at the root:
   - `manifest.json`
   - `background.js`
   - `index.html`
   - `icon.png`
   - `assets/`
4. Do not upload the project folder, `node_modules`, `src`, `coverage`, or the old `snapa-chat-1.0.zip`.

## Store Listing

1. Use the short description from `STORE_SUBMISSION.md`.
2. Use the full description from `STORE_SUBMISSION.md`.
3. Do not add keyword lists such as "AI, chatbot, Gemini, ChatGPT, OpenAI, assistant" unless they are used naturally in a sentence.
4. Do not include testimonials, fake user quotes, review requests, rating requests, install incentives, or promotional claims like "best", "number one", or "most powerful".
5. Do not imply affiliation with Google, Gemini, OpenRouter, Chrome, or any AI provider.

## Screenshots And Promo Images

1. Use screenshots of the real extension UI only.
2. Include screenshots for:
   - API provider setup.
   - Popup chat.
   - Selected-text right-click menu.
   - "Use this page" from the gear menu.
3. Do not use screenshots that show unrelated apps, generic AI artwork, fake testimonials, or repeated marketing keywords.

## Privacy

1. Publish or link the current `PRIVACY.md`.
2. In the dashboard privacy fields, disclose:
   - API key stored locally in Chrome extension storage.
   - Chat messages sent to the selected AI provider.
   - Selected text stored temporarily.
   - Page text read only when the user chooses "Use this page".
3. Do not claim the API key is encrypted by Snapa Chat.
4. Do not claim the developer cannot access data unless the listing also explains there is no developer-owned backend.

## Reviewer Notes

1. Paste the reviewer notes from `STORE_SUBMISSION.md`.
2. Clearly say the reviewer must provide their own Gemini or OpenRouter API key.
3. Tell the reviewer to test on a normal `https://` page, not `chrome://`, the Chrome Web Store, or a PDF page.
4. Mention the extension does not send notifications, manipulate reviews/installs, or send messages on behalf of users.

## Duplicate/Spam Risk

1. If you have any other Chrome Web Store item with similar Gemini/OpenRouter chat functionality, unpublish it or clearly differentiate this extension before resubmitting.
2. Do not submit the same extension under another developer account.
3. Do not ask friends/users for incentivized reviews, ratings, or installs.

## Final Local Test

1. Load `dist-release` as an unpacked extension.
2. Save a valid Gemini or OpenRouter API key.
3. Send a normal chat message.
4. Select text on an `https://` page, right-click, and choose "Send to Snapa Chat".
5. Use the gear menu and choose "Use this page".
6. Clear the saved key from the gear menu.
7. Confirm restricted pages show an error instead of breaking.

## Submit Or Appeal

1. If submitting a fixed revision, upload `snapa-chat-1.0.1.zip` and submit for review.
2. If appealing the existing rejection, use the appeal text in `STORE_SUBMISSION.md`.
3. Do not repeatedly resubmit unchanged packages.

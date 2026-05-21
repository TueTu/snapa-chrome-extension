chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "snapa-extension-action",
    title: "Send to AI Chat",
    contexts: ["selection", "page"]
  }, () => {
    // Ignore error if item already exists
    if (chrome.runtime.lastError) return;
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === "snapa-extension-action") {
    let selectedText = info.selectionText || "";
    
    // Limit to 200 words
    const words = selectedText.trim().split(/\s+/);
    if (words.length > 200) {
      selectedText = words.slice(0, 200).join(" ");
    }

    // Save to storage
    chrome.storage.local.set({ selectedText: selectedText });

    // Open the popup window immediately to preserve user gesture
    if (chrome.action.openPopup) {
      chrome.action.openPopup().catch(err => {
        console.error("Failed to open popup:", err);
        // Fallback to creating a new window if openPopup fails
        chrome.windows.create({
          url: chrome.runtime.getURL("index.html"),
          type: "popup",
          width: 400,
          height: 600
        });
      });
    } else {
      // Fallback for older browsers
      chrome.windows.create({
        url: chrome.runtime.getURL("index.html"),
        type: "popup",
        width: 400,
        height: 600
      });
    }
  }
});

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

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "snapa-extension-action") {
    let selectedText = info.selectionText || "";
    
    // Limit to 200 words
    const words = selectedText.trim().split(/\s+/);
    if (words.length > 200) {
      selectedText = words.slice(0, 200).join(" ");
    }

    // Save to storage so popup can read it
    chrome.storage.local.set({ selectedText: selectedText });
  }
});

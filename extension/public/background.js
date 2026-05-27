const CONTEXT_MENU_ID = "snapa-extension-action";
const POPUP_SIZE = { width: 400, height: 600 };
const MAX_SELECTED_WORDS = 200;

const trimSelectedText = (text) => {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, MAX_SELECTED_WORDS).join(" ");
};

const createChatWindow = () => {
  chrome.windows.create({
    url: chrome.runtime.getURL("index.html"),
    type: "popup",
    width: POPUP_SIZE.width,
    height: POPUP_SIZE.height,
  });
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create(
    {
      id: CONTEXT_MENU_ID,
      title: "Send to Snapa Chat",
      contexts: ["selection", "page"],
    },
    () => {
      if (chrome.runtime.lastError) return;
    },
  );
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;

  chrome.storage.local.set({ selectedText: trimSelectedText(info.selectionText) });

  if (!chrome.action.openPopup) {
    createChatWindow();
    return;
  }

  chrome.action.openPopup().catch((error) => {
    console.error("Failed to open popup:", error);
    createChatWindow();
  });
});

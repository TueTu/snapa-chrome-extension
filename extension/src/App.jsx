import { useState, useRef, useEffect, useLayoutEffect } from "react";
import "./index.css";

const API_CONFIG_STORAGE_KEY = "aiProviderConfig";
const CUSTOM_TEMPLATES_STORAGE_KEY = "customTemplates";
const CHAT_HISTORY_STORAGE_KEY = "chatHistory";
const PAGE_CONTEXT_STORAGE_KEY = "pageContext";
const LEGACY_GEMINI_KEY = "geminiApiKey";
const MAX_SAVED_MESSAGES = 30;
const PAGE_CONTEXT_TEXT_LIMIT = 12000;
const PAGE_CONTEXT_SUMMARY_TRIGGER = 12000;
const PAGE_CONTEXT_SUMMARY_INPUT_LIMIT = 18000;

const DEFAULT_TEMPLATES = [
  { id: "summarize", label: "Summarize", instruction: "Summarize" },
  {
    id: "explain",
    label: "Explain simply",
    instruction: "Explain this in simple words",
  },
  {
    id: "key-points",
    label: "Find key points",
    instruction: "Find the key points",
  },
];

const PROVIDERS = {
  gemini: {
    label: "Gemini",
    keyLabel: "Gemini API key",
    keyPlaceholder: "Paste your Gemini API key",
    preferredModels: [
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-2.0-flash",
      "gemini-1.5-flash",
    ],
  },
  openrouter: {
    label: "OpenRouter",
    keyLabel: "OpenRouter API key",
    keyPlaceholder: "Paste your OpenRouter API key",
    model: "openrouter/free",
  },
};

const getChromeStorage = () =>
  typeof chrome !== "undefined" && chrome.storage?.local
    ? chrome.storage.local
    : null;

const readStoredValue = (key) =>
  new Promise((resolve) => {
    const storage = getChromeStorage();

    if (storage) {
      storage.get(key, (data) => resolve(data?.[key] || ""));
      return;
    }

    resolve(localStorage.getItem(key) || "");
  });

const saveStoredValue = (key, value) =>
  new Promise((resolve) => {
    const storage = getChromeStorage();

    if (storage) {
      storage.set({ [key]: value }, resolve);
      return;
    }

    localStorage.setItem(key, value);
    resolve();
  });

const removeStoredValue = (key) =>
  new Promise((resolve) => {
    const storage = getChromeStorage();

    if (storage) {
      storage.remove(key, resolve);
      return;
    }

    localStorage.removeItem(key);
    resolve();
  });

const normalizeProvider = (provider) =>
  Object.keys(PROVIDERS).includes(provider) ? provider : "gemini";

class ApiAuthError extends Error {
  constructor(message, status = null, code = "") {
    super(message);
    this.name = "ApiAuthError";
    this.status = status;
    this.code = code;
  }
}

class ApiUsageError extends Error {
  constructor(message, status = null, code = "") {
    super(message);
    this.name = "ApiUsageError";
    this.status = status;
    this.code = code;
  }
}

const throwGeminiError = (response, data) => {
  const errorCode = data?.error?.status || data?.error?.code || "";

  if (response.status === 401 || response.status === 403) {
    throw new ApiAuthError(
      data?.error?.message || "Your Gemini API key is missing or invalid.",
      response.status,
      String(errorCode),
    );
  }

  if (response.status === 429) {
    throw new ApiUsageError(
      data?.error?.message ||
        "Your Gemini API key has reached its quota or rate limit.",
      response.status,
      String(errorCode),
    );
  }

  throw new Error(
    data?.error?.message || `Gemini request failed (${response.status})`,
  );
};

const cleanGeminiModelName = (modelName) =>
  String(modelName || "").replace(/^models\//, "");

const getBestGeminiModel = async (apiKey) => {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models",
    {
      headers: {
        "x-goog-api-key": apiKey,
      },
    },
  );

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throwGeminiError(response, data);
  }

  const generateContentModels = (data?.models || []).filter((model) =>
    model.supportedGenerationMethods?.includes("generateContent"),
  );

  const availableNames = generateContentModels.map((model) =>
    cleanGeminiModelName(model.name),
  );

  const preferredModel = PROVIDERS.gemini.preferredModels.find((model) =>
    availableNames.includes(model),
  );

  if (preferredModel) {
    return preferredModel;
  }

  const fallbackModel = availableNames.find(
    (model) =>
      model.includes("gemini") &&
      !model.includes("embedding") &&
      !model.includes("aqa"),
  );

  if (fallbackModel) {
    return fallbackModel;
  }

  throw new Error(
    "This Gemini API key does not have access to a text generation model.",
  );
};

const callGemini = async (apiKey, message) => {
  const model = await getBestGeminiModel(apiKey);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: message }],
          },
        ],
      }),
    },
  );

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throwGeminiError(response, data);
  }

  const reply = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();

  return reply || "Gemini returned an empty response.";
};

const callOpenRouter = async (apiKey, message) => {
  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://snapa.local",
        "X-Title": "Snapa AI",
      },
      body: JSON.stringify({
        model: PROVIDERS.openrouter.model,
        messages: [{ role: "user", content: message }],
      }),
    },
  );

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const errorCode = data?.error?.code || data?.error?.type || "";

    if (response.status === 401 || response.status === 403) {
      throw new ApiAuthError(
        data?.error?.message ||
          "Your OpenRouter API key is missing or invalid.",
        response.status,
        String(errorCode),
      );
    }

    if (
      response.status === 429 ||
      errorCode === "insufficient_quota" ||
      errorCode === "billing_not_active"
    ) {
      throw new ApiUsageError(
        data?.error?.message ||
          "Your OpenRouter API key has reached its quota or rate limit.",
        response.status,
        String(errorCode),
      );
    }

    throw new Error(
      data?.error?.message || `OpenRouter request failed (${response.status})`,
    );
  }

  const reply = data?.choices?.[0]?.message?.content?.trim();

  return reply || "OpenRouter returned an empty response.";
};

const callProvider = (config, message) => {
  if (config.provider === "openrouter") {
    return callOpenRouter(config.apiKey, message);
  }

  return callGemini(config.apiKey, message);
};

const getApiErrorMessage = (provider, error) => {
  const providerName = PROVIDERS[provider]?.label || "API";
  const providerMessage = error?.message ? ` ${error.message}` : "";

  if (error instanceof ApiAuthError) {
    return `${providerName} rejected this API key. It may be invalid, expired, revoked, or missing permission.${providerMessage}`;
  }

  if (error instanceof ApiUsageError) {
    return `${providerName} cannot use this key right now. It may be out of quota, rate limited, or missing billing access.${providerMessage}`;
  }

  return `${providerName} could not verify this key.${providerMessage || " Please try again."}`;
};

const validateApiConfig = (provider, apiKey) =>
  callProvider(
    { provider, apiKey },
    "Reply with exactly this word and no punctuation: OK",
  );

const normalizeMessages = (messages) =>
  messages
    .filter(
      (message) =>
        typeof message?.text === "string" &&
        (message.sender === "user" || message.sender === "ai"),
    )
    .map((message) => ({
      text: message.text,
      sender: message.sender,
      ...(message.error ? { error: true } : {}),
    }));

const getSavedMessages = (messages) =>
  normalizeMessages(messages)
    .filter((message) => !message.error)
    .slice(-MAX_SAVED_MESSAGES);

const formatMessageText = (text) =>
  String(text)
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+-\s+(?=\S)/g, "\n\n• ")
    .replace(/\s+•\s+(?=\S)/g, "\n\n• ")
    .replace(/^- /, "• ")
    .replace(/^•\s*/gm, "• ")
    .replace(/\n• /g, "\n\n• ")
    .replace(/\n{4,}/g, "\n\n")
    .trim();

const getActiveTab = () =>
  new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.tabs?.query) {
      reject(new Error("Page capture is only available inside Chrome."));
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (chrome.runtime?.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!tab?.id) {
        reject(new Error("No active tab found."));
        return;
      }

      resolve(tab);
    });
  });

const extractPageContentFromTab = async () => {
  const tab = await getActiveTab();

  if (!/^https?:\/\//.test(tab.url || "")) {
    throw new Error("This page cannot be read. Open a normal web article and try again.");
  }

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const getMeta = (names) => {
        for (const name of names) {
          const selector = `meta[name="${name}"], meta[property="${name}"]`;
          const value = document.querySelector(selector)?.getAttribute("content");
          if (value) return value.trim();
        }
        return "";
      };

      const clone = document.body.cloneNode(true);
      clone
        .querySelectorAll("script, style, nav, footer, header, aside, form, noscript, svg")
        .forEach((element) => element.remove());

      const contentRoot =
        clone.querySelector("article") ||
        clone.querySelector("main") ||
        clone.querySelector('[role="main"]') ||
        clone;

      const text = (contentRoot.innerText || "")
        .replace(/\s+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();

      return {
        title:
          getMeta(["og:title", "twitter:title"]) ||
          document.title ||
          "Untitled page",
        author: getMeta(["author", "article:author", "byl", "parsely-author"]),
        url: location.href,
        text,
      };
    },
  });

  const page = result?.result;

  if (!page?.text || page.text.length < 120) {
    throw new Error("I could not find enough article text on this page.");
  }

  return page;
};

const buildChatPrompt = ({ messages, pageContext, userQuestion }) => {
  const recentConversation = normalizeMessages(messages)
    .filter((message) => !message.error)
    .slice(-10)
    .map((message) => `${message.sender === "user" ? "User" : "Assistant"}: ${message.text}`)
    .join("\n\n");

  const pageText = pageContext
    ? pageContext.summary
      ? `Page context:\nTitle: ${pageContext.title}\nAuthor: ${pageContext.author || "Unknown"}\nURL: ${pageContext.url}\n\nArticle summary:\n${pageContext.summary}\n\nArticle excerpt:\n${pageContext.excerpt}`
      : `Page context:\nTitle: ${pageContext.title}\nAuthor: ${pageContext.author || "Unknown"}\nURL: ${pageContext.url}\n\nArticle text:\n${pageContext.excerpt}`
    : "";

  return `You are Snapa Chat.
Answer in plain, precise, easy-to-read text.
Use recent conversation to understand references like "that", "it", "above", or "this".
If page context is provided, answer from that page. If the page does not mention it, say so.
Format answers like this:
Short answer first in 1-2 lines, maximum 25 words.
Blank line.
Use bullet lines with "•" when listing points.
Each bullet must start on a new line.
Add one blank line between bullet points.
Never put multiple bullet points in one paragraph.
Do not use "•" as an inline separator inside a sentence.
Keep each bullet under 18 words.
Blank line.
Add one short closing line only if useful.
Avoid long paragraphs and dense blocks.
Do not use markdown bold markers like **.

${recentConversation ? `Recent conversation:\n${recentConversation}\n\n` : ""}${pageText ? `${pageText}\n\n` : ""}User question:\n${userQuestion}`;
};

function App() {
  const [messages, setMessages] = useState([
    { text: "Ask me anything.", sender: "ai" },
  ]);
  const [input, setInput] = useState("");
  const [provider, setProvider] = useState("gemini");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);
  const [isChatHistoryLoaded, setIsChatHistoryLoaded] = useState(false);
  const [isEditingConfig, setIsEditingConfig] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [confirmAction, setConfirmAction] = useState(null);
  const [isCustomPromptOpen, setIsCustomPromptOpen] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [customTemplates, setCustomTemplates] = useState([]);
  const [isTemplateMenuOpen, setIsTemplateMenuOpen] = useState(false);
  const [isProviderMenuOpen, setIsProviderMenuOpen] = useState(false);
  const [pageContext, setPageContext] = useState(null);
  const [isPageContextLoading, setIsPageContextLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // Default to system preference or dark mode
  const [theme, setTheme] = useState(() => {
    if (typeof window !== "undefined") {
      return (
        localStorage.getItem("theme") ||
        (window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light")
      );
    }
    return "dark";
  });

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    readStoredValue(API_CONFIG_STORAGE_KEY).then(async (storedConfigValue) => {
      let nextConfig = null;

      if (storedConfigValue) {
        try {
          nextConfig = JSON.parse(storedConfigValue);
        } catch {
          nextConfig = null;
        }
      }

      if (!nextConfig?.apiKey) {
        const legacyGeminiKey = await readStoredValue(LEGACY_GEMINI_KEY);
        if (legacyGeminiKey) {
          nextConfig = { provider: "gemini", apiKey: legacyGeminiKey };
          await saveStoredValue(
            API_CONFIG_STORAGE_KEY,
            JSON.stringify(nextConfig),
          );
          await removeStoredValue(LEGACY_GEMINI_KEY);
        }
      }

      const nextProvider = normalizeProvider(nextConfig?.provider);
      const nextApiKey = nextConfig?.apiKey || "";

      setProvider(nextProvider);
      setApiKey(nextApiKey);
      setApiKeyInput(nextApiKey);
      setIsConfigLoaded(true);
    });

    readStoredValue(CHAT_HISTORY_STORAGE_KEY).then((storedHistory) => {
      if (!storedHistory) {
        setIsChatHistoryLoaded(true);
        return;
      }

      try {
        const parsedHistory = JSON.parse(storedHistory);
        if (Array.isArray(parsedHistory)) {
          const nextMessages = getSavedMessages(parsedHistory);
          if (nextMessages.length > 0) {
            setMessages(nextMessages);
          }
        }
      } catch {
        // Ignore invalid stored history and start fresh.
      } finally {
        setIsChatHistoryLoaded(true);
      }
    });

    readStoredValue(CUSTOM_TEMPLATES_STORAGE_KEY).then((storedTemplates) => {
      if (!storedTemplates) return;

      try {
        const parsedTemplates = JSON.parse(storedTemplates);
        if (Array.isArray(parsedTemplates)) {
          setCustomTemplates(
            parsedTemplates.filter(
              (template) =>
                typeof template?.id === "string" &&
                typeof template?.label === "string" &&
                typeof template?.instruction === "string",
            ),
          );
        }
      } catch {
        setCustomTemplates([]);
      }
    });

    readStoredValue(PAGE_CONTEXT_STORAGE_KEY).then((storedContext) => {
      if (!storedContext) return;

      try {
        const parsedContext = JSON.parse(storedContext);
        if (
          typeof parsedContext?.title === "string" &&
          typeof parsedContext?.url === "string" &&
          typeof parsedContext?.excerpt === "string"
        ) {
          setPageContext(parsedContext);
        }
      } catch {
        setPageContext(null);
      }
    });

    // Check for selected text from context menu
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get("selectedText", (data) => {
        if (data && data.selectedText) {
          const text =
            typeof data.selectedText === "string"
              ? data.selectedText
              : String(data.selectedText);
          setInput(text);
          // Clear storage after reading
          chrome.storage.local.remove("selectedText");
        }
      });
    }
  }, []);

  useEffect(() => {
    if (!isChatHistoryLoaded) return;

    saveStoredValue(
      CHAT_HISTORY_STORAGE_KEY,
      JSON.stringify(getSavedMessages(messages)),
    );
  }, [isChatHistoryLoaded, messages]);

  const saveApiConfig = async () => {
    const trimmedApiKey = apiKeyInput.trim();

    setIsSavingConfig(true);
    setSetupError("");

    try {
      await validateApiConfig(provider, trimmedApiKey);
      await saveStoredValue(
        API_CONFIG_STORAGE_KEY,
        JSON.stringify({ provider, apiKey: trimmedApiKey }),
      );
      setApiKey(trimmedApiKey);
      setIsEditingConfig(false);
      setMessages((prev) => [
        ...prev,
        {
          text: `${PROVIDERS[provider].label} is ready. What do you want to ask?`,
          sender: "ai",
        },
      ]);
    } catch (error) {
      console.error("API key validation failed:", error);
      setSetupError(getApiErrorMessage(provider, error));
      setApiKey("");
      await removeStoredValue(API_CONFIG_STORAGE_KEY);
      await removeStoredValue(LEGACY_GEMINI_KEY);
    } finally {
      setIsSavingConfig(false);
    }
  };

  const clearApiConfig = async () => {
    setIsSavingConfig(true);
    await removeStoredValue(API_CONFIG_STORAGE_KEY);
    await removeStoredValue(LEGACY_GEMINI_KEY);
    setApiKey("");
    setApiKeyInput("");
    setSetupError("");
    setIsEditingConfig(true);
    setIsSavingConfig(false);
  };

  const savePageContext = async (nextContext) => {
    setPageContext(nextContext);
    await saveStoredValue(PAGE_CONTEXT_STORAGE_KEY, JSON.stringify(nextContext));
  };

  const openConfirm = (action) => {
    setIsProviderMenuOpen(false);
    setConfirmAction(action);
  };

  const closeConfirm = () => {
    if (isSavingConfig) return;
    setConfirmAction(null);
  };

  const closeCustomPrompt = () => {
    setIsCustomPromptOpen(false);
    setCustomPrompt("");
  };

  const saveCustomTemplates = async (nextTemplates) => {
    setCustomTemplates(nextTemplates);
    await saveStoredValue(
      CUSTOM_TEMPLATES_STORAGE_KEY,
      JSON.stringify(nextTemplates),
    );
  };

  const confirmProviderAction = async () => {
    if (confirmAction === "change") {
      setApiKeyInput(apiKey);
      setSetupError("");
      setIsEditingConfig(true);
      setConfirmAction(null);
      return;
    }

    if (confirmAction === "clear") {
      await clearApiConfig();
      setConfirmAction(null);
    }

    if (confirmAction === "clear-chat") {
      await removeStoredValue(CHAT_HISTORY_STORAGE_KEY);
      setMessages([{ text: "Ask me anything.", sender: "ai" }]);
      setConfirmAction(null);
    }
  };

  const useCurrentPage = async () => {
    if (!apiKey) {
      setMessages((prev) => [
        ...prev,
        {
          text: "Please save your API key before using page context.",
          sender: "ai",
          error: true,
        },
      ]);
      return;
    }

    setIsProviderMenuOpen(false);
    setIsPageContextLoading(true);

    try {
      const page = await extractPageContentFromTab();
      const excerpt = page.text.slice(0, PAGE_CONTEXT_TEXT_LIMIT);
      let summary = "";

      if (page.text.length > PAGE_CONTEXT_SUMMARY_TRIGGER) {
        summary = await callProvider(
          { provider, apiKey },
          `Summarize this article for question answering. Include the main claims, important names, dates, evidence, and conclusions. Keep it concise but specific.\n\nTitle: ${page.title}\nAuthor: ${page.author || "Unknown"}\nURL: ${page.url}\n\nArticle:\n${page.text.slice(0, PAGE_CONTEXT_SUMMARY_INPUT_LIMIT)}`,
        );
      }

      const nextContext = {
        title: page.title,
        author: page.author,
        url: page.url,
        excerpt,
        summary,
        capturedAt: new Date().toISOString(),
      };

      await savePageContext(nextContext);
      setMessages((prev) => [
        ...prev,
        {
          text: `Now using this page: ${page.title}`,
          sender: "ai",
        },
      ]);
    } catch (error) {
      console.error("Page capture failed:", error);
      setMessages((prev) => [
        ...prev,
        {
          text: error.message || "I could not use this page.",
          sender: "ai",
          error: true,
        },
      ]);
    } finally {
      setIsPageContextLoading(false);
    }
  };

  const sendMessage = async (textOverride = null) => {
    const textToSend = typeof textOverride === "string" ? textOverride : input;

    if (!String(textToSend).trim()) return;
    if (!apiKey) {
      setMessages((prev) => [
        ...prev,
        {
          text: "Please choose a provider and save your API key before sending a message.",
          sender: "ai",
          error: true,
        },
      ]);
      return;
    }

    const userMessage = { text: textToSend, sender: "user" };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const promptToSend = buildChatPrompt({
        messages,
        pageContext,
        userQuestion: textToSend,
      });
      const finalText = await callProvider({ provider, apiKey }, promptToSend);
      const aiMessage = { text: finalText, sender: "ai" };
      setMessages((prev) => [...prev, aiMessage]);
    } catch (error) {
      console.error("Error:", error);

      if (error instanceof ApiAuthError) {
        await removeStoredValue(API_CONFIG_STORAGE_KEY);
        await removeStoredValue(LEGACY_GEMINI_KEY);
        setApiKey("");
        setApiKeyInput("");
        setIsEditingConfig(true);
        setSetupError(getApiErrorMessage(provider, error));
        setMessages((prev) => [
          ...prev,
          {
            text: getApiErrorMessage(provider, error),
            sender: "ai",
            error: true,
          },
        ]);
        return;
      }

      const errorMessage = error.message || "Sorry, something went wrong.";
      setMessages((prev) => [
        ...prev,
        { text: String(errorMessage), sender: "ai", error: true },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const applyTemplate = (template) => {
    setIsTemplateMenuOpen(false);
    if (!input.trim()) {
      setInput(`${template.instruction}: `);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }

    const prompt = `${template.instruction}:\n\n"${input}"`;
    sendMessage(prompt);
  };

  const addCustomTemplate = async () => {
    const instruction = customPrompt.trim();

    if (!instruction) return;

    const nextTemplate = {
      id: `custom-${Date.now()}`,
      label: instruction.length > 34 ? `${instruction.slice(0, 31)}...` : instruction,
      instruction,
    };

    await saveCustomTemplates([...customTemplates, nextTemplate]);
    closeCustomPrompt();
    setIsTemplateMenuOpen(true);
  };

  const deleteCustomTemplate = async (templateId) => {
    await saveCustomTemplates(
      customTemplates.filter((template) => template.id !== templateId),
    );
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      sendMessage();
    }
  };

  const activeProvider = PROVIDERS[provider];
  const shouldShowSetup = isConfigLoaded && (!apiKey || isEditingConfig);
  const confirmDetails =
    confirmAction === "clear"
      ? {
          title: "Clear API key?",
          message:
            "This removes the saved key from this browser. You will need to add an API key again before chatting.",
          confirmLabel: "Clear key",
          danger: true,
        }
      : confirmAction === "clear-chat"
        ? {
            title: "Clear chat?",
            message:
              "This removes the saved conversation from this browser. Your API key and custom comments stay saved.",
            confirmLabel: "Clear chat",
            danger: true,
          }
      : {
          title: "Change provider?",
          message:
            "This opens setup so you can change the provider or replace the saved API key.",
          confirmLabel: "Continue",
          danger: false,
        };

  if (!isConfigLoaded || !isChatHistoryLoaded) {
    return (
      <div className="app-container">
        <div className="loading-screen">Loading...</div>
      </div>
    );
  }

  if (shouldShowSetup) {
    return (
      <div className="app-container setup-screen">
        <header className="chat-header">
          <div className="header-content">
            <img className="app-logo" src="/icon.png" alt="" aria-hidden="true" />
            <div className="header-title">
              <h1>Snapa Chat</h1>
              <span className="key-status">Setup</span>
            </div>
          </div>
          <button
            onClick={toggleTheme}
            className="theme-toggle"
            aria-label="Toggle theme"
          >
            {theme === "light" ? (
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
              </svg>
            )}
          </button>
        </header>

        <main className="setup-panel" aria-label="API setup">
          <div className="setup-copy">
            <h2>Connect your AI provider</h2>
            <p>Choose the API you want to use, then save your key to start chatting.</p>
          </div>

          <div className="provider-grid" role="radiogroup" aria-label="AI provider">
            {Object.entries(PROVIDERS).map(([value, item]) => (
              <button
                key={value}
                type="button"
                className={`provider-option ${provider === value ? "selected" : ""}`}
                onClick={() => {
                  setProvider(value);
                  setSetupError("");
                }}
                role="radio"
                aria-checked={provider === value}
                disabled={isSavingConfig}
              >
                <span>{item.label}</span>
              </button>
            ))}
          </div>

          <label className="setup-label" htmlFor="setup-api-key">
            {activeProvider.keyLabel}
          </label>
          <input
            id="setup-api-key"
            type="password"
            value={apiKeyInput}
            onChange={(e) => {
              setApiKeyInput(e.target.value);
              setSetupError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && apiKeyInput.trim()) saveApiConfig();
            }}
            placeholder={activeProvider.keyPlaceholder}
            disabled={isSavingConfig}
          />

          {setupError && (
            <div className="setup-error" role="alert">
              {setupError}
            </div>
          )}

          <div className="setup-actions">
            {apiKey && (
              <button
                type="button"
                className="key-btn"
                onClick={() => {
                  setApiKeyInput(apiKey);
                  setSetupError("");
                  setIsEditingConfig(false);
                }}
                disabled={isSavingConfig}
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              className="key-btn primary setup-save"
              onClick={saveApiConfig}
              disabled={isSavingConfig || !apiKeyInput.trim()}
            >
              {isSavingConfig ? "Checking..." : "Save and start chat"}
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="chat-header">
        <div className="header-content">
          <img className="app-logo" src="/icon.png" alt="" aria-hidden="true" />
          <div className="header-title">
            <h1>Snapa Chat</h1>
            <span className={`key-status ${apiKey ? "ready" : ""}`}>
              {activeProvider.label} ready
            </span>
          </div>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="provider-icon-btn"
            onClick={() => setIsProviderMenuOpen((isOpen) => !isOpen)}
            aria-label="Manage provider"
            aria-expanded={isProviderMenuOpen}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.91 10H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
            </svg>
          </button>
          {isProviderMenuOpen && (
            <>
              <button
                type="button"
                className="provider-menu-close-area"
                onClick={() => setIsProviderMenuOpen(false)}
                aria-label="Close provider menu"
              />
              <div className="provider-action-list" role="menu">
                <button
                  type="button"
                  className="provider-action-item"
                  onClick={useCurrentPage}
                  role="menuitem"
                  disabled={isPageContextLoading}
                >
                  <span>{isPageContextLoading ? "Reading page..." : "Use this page"}</span>
                  <small>Ask about current article</small>
                </button>
                <button
                  type="button"
                  className="provider-action-item"
                  onClick={() => openConfirm("change")}
                  role="menuitem"
                >
                  <span>Change provider</span>
                  <small>Use another API key</small>
                </button>
              <button
                type="button"
                className="provider-action-item danger"
                onClick={() => openConfirm("clear")}
                role="menuitem"
              >
                <span>Clear saved key</span>
                <small>Return to setup</small>
              </button>
              <button
                type="button"
                className="provider-action-item danger"
                onClick={() => openConfirm("clear-chat")}
                role="menuitem"
              >
                <span>Clear chat</span>
                <small>Keep provider settings</small>
              </button>
            </div>
          </>
          )}
        </div>
        <button
          onClick={toggleTheme}
          className="theme-toggle"
          aria-label="Toggle theme"
        >
          {theme === "light" ? (
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              stroke="currentColor"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              stroke="currentColor"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="5"></circle>
              <line x1="12" y1="1" x2="12" y2="3"></line>
              <line x1="12" y1="21" x2="12" y2="23"></line>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
              <line x1="1" y1="12" x2="3" y2="12"></line>
              <line x1="21" y1="12" x2="23" y2="12"></line>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
            </svg>
          )}
        </button>
      </header>

      {confirmAction && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeConfirm();
          }}
        >
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <h2 id="confirm-title">{confirmDetails.title}</h2>
            <p>{confirmDetails.message}</p>
            <div className="confirm-actions">
              <button
                type="button"
                className="key-btn"
                onClick={closeConfirm}
                disabled={isSavingConfig}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`key-btn ${confirmDetails.danger ? "danger" : "primary"}`}
                onClick={confirmProviderAction}
                disabled={isSavingConfig}
              >
                {isSavingConfig ? "Working..." : confirmDetails.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      )}

      {isCustomPromptOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeCustomPrompt();
          }}
        >
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="custom-prompt-title"
          >
            <h2 id="custom-prompt-title">Add custom instruction</h2>
            <p>Type what you want the AI to do with your text.</p>
            <input
              className="custom-prompt-input"
              type="text"
              value={customPrompt}
              onChange={(event) => setCustomPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addCustomTemplate();
              }}
              placeholder="Example: Make this more friendly"
              autoFocus
            />
            <div className="confirm-actions">
              <button type="button" className="key-btn" onClick={closeCustomPrompt}>
                Cancel
              </button>
              <button
                type="button"
                className="key-btn primary"
                onClick={addCustomTemplate}
                disabled={!customPrompt.trim()}
              >
                Save
              </button>
            </div>
          </section>
        </div>
      )}

      <div className="chat-window">
        {pageContext && (
          <div className="page-context-pill" title={pageContext.url}>
            <span>Using page</span>
            <strong>{pageContext.title}</strong>
          </div>
        )}
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`message ${msg.sender} ${msg.error ? "error" : ""}`}
          >
            <div className="message-content">
              {formatMessageText(
                typeof msg.text === "object" ? JSON.stringify(msg.text) : msg.text,
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="message ai">
            <div className="message-content">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-area">
        <div className="template-selector">
          <button
            type="button"
            className="template-menu-btn"
            onClick={() => setIsTemplateMenuOpen((isOpen) => !isOpen)}
            disabled={isLoading || !apiKey}
          >
            <span>
              Select a template...
            </span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          {isTemplateMenuOpen && (
            <div className="template-menu">
              {DEFAULT_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="template-item"
                  onClick={() => applyTemplate(template)}
                >
                  {template.label}
                </button>
              ))}

              {customTemplates.length > 0 && <div className="template-divider" />}

              {customTemplates.map((template) => (
                <div className="template-custom-item" key={template.id}>
                  <button
                    type="button"
                    className="template-item custom"
                    onClick={() => applyTemplate(template)}
                  >
                    {template.label}
                  </button>
                  <button
                    type="button"
                    className="template-delete-btn"
                    onClick={() => deleteCustomTemplate(template.id)}
                    aria-label={`Delete ${template.label}`}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}

              <button
                type="button"
                className="template-add-row"
                onClick={() => {
                  setIsTemplateMenuOpen(false);
                  setIsCustomPromptOpen(true);
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add custom comment
              </button>
            </div>
          )}
          <button
            type="button"
            className="template-menu-close-area"
            onClick={() => setIsTemplateMenuOpen(false)}
            hidden={!isTemplateMenuOpen}
            aria-label="Close template menu"
          >
          </button>
        </div>
        <div className="input-row">
          <div className="input-wrapper">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Type a message..."
              disabled={isLoading || !apiKey}
            />
          </div>
          <button
            className="send-btn"
            onClick={sendMessage}
            disabled={isLoading || !apiKey || !input.trim()}
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./index.css";

const STORAGE_KEYS = {
  apiConfig: "aiProviderConfig",
  chatHistory: "chatHistory",
  customTemplates: "customTemplates",
  legacyGeminiKey: "geminiApiKey",
  pageContext: "pageContext",
};

const MAX_SAVED_MESSAGES = 30;
const PAGE_TEXT_LIMIT = 9000;
const PAGE_PROMPT_LIMIT = 7000;
const PAGE_SUMMARY_TRIGGER = 9000;
const PAGE_SUMMARY_INPUT_LIMIT = 12000;
const REQUEST_TIMEOUT_MS = 25000;
const MODEL_TIMEOUT_MS = 10000;
const CHAT_PROMPT_MESSAGE_LIMIT = 6;
const CHAT_PROMPT_MESSAGE_TEXT_LIMIT = 700;

const DEFAULT_MESSAGES = [{ text: "Ask me anything.", sender: "ai" }];

const DEFAULT_TEMPLATES = [
  { id: "summarize", label: "Summarize", instruction: "Summarize" },
  {
    id: "explain",
    label: "Explain simply",
    instruction: "Explain this in simple words",
  },
  { id: "key-points", label: "Find key points", instruction: "Find the key points" },
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
    fallbackModel: "google/gemini-2.0-flash-exp:free",
    preferredModels: [
      "google/gemini-2.0-flash-exp:free",
      "google/gemini-flash-1.5-8b:free",
      "meta-llama/llama-3.2-3b-instruct:free",
      "mistralai/mistral-7b-instruct:free",
    ],
  },
};

const modelCache = {
  gemini: new Map(),
  openrouter: new Map(),
};

const getStorage = () =>
  typeof chrome !== "undefined" && chrome.storage?.local
    ? chrome.storage.local
    : null;

const readStoredValue = (key) =>
  new Promise((resolve) => {
    const storage = getStorage();
    if (!storage) {
      resolve(localStorage.getItem(key) || "");
      return;
    }

    storage.get(key, (data) => resolve(data?.[key] || ""));
  });

const saveStoredValue = (key, value) =>
  new Promise((resolve) => {
    const storage = getStorage();
    if (!storage) {
      localStorage.setItem(key, value);
      resolve();
      return;
    }

    storage.set({ [key]: value }, resolve);
  });

const removeStoredValue = (key) =>
  new Promise((resolve) => {
    const storage = getStorage();
    if (!storage) {
      localStorage.removeItem(key);
      resolve();
      return;
    }

    storage.remove(key, resolve);
  });

const parseJson = (value, fallback) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

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

const normalizeProvider = (provider) =>
  Object.keys(PROVIDERS).includes(provider) ? provider : "gemini";

const truncateText = (text, limit) => {
  const value = String(text || "").trim();
  return value.length > limit ? `${value.slice(0, limit).trim()}...` : value;
};

const normalizeUrlForContext = (url) => {
  try {
    const nextUrl = new URL(url);
    nextUrl.hash = "";
    return nextUrl.toString();
  } catch {
    return String(url || "");
  }
};

const requestJson = async (url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    return { response, data };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("The API request timed out. Please try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

const throwGeminiError = (response, data) => {
  const code = String(data?.error?.status || data?.error?.code || "");

  if (response.status === 401 || response.status === 403) {
    throw new ApiAuthError(
      data?.error?.message || "Your Gemini API key is missing or invalid.",
      response.status,
      code,
    );
  }

  if (response.status === 429) {
    throw new ApiUsageError(
      data?.error?.message || "Your Gemini API key has reached its quota or rate limit.",
      response.status,
      code,
    );
  }

  throw new Error(data?.error?.message || `Gemini request failed (${response.status})`);
};

const getBestGeminiModel = async (apiKey) => {
  if (modelCache.gemini.has(apiKey)) return modelCache.gemini.get(apiKey);

  const { response, data } = await requestJson(
    "https://generativelanguage.googleapis.com/v1beta/models",
    { headers: { "x-goog-api-key": apiKey } },
    MODEL_TIMEOUT_MS,
  );

  if (!response.ok) throwGeminiError(response, data);

  const availableModels = (data?.models || [])
    .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
    .map((model) => String(model.name || "").replace(/^models\//, ""));

  const model =
    PROVIDERS.gemini.preferredModels.find((model) => availableModels.includes(model)) ||
    availableModels.find(
      (model) =>
        model.includes("gemini") &&
        !model.includes("embedding") &&
        !model.includes("aqa"),
    );

  if (!model) {
    throw new Error("This Gemini API key does not have access to a text generation model.");
  }

  modelCache.gemini.set(apiKey, model);
  return model;
};

const callGemini = async (apiKey, message, options = {}) => {
  const model = await getBestGeminiModel(apiKey);
  const { response, data } = await requestJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: message }] }],
        generationConfig: {
          temperature: options.temperature ?? 0.25,
          maxOutputTokens: options.maxOutputTokens ?? 500,
        },
      }),
    },
  );

  if (!response.ok) throwGeminiError(response, data);

  const reply = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();

  return reply || "Gemini returned an empty response.";
};

const getBestOpenRouterModel = async (apiKey) => {
  if (modelCache.openrouter.has(apiKey)) return modelCache.openrouter.get(apiKey);

  try {
    const { response, data } = await requestJson(
      "https://openrouter.ai/api/v1/models",
      { headers: { Authorization: `Bearer ${apiKey}` } },
      MODEL_TIMEOUT_MS,
    );

    if (response.ok) {
      const availableModels = (data?.data || [])
        .map((model) => String(model.id || ""))
        .filter(Boolean);
      const model =
        PROVIDERS.openrouter.preferredModels.find((item) => availableModels.includes(item)) ||
        availableModels.find((item) => item.endsWith(":free")) ||
        PROVIDERS.openrouter.fallbackModel;

      modelCache.openrouter.set(apiKey, model);
      return model;
    }
  } catch (error) {
    console.warn("OpenRouter model lookup failed:", error);
  }

  modelCache.openrouter.set(apiKey, PROVIDERS.openrouter.fallbackModel);
  return PROVIDERS.openrouter.fallbackModel;
};

const callOpenRouter = async (apiKey, message, options = {}) => {
  const model = await getBestOpenRouterModel(apiKey);
  const { response, data } = await requestJson("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://snapa.local",
      "X-Title": "Snapa Chat",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: message }],
      temperature: options.temperature ?? 0.25,
      max_tokens: options.maxOutputTokens ?? 500,
    }),
  });

  if (!response.ok) {
    const code = String(data?.error?.code || data?.error?.type || "");
    if (response.status === 401 || response.status === 403) {
      throw new ApiAuthError(
        data?.error?.message || "Your OpenRouter API key is missing or invalid.",
        response.status,
        code,
      );
    }

    if (
      response.status === 429 ||
      code === "insufficient_quota" ||
      code === "billing_not_active"
    ) {
      throw new ApiUsageError(
        data?.error?.message || "Your OpenRouter API key has reached its quota or rate limit.",
        response.status,
        code,
      );
    }

    throw new Error(data?.error?.message || `OpenRouter request failed (${response.status})`);
  }

  return data?.choices?.[0]?.message?.content?.trim() || "OpenRouter returned an empty response.";
};

const callProvider = ({ provider, apiKey }, message, options = {}) =>
  provider === "openrouter"
    ? callOpenRouter(apiKey, message, options)
    : callGemini(apiKey, message, options);

const getApiErrorMessage = (provider, error) => {
  const providerName = PROVIDERS[provider]?.label || "API";
  const detail = error?.message ? ` ${error.message}` : "";

  if (error instanceof ApiAuthError) {
    return `${providerName} rejected this API key. It may be invalid, expired, revoked, or missing permission.${detail}`;
  }

  if (error instanceof ApiUsageError) {
    return `${providerName} cannot use this key right now. It may be out of quota, rate limited, or missing billing access.${detail}`;
  }

  return `${providerName} could not verify this key.${detail || " Please try again."}`;
};

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
    .replace(/\s+(\d+\.)\s+(?=\S)/g, "\n\n$1 ")
    .replace(/\s+-\s+(?=\S)/g, "\n\n- ")
    .replace(/\s+\u2022\s+(?=\S)/g, "\n\n- ")
    .replace(/^- /, "- ")
    .replace(/^\u2022\s*/gm, "- ")
    .replace(/\n(\d+\.) /g, "\n\n$1 ")
    .replace(/\n- /g, "\n\n- ")
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

const createPageContext = async ({ provider, apiKey }) => {
  const page = await extractPageContentFromTab();
  const excerpt = page.text.slice(0, PAGE_TEXT_LIMIT);
  let summary = "";

  if (page.text.length > PAGE_SUMMARY_TRIGGER) {
    summary = await callProvider(
      { provider, apiKey },
      `Summarize this article for fast question answering.
Use short ordered lines.
Keep important names, dates, claims, evidence, and conclusions.

Title: ${page.title}
Author: ${page.author || "Unknown"}
URL: ${page.url}

Article:
${page.text.slice(0, PAGE_SUMMARY_INPUT_LIMIT)}`,
      { maxOutputTokens: 650 },
    );
  }

  return {
    title: page.title,
    author: page.author,
    url: page.url,
    excerpt,
    summary,
    capturedAt: new Date().toISOString(),
  };
};

const buildChatPrompt = ({ messages, pageContext, userQuestion }) => {
  const recentConversation = normalizeMessages(messages)
    .filter((message) => !message.error)
    .slice(-CHAT_PROMPT_MESSAGE_LIMIT)
    .map(
      (message) =>
        `${message.sender === "user" ? "User" : "Assistant"}: ${truncateText(
          message.text,
          CHAT_PROMPT_MESSAGE_TEXT_LIMIT,
        )}`,
    )
    .join("\n\n");

  const pageText = pageContext
    ? pageContext.summary
      ? `Page context:
Title: ${pageContext.title}
Author: ${pageContext.author || "Unknown"}
URL: ${pageContext.url}

Article summary:
${truncateText(pageContext.summary, PAGE_PROMPT_LIMIT)}

Article excerpt:
${truncateText(pageContext.excerpt, 2500)}`
      : `Page context:
Title: ${pageContext.title}
Author: ${pageContext.author || "Unknown"}
URL: ${pageContext.url}

Article text:
${truncateText(pageContext.excerpt, PAGE_PROMPT_LIMIT)}`
    : "";

  return `You are Snapa Chat.
Answer in plain, precise, fast-to-read text.
Use recent conversation to understand references like "that", "it", "above", or "this".
If page context is provided, answer from that page. If the page does not mention it, say so.
Use this format:
Short answer first, maximum 20 words.

1. First point

2. Second point

3. Third point

Use numbered order for steps, reasons, or lists.
Put a blank line between each point.
Keep each point under 18 words.
Add one short closing line only if useful.
Avoid long paragraphs, dense blocks, markdown tables, and markdown bold markers.

${recentConversation ? `Recent conversation:\n${recentConversation}\n\n` : ""}${pageText ? `${pageText}\n\n` : ""}User question:\n${userQuestion}`;
};

const SunIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);

const MoonIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const SettingsIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.91 10H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
  </svg>
);

const Header = ({
  activeProvider,
  apiKey,
  isProviderMenuOpen,
  isPageContextLoading,
  onOpenConfirm,
  onToggleProviderMenu,
  onToggleTheme,
  onUsePage,
  setup = false,
  theme,
}) => (
  <header className="chat-header">
    <div className="header-content">
      <img className="app-logo" src="/icon.png" alt="" aria-hidden="true" />
      <div className="header-title">
        <h1>Snapa Chat</h1>
        <span className={`key-status ${apiKey ? "ready" : ""}`}>
          {setup ? "Setup" : `${activeProvider.label} ready`}
        </span>
      </div>
    </div>

    {!setup && (
      <div className="header-actions">
        <button
          type="button"
          className="provider-icon-btn"
          onClick={onToggleProviderMenu}
          aria-label="Manage provider"
          aria-expanded={isProviderMenuOpen}
        >
          <SettingsIcon />
        </button>

        {isProviderMenuOpen && (
          <>
            <button
              type="button"
              className="provider-menu-close-area"
              onClick={onToggleProviderMenu}
              aria-label="Close provider menu"
            />
            <div className="provider-action-list" role="menu">
              <button
                type="button"
                className="provider-action-item"
                onClick={onUsePage}
                role="menuitem"
                disabled={isPageContextLoading}
              >
                <span>{isPageContextLoading ? "Reading page..." : "Use this page"}</span>
                <small>Ask about current article</small>
              </button>
              <button
                type="button"
                className="provider-action-item"
                onClick={() => onOpenConfirm("change")}
                role="menuitem"
              >
                <span>Change provider</span>
                <small>Use another API key</small>
              </button>
              <button
                type="button"
                className="provider-action-item danger"
                onClick={() => onOpenConfirm("clear")}
                role="menuitem"
              >
                <span>Clear saved key</span>
                <small>Return to setup</small>
              </button>
              <button
                type="button"
                className="provider-action-item danger"
                onClick={() => onOpenConfirm("clear-chat")}
                role="menuitem"
              >
                <span>Clear chat</span>
                <small>Keep provider settings</small>
              </button>
            </div>
          </>
        )}
      </div>
    )}

    <button onClick={onToggleTheme} className="theme-toggle" aria-label="Toggle theme">
      {theme === "light" ? <MoonIcon /> : <SunIcon />}
    </button>
  </header>
);

function App() {
  const [messages, setMessages] = useState(DEFAULT_MESSAGES);
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
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "dark";
    return (
      localStorage.getItem("theme") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    );
  });

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const activeProvider = PROVIDERS[provider];
  const shouldShowSetup = isConfigLoaded && (!apiKey || isEditingConfig);

  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const loadInitialState = async () => {
      const storedConfig = parseJson(await readStoredValue(STORAGE_KEYS.apiConfig), null);
      let nextConfig = storedConfig;

      if (!nextConfig?.apiKey) {
        const legacyGeminiKey = await readStoredValue(STORAGE_KEYS.legacyGeminiKey);
        if (legacyGeminiKey) {
          nextConfig = { provider: "gemini", apiKey: legacyGeminiKey };
          await saveStoredValue(STORAGE_KEYS.apiConfig, JSON.stringify(nextConfig));
          await removeStoredValue(STORAGE_KEYS.legacyGeminiKey);
        }
      }

      setProvider(normalizeProvider(nextConfig?.provider));
      setApiKey(nextConfig?.apiKey || "");
      setApiKeyInput(nextConfig?.apiKey || "");
      setIsConfigLoaded(true);

      const history = parseJson(await readStoredValue(STORAGE_KEYS.chatHistory), []);
      if (Array.isArray(history) && history.length > 0) {
        setMessages(getSavedMessages(history));
      }
      setIsChatHistoryLoaded(true);

      const templates = parseJson(await readStoredValue(STORAGE_KEYS.customTemplates), []);
      if (Array.isArray(templates)) {
        setCustomTemplates(
          templates.filter(
            (template) =>
              typeof template?.id === "string" &&
              typeof template?.label === "string" &&
              typeof template?.instruction === "string",
          ),
        );
      }

      const context = parseJson(await readStoredValue(STORAGE_KEYS.pageContext), null);
      if (
        typeof context?.title === "string" &&
        typeof context?.url === "string" &&
        typeof context?.excerpt === "string"
      ) {
        setPageContext(context);
      }

      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.get("selectedText", (data) => {
          if (data?.selectedText) {
            setInput(String(data.selectedText));
            chrome.storage.local.remove("selectedText");
          }
        });
      }
    };

    loadInitialState();
  }, []);

  useEffect(() => {
    if (!isChatHistoryLoaded) return;
    saveStoredValue(STORAGE_KEYS.chatHistory, JSON.stringify(getSavedMessages(messages)));
  }, [isChatHistoryLoaded, messages]);

  const savePageContext = async (nextContext) => {
    setPageContext(nextContext);
    await saveStoredValue(STORAGE_KEYS.pageContext, JSON.stringify(nextContext));
  };

  const saveCustomTemplates = async (nextTemplates) => {
    setCustomTemplates(nextTemplates);
    await saveStoredValue(STORAGE_KEYS.customTemplates, JSON.stringify(nextTemplates));
  };

  const saveApiConfig = async () => {
    const trimmedApiKey = apiKeyInput.trim();
    setIsSavingConfig(true);
    setSetupError("");

    try {
      await callProvider(
        { provider, apiKey: trimmedApiKey },
        "Reply with exactly: OK",
        { maxOutputTokens: 8 },
      );
      await saveStoredValue(
        STORAGE_KEYS.apiConfig,
        JSON.stringify({ provider, apiKey: trimmedApiKey }),
      );
      setApiKey(trimmedApiKey);
      setIsEditingConfig(false);
      setMessages((prev) => [
        ...prev,
        { text: `${PROVIDERS[provider].label} is ready. What do you want to ask?`, sender: "ai" },
      ]);
    } catch (error) {
      console.error("API key validation failed:", error);
      setSetupError(getApiErrorMessage(provider, error));
      setApiKey("");
      await removeStoredValue(STORAGE_KEYS.apiConfig);
      await removeStoredValue(STORAGE_KEYS.legacyGeminiKey);
    } finally {
      setIsSavingConfig(false);
    }
  };

  const clearApiConfig = async () => {
    setIsSavingConfig(true);
    await removeStoredValue(STORAGE_KEYS.apiConfig);
    await removeStoredValue(STORAGE_KEYS.legacyGeminiKey);
    setApiKey("");
    setApiKeyInput("");
    setSetupError("");
    setIsEditingConfig(true);
    setIsSavingConfig(false);
  };

  const closeConfirm = () => {
    if (!isSavingConfig) setConfirmAction(null);
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
      return;
    }

    if (confirmAction === "clear-chat") {
      await removeStoredValue(STORAGE_KEYS.chatHistory);
      setMessages(DEFAULT_MESSAGES);
      setConfirmAction(null);
    }
  };

  const useCurrentPage = async () => {
    if (!apiKey) {
      setMessages((prev) => [
        ...prev,
        { text: "Please save your API key before using page context.", sender: "ai", error: true },
      ]);
      return;
    }

    setIsProviderMenuOpen(false);
    setIsPageContextLoading(true);
    try {
      const nextContext = await createPageContext({ provider, apiKey });
      await savePageContext(nextContext);
      setMessages((prev) => [
        ...prev,
        { text: `Now using this page: ${nextContext.title}`, sender: "ai" },
      ]);
    } catch (error) {
      console.error("Page capture failed:", error);
      setMessages((prev) => [
        ...prev,
        { text: error.message || "I could not use this page.", sender: "ai", error: true },
      ]);
    } finally {
      setIsPageContextLoading(false);
    }
  };

  const sendMessage = async (textOverride = null) => {
    const textToSend = typeof textOverride === "string" ? textOverride : input;
    if (!textToSend.trim()) return;

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

    setMessages((prev) => [...prev, { text: textToSend, sender: "user" }]);
    setInput("");
    setIsLoading(true);

    try {
      let contextForPrompt = pageContext;
      if (contextForPrompt) {
        try {
          const tab = await getActiveTab();
          if (
            normalizeUrlForContext(tab.url) !== normalizeUrlForContext(contextForPrompt.url)
          ) {
            contextForPrompt = null;
          }
        } catch {
          contextForPrompt = pageContext;
        }
      }

      const prompt = buildChatPrompt({
        messages,
        pageContext: contextForPrompt,
        userQuestion: textToSend,
      });
      const reply = await callProvider({ provider, apiKey }, prompt, { maxOutputTokens: 500 });
      setMessages((prev) => [...prev, { text: reply, sender: "ai" }]);
    } catch (error) {
      console.error("Error:", error);

      if (error instanceof ApiAuthError) {
        await removeStoredValue(STORAGE_KEYS.apiConfig);
        await removeStoredValue(STORAGE_KEYS.legacyGeminiKey);
        setApiKey("");
        setApiKeyInput("");
        setIsEditingConfig(true);
        setSetupError(getApiErrorMessage(provider, error));
      }

      setMessages((prev) => [
        ...prev,
        { text: error.message || "Sorry, something went wrong.", sender: "ai", error: true },
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

    sendMessage(`${template.instruction}:\n\n"${input}"`);
  };

  const addCustomTemplate = async () => {
    const instruction = customPrompt.trim();
    if (!instruction) return;

    await saveCustomTemplates([
      ...customTemplates,
      {
        id: `custom-${Date.now()}`,
        label: instruction.length > 34 ? `${instruction.slice(0, 31)}...` : instruction,
        instruction,
      },
    ]);
    setCustomPrompt("");
    setIsCustomPromptOpen(false);
    setIsTemplateMenuOpen(true);
  };

  const deleteCustomTemplate = (templateId) =>
    saveCustomTemplates(customTemplates.filter((template) => template.id !== templateId));

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
        <Header
          activeProvider={activeProvider}
          apiKey={apiKey}
          onToggleTheme={() => setTheme((value) => (value === "light" ? "dark" : "light"))}
          setup
          theme={theme}
        />

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
            onChange={(event) => {
              setApiKeyInput(event.target.value);
              setSetupError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && apiKeyInput.trim()) saveApiConfig();
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
      <Header
        activeProvider={activeProvider}
        apiKey={apiKey}
        isPageContextLoading={isPageContextLoading}
        isProviderMenuOpen={isProviderMenuOpen}
        onOpenConfirm={(action) => {
          setIsProviderMenuOpen(false);
          setConfirmAction(action);
        }}
        onToggleProviderMenu={() => setIsProviderMenuOpen((value) => !value)}
        onToggleTheme={() => setTheme((value) => (value === "light" ? "dark" : "light"))}
        onUsePage={useCurrentPage}
        theme={theme}
      />

      {confirmAction && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeConfirm();
        }}>
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <h2 id="confirm-title">{confirmDetails.title}</h2>
            <p>{confirmDetails.message}</p>
            <div className="confirm-actions">
              <button type="button" className="key-btn" onClick={closeConfirm} disabled={isSavingConfig}>
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
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            setIsCustomPromptOpen(false);
            setCustomPrompt("");
          }
        }}>
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="custom-prompt-title">
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
              <button
                type="button"
                className="key-btn"
                onClick={() => {
                  setIsCustomPromptOpen(false);
                  setCustomPrompt("");
                }}
              >
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

        {messages.map((message, index) => (
          <div
            key={index}
            className={`message ${message.sender} ${message.error ? "error" : ""}`}
          >
            <div className="message-content">{formatMessageText(message.text)}</div>
          </div>
        ))}

        {isLoading && (
          <div className="message ai">
            <div className="message-content">
              <div className="typing-indicator">
                <span />
                <span />
                <span />
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
            onClick={() => setIsTemplateMenuOpen((value) => !value)}
            disabled={isLoading || !apiKey}
          >
            <span>Select a template...</span>
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
          />
        </div>

        <div className="input-row">
          <div className="input-wrapper">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") sendMessage();
              }}
              placeholder="Type a message..."
              disabled={isLoading || !apiKey}
            />
          </div>
          <button
            className="send-btn"
            onClick={() => sendMessage()}
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

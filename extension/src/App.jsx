import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./index.css";

const STORAGE_KEYS = {
  apiConfig: "aiProviderConfig",
  chatHistory: "chatHistory",
  customTemplates: "customTemplates",
  legacyGeminiKey: "geminiApiKey",
  pageContext: "pageContext",
  selectedText: "selectedText",
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
const SHORT_ANSWER_TOKENS = 500;
const MEDIUM_ANSWER_TOKENS = 900;
const LONG_ANSWER_TOKENS = 1300;

const DEFAULT_MESSAGES = [{ text: "Ask me anything.", sender: "ai" }];

const DEFAULT_TEMPLATES = [
  {
    id: "summarize",
    label: "Summarize",
    instruction: "Summarize briefly in 2 to 4 short sentences",
  },
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
  openrouterCandidates: new Map(),
};

const getStorage = () =>
  typeof chrome !== "undefined" && chrome.storage?.local
    ? chrome.storage.local
    : null;

const getRuntimeErrorMessage = () => chrome.runtime?.lastError?.message || "";

const readStoredValue = (key) =>
  new Promise((resolve, reject) => {
    const storage = getStorage();
    if (!storage) {
      try {
        resolve(localStorage.getItem(key) || "");
      } catch (error) {
        reject(error);
      }
      return;
    }

    storage.get(key, (data) => {
      const errorMessage = getRuntimeErrorMessage();
      if (errorMessage) {
        reject(new Error(errorMessage));
        return;
      }

      resolve(data?.[key] || "");
    });
  });

const saveStoredValue = (key, value) =>
  new Promise((resolve, reject) => {
    const storage = getStorage();
    if (!storage) {
      try {
        localStorage.setItem(key, value);
        resolve();
      } catch (error) {
        reject(error);
      }
      return;
    }

    storage.set({ [key]: value }, () => {
      const errorMessage = getRuntimeErrorMessage();
      if (errorMessage) {
        reject(new Error(errorMessage));
        return;
      }

      resolve();
    });
  });

const removeStoredValue = (key) =>
  new Promise((resolve, reject) => {
    const storage = getStorage();
    if (!storage) {
      try {
        localStorage.removeItem(key);
        resolve();
      } catch (error) {
        reject(error);
      }
      return;
    }

    storage.remove(key, () => {
      const errorMessage = getRuntimeErrorMessage();
      if (errorMessage) {
        reject(new Error(errorMessage));
        return;
      }

      resolve();
    });
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

const isSameContextUrl = (firstUrl, secondUrl) =>
  normalizeUrlForContext(firstUrl) === normalizeUrlForContext(secondUrl);

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

const getProviderErrorMessage = (data, fallback) => {
  const error = data?.error || {};
  return (
    error.message ||
    error.metadata?.raw ||
    error.metadata?.reason ||
    data?.message ||
    fallback
  );
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

  const candidate = data?.candidates?.[0];
  const finishReason = String(candidate?.finishReason || "");
  const reply = candidate?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();

  const text = reply || "Gemini returned an empty response.";
  if (options.returnDetails) {
    return {
      text,
      wasTruncated: finishReason === "MAX_TOKENS",
      finishReason,
    };
  }

  return text;
};

const getOpenRouterModelCandidates = async (apiKey) => {
  if (modelCache.openrouterCandidates.has(apiKey)) {
    return modelCache.openrouterCandidates.get(apiKey);
  }

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
      const models = [
        ...PROVIDERS.openrouter.preferredModels.filter((item) => availableModels.includes(item)),
        ...availableModels.filter((item) => item.endsWith(":free")),
        PROVIDERS.openrouter.fallbackModel,
      ].filter((model, index, list) => model && list.indexOf(model) === index);

      modelCache.openrouterCandidates.set(apiKey, models);
      return models;
    }
  } catch {
    // Fall back to the default model if OpenRouter model lookup is unavailable.
  }

  const fallbackModels = [PROVIDERS.openrouter.fallbackModel];
  modelCache.openrouterCandidates.set(apiKey, fallbackModels);
  return fallbackModels;
};

const createOpenRouterError = (response, data) => {
  const code = String(data?.error?.code || data?.error?.type || "");
  const message = getProviderErrorMessage(data, `OpenRouter request failed (${response.status})`);

  if (response.status === 401 || response.status === 403) {
    return new ApiAuthError(
      message || "Your OpenRouter API key is missing or invalid.",
      response.status,
      code,
    );
  }

  if (
    response.status === 429 ||
    response.status >= 500 ||
    code === "insufficient_quota" ||
    code === "billing_not_active" ||
    /provider returned error/i.test(message)
  ) {
    return new ApiUsageError(
      message || "Your OpenRouter API key has reached its quota or rate limit.",
      response.status,
      code,
    );
  }

  return new Error(message);
};

const callOpenRouterModel = async (apiKey, model, message, options = {}) => {
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
    throw createOpenRouterError(response, data);
  }

  const choice = data?.choices?.[0];
  const text = choice?.message?.content?.trim() || "OpenRouter returned an empty response.";
  const finishReason = String(choice?.finish_reason || choice?.native_finish_reason || "");

  if (options.returnDetails) {
    return {
      text,
      wasTruncated: finishReason === "length" || finishReason === "max_tokens",
      finishReason,
    };
  }

  return text;
};

const callOpenRouter = async (apiKey, message, options = {}) => {
  const cachedModel = modelCache.openrouter.get(apiKey);
  const candidateModels = cachedModel
    ? [cachedModel]
    : await getOpenRouterModelCandidates(apiKey);
  let lastError = null;

  for (const model of candidateModels) {
    try {
      const reply = await callOpenRouterModel(apiKey, model, message, options);
      modelCache.openrouter.set(apiKey, model);
      return reply;
    } catch (error) {
      lastError = error;
      if (error instanceof ApiAuthError || model === candidateModels.at(-1)) {
        throw error;
      }
    }
  }

  throw lastError || new Error("OpenRouter request failed.");
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

const formatMessageText = (text) => {
  const formatted = String(text)
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/(^|[.!?:;])\s+([1-9]\d?\.)\s+(?=\S)/g, "$1\n\n$2 ")
    .replace(/([.!?:;])\s+(-)\s+(?=\S)/g, "$1\n\n$2 ")
    .replace(/\s+-\s+(?=\S)/g, "\n\n- ")
    .replace(/\s+\u2022\s+(?=\S)/g, "\n\n- ")
    .replace(/^- /, "- ")
    .replace(/^\u2022\s*/gm, "- ")
    .replace(/\n{1,}(\d+\.) /g, "\n\n$1 ")
    .replace(/\n{1,}- /g, "\n\n- ")
    .replace(/\n{4,}/g, "\n\n")
    .trim();

  return formatted.split("\n").map((line, index) => (
    <span key={`${index}-${line}`}>
      {index > 0 && <br />}
      {line}
    </span>
  ));
};

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

  const responseSettings = getResponseSettings(userQuestion);

  return `You are Snapa Chat.
Answer in plain, precise, fast-to-read text.
Use recent conversation to understand references like "that", "it", "above", or "this".
If page context is provided, answer from that page. If the page does not mention it, say so.
Answer length:
${responseSettings.instruction}

Use numbered points only when the user asks for steps, reasons, examples, comparisons, pros and cons, or a list.
For simple definitions, meanings, translations, or quick facts, use one or two short plain paragraphs without numbers.
Put a blank line between points or paragraphs.
For example requests, give 2 to 4 concrete examples with short explanations.
If the user asks "what", infer they mean the previous answer unless context says otherwise.
Keep each answer clear, but do not make it so short that important context is missing.
Every numbered point must be complete. Never output an empty number like "2." or "2".
Add one short closing line only if useful.
Avoid long paragraphs, dense blocks, markdown tables, and markdown bold markers.

${recentConversation ? `Recent conversation:\n${recentConversation}\n\n` : ""}${pageText ? `${pageText}\n\n` : ""}User question:\n${userQuestion}`;
};

const getResponseSettings = (question) => {
  const value = String(question || "").trim().toLowerCase();
  const wantsDetail =
    /\b(explain|example|examples|why|how|compare|difference|steps|details|detail|describe|break down|tell me about|medium|long)\b/.test(
      value,
    );
  const wantsBrief = /\b(short|brief|quick|summarize|summary|tldr|tl;dr)\b/.test(value);

  if (wantsBrief && !wantsDetail) {
    return {
      maxOutputTokens: SHORT_ANSWER_TOKENS,
      instruction:
        "Use a brief answer: 2 to 4 short sentences. Do not include extra background unless needed.",
    };
  }

  if (wantsDetail && !wantsBrief) {
    return {
      maxOutputTokens: MEDIUM_ANSWER_TOKENS,
      instruction:
        "Use a medium answer: 4 to 8 short paragraphs, or numbered points only if the question needs a list.",
    };
  }

  if (value.length > 140) {
    return {
      maxOutputTokens: LONG_ANSWER_TOKENS,
      instruction:
        "Use a fuller answer: cover the important parts clearly, but keep paragraphs short.",
    };
  }

  return {
    maxOutputTokens: SHORT_ANSWER_TOKENS,
    instruction:
      "Use a concise answer: 1 to 2 short paragraphs, unless the user asks for a list or more detail.",
  };
};

const looksIncompleteReply = (reply) => {
  const value = String(reply || "").trim();
  if (!value) return true;
  if (/(^|\n)\s*\d+\.?\s*$/.test(value)) return true;
  if (/(^|\n)\s*[-\u2022]\s*$/.test(value)) return true;
  if (/[,;:]$/.test(value)) return true;
  if (
    /\b(a|an|about|above|after|and|are|as|at|because|before|but|by|for|from|if|in|into|is|of|on|or|over|than|that|the|their|to|under|when|where|which|while|who|with)\s*$/i.test(
      value,
    )
  ) {
    return true;
  }
  if (value.split(/\s+/).length >= 8 && !/[.!?)]["']?$/.test(value)) return true;
  return false;
};

const buildCompletionRetryPrompt = ({ firstReply, originalPrompt }) => `${originalPrompt}

The previous answer was incomplete:
${firstReply}

Rewrite the answer from scratch.
Use plain paragraphs unless the original question asks for a list.
Do not end with an unfinished number, bullet, phrase, or comma.`;

const getChatErrorMessage = (provider, error) => {
  if (error instanceof ApiAuthError || error instanceof ApiUsageError) {
    return getApiErrorMessage(provider, error);
  }

  if (error?.name === "TypeError") {
    return "The AI request could not connect. Check your internet connection and try again.";
  }

  return error?.message || "The AI request failed. Please try again.";
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
  providerMenuRef,
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
      <div className="header-actions" ref={providerMenuRef}>
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
  const chatWindowRef = useRef(null);
  const inputRef = useRef(null);
  const providerMenuRef = useRef(null);

  const activeProvider = PROVIDERS[provider];
  const shouldShowSetup = isConfigLoaded && (!apiKey || isEditingConfig);

  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const scrollToLatestMessage = (behavior = "smooth") => {
    const chatWindow = chatWindowRef.current;
    if (!chatWindow) return;

    chatWindow.scrollTo({
      top: chatWindow.scrollHeight,
      behavior,
    });
  };

  useLayoutEffect(() => {
    if (shouldShowSetup || !isChatHistoryLoaded) return;

    scrollToLatestMessage("auto");
    const frameId = requestAnimationFrame(() => scrollToLatestMessage("auto"));
    return () => cancelAnimationFrame(frameId);
  }, [isChatHistoryLoaded, pageContext, shouldShowSetup]);

  useEffect(() => {
    if (shouldShowSetup || !isChatHistoryLoaded) return;
    scrollToLatestMessage();
  }, [messages, isLoading, isChatHistoryLoaded, shouldShowSetup]);

  useEffect(() => {
    if (!isProviderMenuOpen) return;

    const handlePointerDown = (event) => {
      if (!providerMenuRef.current?.contains(event.target)) {
        setIsProviderMenuOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsProviderMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isProviderMenuOpen]);

  useEffect(() => {
    if (shouldShowSetup) {
      setIsProviderMenuOpen(false);
    }
  }, [shouldShowSetup]);

  useEffect(() => {
    const loadInitialState = async () => {
      try {
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

        const history = parseJson(await readStoredValue(STORAGE_KEYS.chatHistory), []);
        if (Array.isArray(history) && history.length > 0) {
          setMessages(getSavedMessages(history));
        }

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

        const selectedText = await readStoredValue(STORAGE_KEYS.selectedText);
        if (selectedText) {
          setInput(String(selectedText));
          await removeStoredValue(STORAGE_KEYS.selectedText);
        }
      } catch {
        setSetupError(
          "Saved settings could not be loaded. Check Chrome extension storage and try again.",
        );
      } finally {
        setIsConfigLoaded(true);
        setIsChatHistoryLoaded(true);
      }
    };

    loadInitialState();
  }, []);

  useEffect(() => {
    if (!isChatHistoryLoaded) return;
    saveStoredValue(STORAGE_KEYS.chatHistory, JSON.stringify(getSavedMessages(messages))).catch(
      () => {
        // Chat history is non-critical; the current conversation stays visible in memory.
      },
    );
  }, [isChatHistoryLoaded, messages]);

  const savePageContext = async (nextContext) => {
    await saveStoredValue(STORAGE_KEYS.pageContext, JSON.stringify(nextContext));
    setPageContext(nextContext);
  };

  const saveCustomTemplates = async (nextTemplates) => {
    await saveStoredValue(STORAGE_KEYS.customTemplates, JSON.stringify(nextTemplates));
    setCustomTemplates(nextTemplates);
  };

  const clearPageContext = async () => {
    await removeStoredValue(STORAGE_KEYS.pageContext);
    setPageContext(null);
  };

  useEffect(() => {
    if (!pageContext || shouldShowSetup) return;

    let isCancelled = false;

    const clearIfPageChanged = async () => {
      try {
        const tab = await getActiveTab();
        if (!isCancelled && !isSameContextUrl(tab.url, pageContext.url)) {
          await clearPageContext();
        }
      } catch {
        // Keep existing page context if Chrome cannot report the active tab.
      }
    };

    clearIfPageChanged();

    return () => {
      isCancelled = true;
    };
  }, [pageContext, shouldShowSetup]);

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
    } catch (error) {
      setSetupError(getApiErrorMessage(provider, error));
      setApiKey("");
      try {
        await removeStoredValue(STORAGE_KEYS.apiConfig);
        await removeStoredValue(STORAGE_KEYS.legacyGeminiKey);
      } catch {
        // The validation error is already shown; stale storage can be replaced on the next save.
      }
      setIsSavingConfig(false);
      return;
    }

    try {
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
    } catch {
      setSetupError("Chrome could not save this API key locally. Please try again.");
      setApiKey("");
    } finally {
      setIsSavingConfig(false);
    }
  };

  const clearApiConfig = async () => {
    setIsSavingConfig(true);
    try {
      await removeStoredValue(STORAGE_KEYS.apiConfig);
      await removeStoredValue(STORAGE_KEYS.legacyGeminiKey);
      setApiKey("");
      setApiKeyInput("");
      setSetupError("");
      setIsEditingConfig(true);
    } catch {
      setSetupError("Chrome could not clear the saved API key. Please try again.");
    } finally {
      setIsSavingConfig(false);
    }
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
      try {
        await removeStoredValue(STORAGE_KEYS.chatHistory);
        setMessages(DEFAULT_MESSAGES);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            text: "Chrome could not clear the saved conversation. Please try again.",
            sender: "ai",
            error: true,
          },
        ]);
      }
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
          if (!isSameContextUrl(tab.url, contextForPrompt.url)) {
            contextForPrompt = null;
            await clearPageContext().catch(() => {
              // Stale context is ignored for this request even if storage cleanup fails.
            });
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
      const responseSettings = getResponseSettings(textToSend);
      let replyDetails = await callProvider(
        { provider, apiKey },
        prompt,
        { maxOutputTokens: responseSettings.maxOutputTokens, returnDetails: true },
      );
      let reply = replyDetails.text;
      if (replyDetails.wasTruncated || looksIncompleteReply(reply)) {
        const retryMaxOutputTokens = Math.min(
          LONG_ANSWER_TOKENS,
          Math.max(responseSettings.maxOutputTokens * 2, MEDIUM_ANSWER_TOKENS),
        );
        replyDetails = await callProvider(
          { provider, apiKey },
          buildCompletionRetryPrompt({ firstReply: reply, originalPrompt: prompt }),
          { maxOutputTokens: retryMaxOutputTokens, returnDetails: true },
        );
        reply = replyDetails.text;
      }

      if (replyDetails.wasTruncated || looksIncompleteReply(reply)) {
        throw new Error("The AI returned an incomplete answer. Please try again.");
      }

      setMessages((prev) => [...prev, { text: reply, sender: "ai" }]);
    } catch (error) {
      if (error instanceof ApiAuthError) {
        try {
          await removeStoredValue(STORAGE_KEYS.apiConfig);
          await removeStoredValue(STORAGE_KEYS.legacyGeminiKey);
        } catch {
          // The auth error is already shown; stale storage can be replaced on the next save.
        }
        setApiKey("");
        setApiKeyInput("");
        setIsEditingConfig(true);
        setSetupError(getApiErrorMessage(provider, error));
      }

      setMessages((prev) => [
        ...prev,
        { text: getChatErrorMessage(provider, error), sender: "ai", error: true },
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

    try {
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
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          text: "Chrome could not save that custom instruction. Please try again.",
          sender: "ai",
          error: true,
        },
      ]);
    }
  };

  const deleteCustomTemplate = (templateId) =>
    saveCustomTemplates(customTemplates.filter((template) => template.id !== templateId)).catch(
      () => {
        setMessages((prev) => [
          ...prev,
          {
            text: "Chrome could not delete that custom instruction. Please try again.",
            sender: "ai",
            error: true,
          },
        ]);
      },
    );

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
        providerMenuRef={providerMenuRef}
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

      <div className="chat-window" ref={chatWindowRef}>
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

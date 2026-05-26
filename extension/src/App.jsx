import { useState, useRef, useEffect, useLayoutEffect } from "react";
import "./index.css";

const API_CONFIG_STORAGE_KEY = "aiProviderConfig";
const LEGACY_GEMINI_KEY = "geminiApiKey";

const PROVIDERS = {
  gemini: {
    label: "Gemini",
    keyLabel: "Gemini API key",
    keyPlaceholder: "Paste your Gemini API key",
    model: "gemini-1.5-flash",
  },
  openai: {
    label: "OpenAI",
    keyLabel: "OpenAI API key",
    keyPlaceholder: "Paste your OpenAI API key",
    model: "gpt-4o-mini",
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

const callGemini = async (apiKey, message) => {
  const model = PROVIDERS.gemini.model;
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
  }

  const reply = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();

  return reply || "Gemini returned an empty response.";
};

const callOpenAI = async (apiKey, message) => {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: PROVIDERS.openai.model,
      messages: [{ role: "user", content: message }],
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const errorCode = data?.error?.code || data?.error?.type || "";

    if (response.status === 401 || response.status === 403) {
      throw new ApiAuthError(
        data?.error?.message || "Your OpenAI API key is missing or invalid.",
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
          "Your OpenAI API key has reached its quota or billing limit.",
        response.status,
        String(errorCode),
      );
    }

    throw new Error(
      data?.error?.message || `OpenAI request failed (${response.status})`,
    );
  }

  const reply = data?.choices?.[0]?.message?.content?.trim();

  return reply || "OpenAI returned an empty response.";
};

const callProvider = (config, message) => {
  if (config.provider === "openai") {
    return callOpenAI(config.apiKey, message);
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
  const [isEditingConfig, setIsEditingConfig] = useState(false);
  const [setupError, setSetupError] = useState("");
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
      const finalText = await callProvider({ provider, apiKey }, textToSend);
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

  const handleTemplateChange = (e) => {
    const template = e.target.value;
    if (!template || !input.trim()) return;

    const prompt = `${template}:\n\n"${input}"`;
    sendMessage(prompt);
    // Reset select to default
    e.target.value = "";
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      sendMessage();
    }
  };

  const activeProvider = PROVIDERS[provider];
  const shouldShowSetup = isConfigLoaded && (!apiKey || isEditingConfig);

  if (!isConfigLoaded) {
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
            <h1>Snapa AI</h1>
            <span className="key-status">Setup</span>
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
          <h1>Snapa AI</h1>
          <span className={`key-status ${apiKey ? "ready" : ""}`}>
            {activeProvider.label} ready
          </span>
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

      <section className="provider-bar" aria-label="AI provider settings">
        <span>{activeProvider.label}</span>
        <button type="button" className="link-btn" onClick={() => setIsEditingConfig(true)}>
          Change
        </button>
        <button type="button" className="link-btn danger" onClick={clearApiConfig}>
          Clear
        </button>
      </section>

      <div className="chat-window">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`message ${msg.sender} ${msg.error ? "error" : ""}`}
          >
            <div className="message-content">
              {typeof msg.text === 'object' ? JSON.stringify(msg.text) : msg.text}
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
          <select
            onChange={handleTemplateChange}
            defaultValue=""
            disabled={isLoading || !apiKey || !input.trim()}
          >
            <option value="" disabled>
              Select a template...
            </option>
            <option value="Summarize">Summarize</option>
            <option value="Explain with easy words">
              Explain with easy words
            </option>
            <option value="Explain with example">Explain with example</option>
          </select>
        </div>
        <div className="input-row">
          <div className="input-wrapper">
            <input
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

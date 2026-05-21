import { useState, useRef, useEffect, useLayoutEffect } from "react";
import "./index.css";

const API_KEY_STORAGE_KEY = "geminiApiKey";
const MODEL_NAME = "gemini-1.5-flash";

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

const callGemini = async (apiKey, message) => {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent`,
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

function App() {
  const [messages, setMessages] = useState([
    { text: "Add your Gemini API key, then ask me anything.", sender: "ai" },
  ]);
  const [input, setInput] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [isSavingKey, setIsSavingKey] = useState(false);
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
    readStoredValue(API_KEY_STORAGE_KEY).then((storedApiKey) => {
      setApiKey(storedApiKey);
      setApiKeyInput(storedApiKey);
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

  const saveApiKey = async () => {
    const trimmedApiKey = apiKeyInput.trim();

    setIsSavingKey(true);
    await saveStoredValue(API_KEY_STORAGE_KEY, trimmedApiKey);
    setApiKey(trimmedApiKey);
    setIsSavingKey(false);
  };

  const clearApiKey = async () => {
    setIsSavingKey(true);
    await removeStoredValue(API_KEY_STORAGE_KEY);
    setApiKey("");
    setApiKeyInput("");
    setIsSavingKey(false);
  };

  const sendMessage = async (textOverride = null) => {
    const textToSend = typeof textOverride === "string" ? textOverride : input;

    if (!String(textToSend).trim()) return;
    if (!apiKey) {
      setMessages((prev) => [
        ...prev,
        {
          text: "Please save your Gemini API key before sending a message.",
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
      const finalText = await callGemini(apiKey, textToSend);
      const aiMessage = { text: finalText, sender: "ai" };
      setMessages((prev) => [...prev, aiMessage]);
    } catch (error) {
      console.error("Error:", error);
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

  return (
    <div className="app-container">
      <header className="chat-header">
        <div className="header-content">
          <h1>Snapa AI</h1>
          <span className={`key-status ${apiKey ? "ready" : ""}`}>
            {apiKey ? "Key saved" : "No API key"}
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

      <section className="api-key-panel" aria-label="Gemini API key settings">
        <label htmlFor="api-key">Gemini API key</label>
        <div className="api-key-row">
          <input
            id="api-key"
            type="password"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder="Paste your Gemini API key"
            disabled={isSavingKey}
          />
          <button
            type="button"
            className="key-btn primary"
            onClick={saveApiKey}
            disabled={isSavingKey || !apiKeyInput.trim()}
          >
            Save
          </button>
          <button
            type="button"
            className="key-btn"
            onClick={clearApiKey}
            disabled={isSavingKey || (!apiKey && !apiKeyInput)}
          >
            Clear
          </button>
        </div>
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

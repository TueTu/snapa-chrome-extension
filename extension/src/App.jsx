import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import axios from "axios";
import "./index.css";

function App() {
  const [messages, setMessages] = useState([
    { text: "Hello! How can I help you today?", sender: "ai" },
  ]);
  const [input, setInput] = useState("");
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
    // Check for selected text from context menu
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get("selectedText", (data) => {
        if (data && data.selectedText) {
          const text = typeof data.selectedText === 'string' ? data.selectedText : String(data.selectedText);
          setInput(text);
          // Clear storage after reading
          chrome.storage.local.remove("selectedText");
        }
      });
    }
  }, []);

  const sendMessage = async (textOverride = null) => {
    const textToSend = typeof textOverride === "string" ? textOverride : input;

    if (!String(textToSend).trim()) return;

    const userMessage = { text: textToSend, sender: "user" };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3000";
      const response = await axios.post(`${apiUrl}/api/chat`, {
        message: textToSend,
      });

      const replyData = response.data && response.data.reply;
      const finalText = typeof replyData === 'string' ? replyData : JSON.stringify(replyData || "Empty response");
      
      const aiMessage = { text: finalText, sender: "ai" };
      setMessages((prev) => [...prev, aiMessage]);
    } catch (error) {
      console.error("Error:", error);
      const errorMessage = error.response?.data?.error || error.message || "Sorry, something went wrong.";
      setMessages(prev => [...prev, { text: String(errorMessage), sender: "ai", error: true }]);
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
          <h1>AI Assistant</h1>
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
            disabled={isLoading || !input.trim()}
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
              disabled={isLoading}
            />
          </div>
          <button
            className="send-btn"
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
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

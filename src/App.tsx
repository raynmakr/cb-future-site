import { useEffect, useRef, useState } from "react";
import type { PropsWithChildren } from "react";
import { motion } from "framer-motion";
import { Bot, Sparkles, Send } from "lucide-react";

// ————————————————————————————————————————————
// WEBSITE OF THE FUTURE — Minimal landing + Concierge chat
// On load: fades from light → dark, then reveals a Concierge prompt.
// Now includes a chat box wired to a backend endpoint you control.
// To connect this to your GPT, implement /api/concierge on your server and
// proxy to the OpenAI API (Responses/Assistants). Do NOT expose secrets.
// ————————————————————————————————————————————

const PROXY_URL = "/api/concierge"; // ← implement this on your server
const GPT_SHARE_URL =
  "https://chatgpt.com/g/g-68f05c99bde88191b0bd751c8d3354c7-clifton-blake-ksa-concierge";

// Path to your logo served by Vite from /public
// Place the provided file at: public/cb-logo.png
const LOGO_SRC = "/cb-logo.png";

// Streaming client: expects backend to stream text (SSE/NDJSON/plain chunks)
async function streamConciergeAPI(
  prompt: string,
  onDelta: (chunk: string) => void
): Promise<{ final: string; sources?: string[] }> {
  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: prompt, stream: true }),
  });

  if (!res.ok) throw new Error(`Proxy error: ${res.status}`);
  const contentType = res.headers.get("Content-Type") || "";

  // Handle streaming content types
  if (
    contentType.includes("text/event-stream") ||
    contentType.includes("text/plain") ||
    contentType.includes("application/x-ndjson")
  ) {
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let final = "";
    if (!reader) return { final };
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      // ✅ Correct newlines regex (previous version had corrupted CR/LF chars)
      const parts = buffer.split(/\r?\n\r?\n|\r?\n/);
      buffer = parts.pop() || ""; // keep last partial
      for (const line of parts) {
        const trimmed = line.replace(/^data:\s?/, "");
        if (!trimmed) continue;
        try {
          const evt = JSON.parse(trimmed);
          if (typeof evt.delta === "string") {
            final += evt.delta;
            onDelta(evt.delta);
          } else if (typeof evt.text === "string") {
            final += evt.text;
            onDelta(evt.text);
          }
          // if evt.sources present, we attach after stream ends
        } catch {
          final += trimmed;
          onDelta(trimmed);
        }
      }
    }
    if (buffer) {
      final += buffer;
      onDelta(buffer);
    }
    return { final };
  }

  // Fallback to JSON response
  const data = await res.json();
  return {
    final: data?.reply ?? "",
    sources: Array.isArray(data?.sources) ? data.sources : undefined,
  };
}

function Container({ children }: PropsWithChildren) {
  return <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">{children}</div>;
}

// ——— Concierge Chat Types ———
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources?: string[]; // optional citations list
}

function ConciergeCard() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function scrollToBottom(smooth = true) {
    const log = logRef.current;
    if (!log) return;
    const behavior = smooth ? ("smooth" as const) : ("auto" as const);
    log.scrollTo({ top: log.scrollHeight, behavior });
  }

  async function callConciergeAPI(
    prompt: string
  ): Promise<{ reply: string; sources?: string[] }> {
    try {
      const res = await fetch(PROXY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Concierge-GPT": GPT_SHARE_URL,
        },
        body: JSON.stringify({ message: prompt }),
      });
      if (!res.ok) throw new Error(`Proxy error: ${res.status}`);
      const data = await res.json();
      if (typeof data?.reply === "string")
        return { reply: data.reply, sources: data?.sources };
      throw new Error("Malformed response from proxy");
    } catch (err) {
      return {
        reply:
          "(demo) I’m ready to assist with Global Private Equity Real Estate across New York, Toronto, and Riyadh. Connect the backend to enable real replies from the Concierge GPT.",
      };
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    // 1) Add user message immediately
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    inputRef.current?.focus();
    requestAnimationFrame(() => scrollToBottom(true));

    // 2) Add assistant placeholder to stream into
    const botId = crypto.randomUUID();
    setMessages((m) => [...m, { id: botId, role: "assistant", content: "" }]);

    setLoading(true);
    try {
      let gotDelta = false;
      const result = await streamConciergeAPI(text, (delta) => {
        gotDelta = true;
        setMessages((m) =>
          m.map((msg) => (msg.id === botId ? { ...msg, content: msg.content + delta } : msg))
        );
        requestAnimationFrame(() => scrollToBottom(true));
      });

      // If we didn't receive streaming chunks, use the final text (non-stream JSON path)
      if (!gotDelta && result.final) {
        setMessages((m) =>
          m.map((msg) => (msg.id === botId ? { ...msg, content: result.final } : msg))
        );
      }
      if (result.sources) {
        setMessages((m) =>
          m.map((msg) => (msg.id === botId ? { ...msg, sources: result.sources } : msg))
        );
      }

      // If still empty (no delta & no final), fall back once to non-streaming API
      const botMsg = messages.find((m) => m.id === botId);
      if (!gotDelta && (!botMsg || !botMsg.content)) {
        const { reply, sources } = await callConciergeAPI(text);
        setMessages((m) =>
          m.map((msg) => (msg.id === botId ? { ...msg, content: reply, sources } : msg))
        );
      }
    } catch (e) {
      // Fallback to non-streaming mode on any error
      const { reply, sources } = await callConciergeAPI(text);
      setMessages((m) =>
        m.map((msg) => (msg.id === botId ? { ...msg, content: reply, sources } : msg))
      );
    } finally {
      setLoading(false);
      requestAnimationFrame(() => scrollToBottom(true));
    }
  }

  // Also auto-scroll whenever messages or loading state changes (catch-all)
  useEffect(() => {
    scrollToBottom(false);
  }, [messages, loading]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.2 }}
      className="w-full max-w-2xl rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-md"
      aria-label="Concierge prompt"
      data-testid="concierge-card"
    >
      <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/80">
        <Bot className="h-3.5 w-3.5" /> Concierge
      </div>

      {/* Messages */}
      <div
        ref={logRef}
        className="mb-4 max-h-64 space-y-3 overflow-y-auto pr-1 overscroll-contain"
        data-testid="chat-log"
        aria-live="polite"
        aria-atomic="false"
      >
        {messages.length === 0 ? (
          <div className="text-sm text-white/80 md:text-base">How may I assist you?</div>
        ) : (
          messages.map((m) => (
            <div key={m.id}>
              <div
                className={
                  m.role === "user"
                    ? "ml-auto w-fit max-w-full whitespace-pre-wrap rounded-xl bg-white/80 px-3 py-2 text-sm text-neutral-900"
                    : "mr-auto w-fit max-w-full whitespace-pre-wrap rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90"
                }
              >
                {m.content}
              </div>
              {m.role === "assistant" && m.sources && m.sources.length > 0 && (
                <div className="mt-1 mr-auto w-fit text-[11px] text-white/60">
                  Sources: {m.sources.join(", ")}
                </div>
              )}
            </div>
          ))
        )}
        {loading && (
          <div className="mr-auto w-fit max-w-full animate-pulse rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70">
            Thinking…
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex items-center gap-2" data-testid="chat-input-row">
        <input
          ref={inputRef}
          className="h-11 flex-1 rounded-xl border border-white/15 bg-white/10 px-3 text-white/90 placeholder-white/50 outline-none backdrop-blur-md"
          placeholder="Type a request…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          aria-label="Message the Concierge"
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="inline-flex h-11 items-center justify-center rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white/90 backdrop-blur-md disabled:opacity-50"
          aria-label="Send"
        >
          <Send className="mr-1 h-4 w-4" /> Send
        </button>
      </div>

      {/* Optional: open the GPT in ChatGPT (auth required) */}
      <div className="mt-3 text-xs text-white/60">
        Prefer the full ChatGPT experience?{' '}
        <a
          className="underline"
          href={GPT_SHARE_URL}
          target="_blank"
          rel="noreferrer noopener"
          data-testid="gpt-link"
        >
          Open the Concierge GPT
        </a>
        .
      </div>
    </motion.div>
  );
}

export default function CorporateWebsite() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setIsDark(true), 900); // delay before dark mode kicks in
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      id="app-root"
      data-theme={isDark ? "dark" : "light"}
      className={[
        "min-h-screen transition-colors duration-1000",
        isDark ? "bg-neutral-950 text-neutral-100" : "bg-white text-neutral-900",
      ].join(" ")}
    >
      {/* Ambient gradients */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
        {/* light glow (visible before fade) */}
        <motion.div
          initial={{ opacity: 0.35 }}
          animate={{ opacity: isDark ? 0 : 0.35 }}
          transition={{ duration: 1.0 }}
          className="absolute -left-20 -top-24 h-80 w-80 rounded-full bg-indigo-300/40 blur-3xl"
        />
        {/* dark glow (emerges after fade) */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: isDark ? 0.25 : 0 }}
          transition={{ duration: 1.0 }}
          className="absolute right-0 top-1/3 h-[32rem] w-[32rem] rounded-full bg-blue-500/20 blur-3xl"
        />
      </div>

      {/* Centered hero */}
      <main className="grid min-h-screen place-items-center">
        <Container>
          <div className="flex flex-col items-center text-center">
            {/* Logo */}
            <motion.img
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.05 }}
              src={LOGO_SRC}
              alt="Clifton Blake"
              className="mb-6 h-10 w-auto md:h-12"
              data-testid="cb-logo"
              style={{ filter: !isDark ? "drop-shadow(0 0 4px rgba(0,0,0,0.45))" : "none" }}
            />

            {/* Brand spark */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="mb-6 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold"
              style={{
                borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)",
                background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)",
                color: isDark ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.65)",
              }}
              data-testid="brand-spark"
            >
              <Sparkles className="h-3.5 w-3.5" /> Welcome to the future
            </motion.div>

            {/* Concierge */}
            <ConciergeCard />

            {/* Tagline */}
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.5 }}
              className="mt-10 text-2xl font-medium tracking-tight text-current md:text-4xl"
              data-testid="tagline"
            >
              Global Private Equity Real Estate
            </motion.h1>

            {/* Cities */}
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.7 }}
              className="mt-3 text-sm uppercase tracking-wider text-neutral-500 md:text-base"
              data-testid="cities"
            >
              New York <span className="px-2">|</span> Toronto <span className="px-2">|</span> Riyadh
            </motion.p>
          </div>
        </Container>
      </main>

      {/* ——— Lightweight Runtime Tests (dev-friendly) ——— */}
      <DevTests />
    </div>
  );
}

/**
 * DevTests: very lightweight runtime assertions to validate expected behavior.
 * These are not unit tests, but they help ensure the page renders as intended.
 * Results are printed to the browser console.
 */
function DevTests() {
  useEffect(() => {
    const root = document.getElementById("app-root");
    console.groupCollapsed("[DevTests] Website of the Future");

    // Test 1: Concierge card exists
    const concierge = document.querySelector('[data-testid="concierge-card"]');
    console.assert(!!concierge, "Concierge card should render");

    // Test 2: Chat input and button exist
    const input = document.querySelector('[data-testid="chat-input-row"] input') as HTMLInputElement | null;
    const button = document.querySelector('[data-testid="chat-input-row"] button');
    console.assert(
      !!input && input.placeholder.includes("Type a request"),
      "Chat input should be present with placeholder"
    );
    console.assert(!!button, "Send button should be present");

    // Test 3b: Send should be disabled when input is empty
    const sendBtn = button as HTMLButtonElement | null;
    console.assert(!!sendBtn && sendBtn.disabled === true, "Send should be disabled initially when input is empty");

    // Test 3: Tagline text matches
    const tagline = document.querySelector('[data-testid="tagline"]');
    console.assert(
      !!tagline && tagline.textContent?.includes("Global Private Equity Real Estate"),
      "Tagline should be present and correct"
    );

    // Test 4: Cities line contains all locations
    const cities = document.querySelector('[data-testid="cities"]');
    const citiesOk =
      cities?.textContent?.includes("New York") &&
      cities?.textContent?.includes("Toronto") &&
      cities?.textContent?.includes("Riyadh");
    console.assert(!!citiesOk, "Cities list should include New York, Toronto, Riyadh");

    // Test 5: Theme should fade to dark after ~900ms
    const initialTheme = root?.getAttribute("data-theme");
    console.assert(initialTheme === "light", "Initial theme should be light");

    const timeout = setTimeout(() => {
      const laterTheme = root?.getAttribute("data-theme");
      console.assert(laterTheme === "dark", "Theme should switch to dark after delay");

      // Added Tests — ensure accessibility and link presence
      // Test 6: chat log is aria-live polite for screen readers
      const chatLog = document.querySelector('[data-testid="chat-log"]');
      console.assert(
        chatLog?.getAttribute("aria-live") === "polite",
        "Chat log should be aria-live=polite"
      );
      // Test 7: GPT link exists
      const gptLink = document.querySelector('[data-testid="gpt-link"]') as HTMLAnchorElement | null;
      console.assert(!!gptLink && gptLink.href.includes("chatgpt.com"), "GPT link should be present");

      // Test 8: Logo exists and has src + alt
      const logo = document.querySelector('[data-testid="cb-logo"]') as HTMLImageElement | null;
      console.assert(!!logo && !!logo?.getAttribute("src"), "Logo should render with a src");
      console.assert(!!logo && (logo.alt || "").toLowerCase().includes("clifton"), "Logo should have descriptive alt text");

      console.groupEnd();
    }, 1200); // allow buffer beyond 900ms

    return () => clearTimeout(timeout);
  }, []);

  return null;
}

import { useEffect, useRef, useState } from "react";
import type { PropsWithChildren } from "react";
import { motion } from "framer-motion";
import { Bot, Sparkles, Send } from "lucide-react";

// Minimal landing + Concierge chat
// - On load: fades from light to dark
// - Chat supports streaming (SSE) and non-streaming JSON
// - Grounded toggle sends strict=true to backend to force retrieval

const PROXY_URL = "/api/concierge";
const GPT_SHARE_URL = "https://chatgpt.com/g/g-68f05c99bde88191b0bd751c8d3354c7-clifton-blake-ksa-concierge";
const LOGO_SRC = "/cb-logo.png"; // put your logo at public/cb-logo.png

// Parse a single Server-Sent-Event line and return a text delta, or null
function extractDeltaFromSSELine(line: string): string | null {
  if (!/^data:/i.test(line)) return null; // ignore event:, id:, retry:
  const payload = line.replace(/^data:\s?/i, "").trim();
  if (!payload || payload === "[DONE]") return null;
  try {
    const evt = JSON.parse(payload);
    if (typeof evt?.delta === "string") return evt.delta;
    if (typeof evt?.text === "string") return evt.text;
    return null;
  } catch {
    // not JSON - ignore (prevents raw "event:" noise)
    return null;
  }
}

function Container({ children }: PropsWithChildren) {
  return <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">{children}</div>;
}

// Types
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources?: string[]; // optional citations from backend
}

function ConciergeCard() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [grounded, setGrounded] = useState(true); // docs-only mode
  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function scrollToBottom(smooth = true) {
    const log = logRef.current;
    if (!log) return;
    log.scrollTo({ top: log.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }

  async function callConciergeAPI(prompt: string): Promise<{ reply: string; sources?: string[] }> {
    try {
      const res = await fetch(PROXY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Concierge-GPT": GPT_SHARE_URL,
        },
        body: JSON.stringify({ message: prompt, strict: grounded }),
      });
      if (!res.ok) throw new Error(`Proxy error: ${res.status}`);
      const data = await res.json();
      if (typeof data?.reply === "string") return { reply: data.reply, sources: data?.sources };
      throw new Error("Malformed response from proxy");
    } catch {
      return { reply: "(demo) Ready to assist. Connect the backend for real replies." };
    }
  }

  async function streamConciergeAPI(
    prompt: string,
    onDelta: (chunk: string) => void
  ): Promise<{ final: string; sources?: string[] }> {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: prompt, stream: true, strict: grounded }),
    });
    if (!res.ok) throw new Error(`Proxy error: ${res.status}`);

    const ct = res.headers.get("Content-Type") || "";
    if (ct.includes("text/event-stream") || ct.includes("text/plain") || ct.includes("application/x-ndjson")) {
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let final = "";
      if (!reader) return { final };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || ""; // keep last partial
        for (const raw of lines) {
          const delta = extractDeltaFromSSELine(raw);
          if (delta) {
            final += delta;
            onDelta(delta);
          }
        }
      }
      // process tail if it is a complete data line
      const tail = extractDeltaFromSSELine(buffer);
      if (tail) {
        final += tail;
        onDelta(tail);
      }
      return { final };
    }

    // fallback JSON
    const data = await res.json();
    return { final: data?.reply ?? "", sources: Array.isArray(data?.sources) ? data.sources : undefined };
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    // user bubble
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: text };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    inputRef.current?.focus();
    requestAnimationFrame(() => scrollToBottom(true));

    // assistant placeholder
    const botId = crypto.randomUUID();
    setMessages((m) => [...m, { id: botId, role: "assistant", content: "" }]);

    setLoading(true);
    try {
      let gotDelta = false;
      const result = await streamConciergeAPI(text, (delta) => {
        gotDelta = true;
        setMessages((m) => m.map((msg) => (msg.id === botId ? { ...msg, content: msg.content + delta } : msg)));
        requestAnimationFrame(() => scrollToBottom(true));
      });

      if (!gotDelta && result.final) {
        setMessages((m) => m.map((msg) => (msg.id === botId ? { ...msg, content: result.final } : msg)));
      }
      if (result.sources) {
        setMessages((m) => m.map((msg) => (msg.id === botId ? { ...msg, sources: result.sources } : msg)));
      }
      // if still empty, hard fallback
      const current = messages.find((m) => m.id === botId);
      if (!gotDelta && (!current || !current.content)) {
        const { reply, sources } = await callConciergeAPI(text);
        setMessages((m) => m.map((msg) => (msg.id === botId ? { ...msg, content: reply, sources } : msg)));
      }
    } catch {
      const { reply, sources } = await callConciergeAPI(text);
      setMessages((m) => m.map((msg) => (msg.id === botId ? { ...msg, content: reply, sources } : msg)));
    } finally {
      setLoading(false);
      requestAnimationFrame(() => scrollToBottom(true));
    }
  }

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
                <div className="mt-1 mr-auto w-fit text-[11px] text-white/60">Sources: {m.sources.join(", ")}</div>
              )}
            </div>
          ))
        )}
        {loading && (
          <div className="mr-auto w-fit max-w-full animate-pulse rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70">
            Thinking...
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex items-center gap-2" data-testid="chat-input-row">
        <input
          ref={inputRef}
          className="h-11 flex-1 rounded-xl border border-white/15 bg-white/10 px-3 text-white/90 placeholder-white/50 outline-none backdrop-blur-md"
          placeholder="Type a request..."
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

      {/* Grounded mode toggle */}
      <label className="mt-2 inline-flex select-none items-center gap-2 text-xs text-white/70" data-testid="grounded-toggle">
        <input type="checkbox" className="h-3.5 w-3.5 accent-white/80" checked={grounded} onChange={(e) => setGrounded(e.target.checked)} />
        <span>Grounded mode (use docs only)</span>
      </label>

      {/* Open GPT link */}
      <div className="mt-3 text-xs text-white/60">
        Prefer the full ChatGPT experience? <a className="underline" href={GPT_SHARE_URL} target="_blank" rel="noreferrer noopener" data-testid="gpt-link">Open the Concierge GPT</a>.
      </div>
    </motion.div>
  );
}

export default function App() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setIsDark(true), 900);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      id="app-root"
      data-theme={isDark ? "dark" : "light"}
      className={["min-h-screen transition-colors duration-1000", isDark ? "bg-neutral-950 text-neutral-100" : "bg-white text-neutral-900"].join(" ")}
    >
      {/* Ambient gradients */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
        <motion.div initial={{ opacity: 0.35 }} animate={{ opacity: isDark ? 0 : 0.35 }} transition={{ duration: 1 }} className="absolute -left-20 -top-24 h-80 w-80 rounded-full bg-indigo-300/40 blur-3xl" />
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: isDark ? 0.25 : 0 }} transition={{ duration: 1 }} className="absolute right-0 top-1/3 h-[32rem] w-[32rem] rounded-full bg-blue-500/20 blur-3xl" />
      </div>

      {/* Hero */}
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

      <DevTests />
    </div>
  );
}

// Lightweight runtime assertions (printed in console)
function DevTests() {
  useEffect(() => {
    const root = document.getElementById("app-root");
    console.groupCollapsed("[DevTests] Website of the Future");

    const concierge = document.querySelector('[data-testid="concierge-card"]');
    console.assert(!!concierge, "Concierge card should render");

    const input = document.querySelector('[data-testid="chat-input-row"] input') as HTMLInputElement | null;
    const button = document.querySelector('[data-testid="chat-input-row"] button');
    console.assert(!!input && input.placeholder.includes("Type a request"), "Chat input should be present with placeholder");
    console.assert(!!button, "Send button should be present");
    const sendBtn = button as HTMLButtonElement | null;
    console.assert(!!sendBtn && sendBtn.disabled === true, "Send should be disabled initially when input is empty");

    const tagline = document.querySelector('[data-testid="tagline"]');
    console.assert(!!tagline && tagline.textContent?.includes("Global Private Equity Real Estate"), "Tagline should be present and correct");

    const cities = document.querySelector('[data-testid="cities"]');
    const citiesOk = cities?.textContent?.includes("New York") && cities?.textContent?.includes("Toronto") && cities?.textContent?.includes("Riyadh");
    console.assert(!!citiesOk, "Cities list should include New York, Toronto, Riyadh");

    const initialTheme = root?.getAttribute("data-theme");
    console.assert(initialTheme === "light", "Initial theme should be light");

    const timeout = setTimeout(() => {
      const laterTheme = root?.getAttribute("data-theme");
      console.assert(laterTheme === "dark", "Theme should switch to dark after delay");

      const gptLink = document.querySelector('[data-testid="gpt-link"]') as HTMLAnchorElement | null;
      console.assert(!!gptLink && gptLink.href.includes("chatgpt.com"), "GPT link should be present");

      const logo = document.querySelector('[data-testid="cb-logo"]') as HTMLImageElement | null;
      console.assert(!!logo && !!logo.getAttribute("src"), "Logo should render with a src");
      console.assert(!!logo && (logo.alt || "").toLowerCase().includes("clifton"), "Logo should have descriptive alt text");

      // Debug ping (best-effort): prints when backend has debug implemented
      fetch("/api/concierge?debug=1")
        .then((r) => (r.ok ? r.json() : null))
        .then((info) => info && console.log("[Debug] /api/concierge?debug=1 →", info))
        .catch(() => undefined);

      console.groupEnd();
    }, 1200);

    return () => clearTimeout(timeout);
  }, []);

  return null;
}

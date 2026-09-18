import { useState, useEffect, useRef } from "react";
import { authFetch } from "../auth/Auth";
import { useIsMobile } from "../hooks/useIsMobile";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const C = {
  bg: "#0f0e0b",
  gold: "#c8a96e",
  goldFaint: "rgba(200,169,110,0.1)",
  goldMuted: "rgba(200,169,110,0.5)",
  text: "#e8dcc8",
  textMuted: "rgba(232,220,200,0.5)",
  border: "rgba(180,140,80,0.18)",
  surface: "rgba(22,20,15,0.98)",
};

const css = `
  @keyframes chat-fade { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
  @keyframes chat-blink { 0%,100% { opacity:1; } 50% { opacity:0; } }
  .chat-bubble { animation: chat-fade 0.2s ease; }
  .chat-session:hover { background: rgba(180,140,80,0.06) !important; }
  .chat-composer textarea::placeholder { color: rgba(232,220,200,0.3); }
  .chat-cursor { animation: chat-blink 1s step-end infinite; }
`;

function injectStyles() {
  if (typeof document !== "undefined" && !document.getElementById("chat-styles")) {
    const el = document.createElement("style");
    el.id = "chat-styles";
    el.textContent = css;
    document.head.appendChild(el);
  }
}

export default function ChatPage({ user, onNavigate }) {
  injectStyles();
  const isMobile = useIsMobile();
  const [mobileShowList, setMobileShowList] = useState(true);

  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [quota, setQuota] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef(null);

  useEffect(() => { loadSessions(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function loadSessions() {
    setLoading(true);
    try {
      const [sRes, qRes] = await Promise.all([
        authFetch(`${API}/chat/sessions`),
        authFetch(`${API}/chat/quota`).catch(() => null),
      ]);
      const s = sRes.ok ? await sRes.json() : [];
      setSessions(s);
      if (qRes?.ok) setQuota(await qRes.json());
      if (s.length) await openSession(s[0].id);
    } catch {
      setError("Could not load conversations.");
    } finally {
      setLoading(false);
    }
  }

  async function openSession(id) {
    setActiveId(id);
    setError("");
    setMobileShowList(false);
    const r = await authFetch(`${API}/chat/sessions/${id}/messages`);
    setMessages(r.ok ? await r.json() : []);
  }

  async function newChat() {
    const r = await authFetch(`${API}/chat/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New conversation" }),
    });
    if (!r.ok) return;
    const s = await r.json();
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    setMessages([]);
    setMobileShowList(false);
  }

  async function removeSession(id, e) {
    e.stopPropagation();
    await authFetch(`${API}/chat/sessions/${id}`, { method: "DELETE" });
    const rest = sessions.filter((s) => s.id !== id);
    setSessions(rest);
    if (activeId === id) {
      if (rest.length) openSession(rest[0].id);
      else { setActiveId(null); setMessages([]); }
    }
  }

  async function handleSend(e) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setError("");

    let sid = activeId;
    if (!sid) {
      const r = await authFetch(`${API}/chat/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: text.slice(0, 40) }),
      });
      if (r.status === 402) { setInput(text); return; }   // <TrialGate /> handles the prompt
      if (!r.ok) { setError("Could not start a conversation."); return; }
      const s = await r.json();
      sid = s.id;
      setSessions((prev) => [s, ...prev]);
      setActiveId(sid);
    }

    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setStreaming(true);

    try {
      const res = await authFetch(`${API}/chat/sessions/${sid}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });

      if (!res.ok) {
        let detail = await res.text();
        try { detail = JSON.parse(detail).detail ?? detail; } catch { /* keep raw */ }
        // detail is either a plain string or {reason, message} from the 402 gates
        const msg = (detail && typeof detail === "object") ? detail.message : detail;
        if (detail && typeof detail === "object" && (detail.reason === "trial_ended" || detail.reason === "limit_reached")) {
          setQuota((q) => ({ ...q, remaining: 0, trial_ended: detail.reason === "trial_ended" }));
        }
        throw new Error(msg || `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: copy[copy.length - 1].content + chunk };
          return copy;
        });
      }
      if (quota?.remaining != null) setQuota((q) => ({ ...q, remaining: Math.max(0, q.remaining - 1) }));
    } catch (err) {
      setMessages((m) => m.slice(0, -2)); // drop the optimistic user+assistant bubbles
      setError(err.message || "Something went wrong.");
      setInput(text);
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div style={{ display: "flex", height: "100%", fontFamily: "'EB Garamond', Georgia, serif" }}>
      {/* ── Session list ─────────────────────────────────────────────────── */}
      {(!isMobile || mobileShowList) && (
      <aside style={{
        width: isMobile ? "100%" : 240, flexShrink: 0, height: "100%", overflowY: "auto",
        borderRight: `1px solid ${C.border}`, background: C.surface,
      }}>
        <div style={{ padding: 14 }}>
          <button onClick={newChat} style={{
            width: "100%", padding: "9px 0", background: C.goldFaint,
            border: `1px solid ${C.border}`, borderRadius: 3,
            color: C.gold, fontFamily: "inherit", fontSize: 13,
            cursor: "pointer", letterSpacing: "0.04em",
          }}>+ New conversation</button>
        </div>
        {sessions.map((s) => (
          <div
            key={s.id}
            className="chat-session"
            onClick={() => openSession(s.id)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: 8, padding: "10px 14px", cursor: "pointer",
              background: s.id === activeId ? "rgba(180,140,80,0.1)" : "none",
              borderLeft: s.id === activeId ? `2px solid ${C.gold}` : "2px solid transparent",
            }}
          >
            <span style={{
              color: s.id === activeId ? C.gold : C.textMuted, fontSize: 13,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>{s.title}</span>
            <button
              onClick={(e) => removeSession(s.id, e)}
              title="Delete conversation"
              style={{
                background: "none", border: "none", color: "rgba(200,169,110,0.3)",
                cursor: "pointer", fontSize: 14, flexShrink: 0,
              }}
            >×</button>
          </div>
        ))}
        {!loading && sessions.length === 0 && (
          <div style={{ padding: "0 14px", color: C.textMuted, fontSize: 12 }}>
            No conversations yet.
          </div>
        )}
      </aside>
      )}

      {/* ── Conversation ─────────────────────────────────────────────────── */}
      {(!isMobile || !mobileShowList) && (
      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {isMobile && (
          <div style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}` }}>
            <button onClick={() => setMobileShowList(true)} style={{
              background: "none", border: `1px solid ${C.border}`, borderRadius: 3,
              color: C.gold, fontFamily: "inherit", fontSize: 12,
              cursor: "pointer", padding: "8px 14px", minHeight: 44,
            }}>← Conversations</button>
          </div>
        )}
        {quota?.remaining != null && quota.remaining > 0 && (
          <div style={{
            padding: "8px 24px", borderBottom: `1px solid ${C.border}`,
            color: C.textMuted, fontSize: 12,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            {quota.remaining} free chat message{quota.remaining === 1 ? "" : "s"} left this month
          </div>
        )}

        {quota?.remaining === 0 && (
          <div style={{
            padding: "8px 24px", borderBottom: `1px solid ${C.border}`,
            color: "#e07070", fontSize: 12,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            {quota.trial_ended
              ? "Your free trial has ended — subscribe to keep chatting with your journal."
              : "You've used this month's free chat messages."}
            <button onClick={() => onNavigate?.("billing")} style={{
              background: "none", border: "none", color: C.gold,
              cursor: "pointer", fontFamily: "inherit", fontSize: 12, textDecoration: "underline",
            }}>{quota.trial_ended ? "subscribe" : "upgrade"}</button>
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
          {messages.length === 0 && !loading && (
            <div style={{ maxWidth: 480, margin: "40px auto", textAlign: "center" }}>
              <h2 style={{ color: C.gold, fontStyle: "italic", fontWeight: 400, fontSize: 20, marginBottom: 10 }}>
                Chat with your journal
              </h2>
              <p style={{ color: C.textMuted, fontSize: 14, lineHeight: 1.6 }}>
                Ask anything — "what keeps coming up for me lately?",
                "how has my thinking on work changed?",
                "where do I contradict myself?"
              </p>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className="chat-bubble" style={{
              display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start",
              marginBottom: 14,
            }}>
              <div style={{
                maxWidth: "70%", padding: "10px 16px", borderRadius: 6,
                background: m.role === "user" ? C.goldFaint : "rgba(232,220,200,0.04)",
                border: `1px solid ${m.role === "user" ? C.border : "rgba(232,220,200,0.08)"}`,
                color: C.text, fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap",
              }}>
                {m.content || (streaming && i === messages.length - 1
                  ? <span className="chat-cursor">▍</span>
                  : "…")}
              </div>
            </div>
          ))}

          {error && (
            <div style={{
              margin: "10px 0", padding: "8px 14px", borderRadius: 3,
              background: "rgba(224,112,112,0.08)", border: "1px solid rgba(224,112,112,0.25)",
              color: "#e07070", fontSize: 13,
            }}>{error}</div>
          )}
          <div ref={bottomRef} />
        </div>

        {quota?.remaining === 0 ? (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 14,
            padding: "18px 28px", borderTop: `1px solid ${C.border}`,
          }}>
            <span style={{ color: C.textMuted, fontSize: 13 }}>
              {quota.trial_ended
                ? "Chat is paused until your subscription is active again."
                : "Chat is paused until next month, or upgrade for unlimited chat."}
            </span>
            <button onClick={() => onNavigate?.("billing")} style={{
              padding: "8px 18px", background: C.goldFaint, border: `1px solid ${C.border}`,
              borderRadius: 4, color: C.gold, fontFamily: "inherit", fontSize: 13, cursor: "pointer",
            }}>{quota.trial_ended ? "Update payment" : "Upgrade"}</button>
          </div>
        ) : (
          <form className="chat-composer" onSubmit={handleSend} style={{
            display: "flex", gap: 10, padding: "16px 28px",
            borderTop: `1px solid ${C.border}`,
          }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Ask about your thinking…"
              rows={2}
              disabled={streaming}
              style={{
                flex: 1, resize: "none", background: "rgba(232,220,200,0.03)",
                border: `1px solid ${C.border}`, borderRadius: 4, padding: "10px 12px",
                color: C.text, fontFamily: "inherit", fontSize: 14, outline: "none",
              }}
            />
            <button type="submit" disabled={streaming || !input.trim()} style={{
              padding: "0 20px", background: streaming || !input.trim() ? "rgba(200,169,110,0.08)" : C.goldFaint,
              border: `1px solid ${C.border}`, borderRadius: 4,
              color: streaming || !input.trim() ? "rgba(200,169,110,0.3)" : C.gold,
              fontFamily: "inherit", fontSize: 13, cursor: streaming || !input.trim() ? "default" : "pointer",
            }}>Send</button>
          </form>
        )}
      </main>
      )}
    </div>
  );
}

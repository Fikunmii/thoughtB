import { useState, useEffect, useRef, useCallback } from "react";
import { authFetch } from "../auth/Auth";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const C = {
  bg: "#0f0e0b", gold: "#c8a96e", goldFaint: "rgba(200,169,110,0.10)",
  goldMuted: "rgba(200,169,110,0.5)", text: "#e8dcc8",
  textMuted: "rgba(232,220,200,0.5)", border: "rgba(180,140,80,0.18)",
  surface: "rgba(22,20,15,0.98)",
};

const css = `
  @keyframes bd-fade  { from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);} }
  @keyframes bd-blink { 0%,100%{opacity:1;}50%{opacity:0;} }
  @keyframes bd-glow  { 0%,100%{box-shadow:0 0 0 rgba(200,169,110,0);}50%{box-shadow:0 0 28px rgba(200,169,110,0.07);} }
  .bd-btn:hover { border-color: rgba(200,169,110,0.6) !important; color: #c8a96e !important; }
  .bd-hist-item:hover { background: rgba(180,140,80,0.05) !important; cursor: pointer; }
`;

function inject() {
  if (!document.getElementById("bd-css")) {
    const s = document.createElement("style");
    s.id = "bd-css"; s.textContent = css;
    document.head.appendChild(s);
  }
}

// ── Streaming cursor ──────────────────────────────────────────────────────────
function Cursor() {
  return <span style={{ display: "inline-block", width: 2, height: "0.9em", background: C.gold, verticalAlign: "middle", margin: "0 1px", animation: "bd-blink 1s step-end infinite" }} />;
}

// ── Section renderer ──────────────────────────────────────────────────────────
function Section({ section, delay = 0 }) {
  return (
    <div style={{ marginBottom: 40, animation: `bd-fade 0.6s ease ${delay}ms both` }}>
      {section.title && (
        <h2 style={{
          fontFamily: "'EB Garamond', Georgia, serif",
          fontSize: 19, fontWeight: "normal", fontStyle: "italic",
          color: C.gold, marginBottom: 16, marginTop: 0,
          paddingBottom: 8, borderBottom: `1px solid ${C.border}`,
        }}>{section.title}</h2>
      )}
      {section.body?.split("\n\n").map((para, i) => (
        <p key={i} style={{
          color: C.text, fontSize: 16, lineHeight: 1.9,
          fontFamily: "'EB Garamond', Georgia, serif",
          margin: "0 0 18px 0",
        }}>{para}</p>
      ))}
      {section.concepts_mentioned?.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
          {section.concepts_mentioned.map(c => (
            <span key={c} style={{
              padding: "2px 9px", background: C.goldFaint,
              border: `1px solid ${C.border}`,
              borderRadius: 10, fontSize: 10, color: C.goldMuted,
            }}>{c}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Stream text renderer (plain markdown-ish text) ────────────────────────────
function StreamView({ text, isStreaming }) {
  // Split on markdown headers
  const parts = text.split(/^(##\s+.+)$/m).filter(Boolean);
  return (
    <div>
      {parts.map((part, i) => {
        if (part.startsWith("## ")) {
          return (
            <h2 key={i} style={{
              fontFamily: "'EB Garamond', Georgia, serif",
              fontSize: 19, fontWeight: "normal", fontStyle: "italic",
              color: C.gold, marginBottom: 14, marginTop: i > 0 ? 32 : 0,
              paddingBottom: 8, borderBottom: `1px solid ${C.border}`,
            }}>{part.replace(/^##\s+/, "")}</h2>
          );
        }
        return part.split("\n\n").filter(Boolean).map((para, j) => (
          <p key={`${i}-${j}`} style={{
            color: C.text, fontSize: 16, lineHeight: 1.9,
            fontFamily: "'EB Garamond', Georgia, serif",
            margin: "0 0 16px 0",
          }}>{para.trim()}</p>
        ));
      })}
      {isStreaming && <Cursor />}
    </div>
  );
}

// ── Settings panel ────────────────────────────────────────────────────────────
function GeneratePanel({ onGenerate, generating, status }) {
  const [periodStart,   setPeriodStart]   = useState("");
  const [periodEnd,     setPeriodEnd]     = useState("");
  const [focusConcept,  setFocusConcept]  = useState("");
  const [style,         setStyle]         = useState("literary");

  function submit() {
    onGenerate({
      period_start:  periodStart  || undefined,
      period_end:    periodEnd    || undefined,
      focus_concept: focusConcept || undefined,
      style,
    });
  }

  const inputStyle = {
    width: "100%", padding: "7px 10px",
    background: "rgba(15,14,11,0.8)", border: `1px solid ${C.border}`,
    borderRadius: 3, color: C.text, fontSize: 12,
    fontFamily: "inherit", boxSizing: "border-box", outline: "none",
  };

  return (
    <div style={{ padding: "20px 0" }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.12em", marginBottom: 5 }}>PERIOD (OPTIONAL)</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)}
            placeholder="Start" style={{ ...inputStyle, flex: 1 }} />
          <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)}
            placeholder="End" style={{ ...inputStyle, flex: 1 }} />
        </div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.12em", marginBottom: 5 }}>FOCUS CONCEPT (OPTIONAL)</div>
        <input
          value={focusConcept} onChange={e => setFocusConcept(e.target.value)}
          placeholder="e.g. Freedom, Ambition, Identity…"
          style={inputStyle}
        />
      </div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.12em", marginBottom: 5 }}>STYLE</div>
        <div style={{ display: "flex", gap: 6 }}>
          {["literary", "analytical", "reflective"].map(s => (
            <button key={s} onClick={() => setStyle(s)} style={{
              flex: 1, padding: "6px 0",
              background: style === s ? C.goldFaint : "none",
              border: `1px solid ${style === s ? C.gold : C.border}`,
              borderRadius: 3, color: style === s ? C.gold : C.textMuted,
              fontSize: 11, cursor: "pointer", fontFamily: "inherit",
              letterSpacing: "0.08em", textTransform: "capitalize",
              transition: "all 0.2s",
            }}>{s}</button>
          ))}
        </div>
      </div>
      {status && (
        <div style={{ marginBottom: 12, color: C.textMuted, fontSize: 12, fontStyle: "italic" }}>
          {status}
        </div>
      )}
      <button
        className="bd-btn"
        onClick={submit}
        disabled={generating}
        style={{
          width: "100%", padding: "10px 0",
          background: generating ? C.goldFaint : "none",
          border: `1px solid ${generating ? C.gold : C.border}`,
          borderRadius: 3, color: generating ? C.goldMuted : C.gold,
          fontSize: 12, letterSpacing: "0.12em", cursor: generating ? "default" : "pointer",
          fontFamily: "'EB Garamond', Georgia, serif",
          animation: generating ? "bd-glow 2s ease infinite" : "none",
          transition: "all 0.3s",
        }}
      >
        {generating ? "Generating…" : "Generate Biography"}
      </button>
    </div>
  );
}

// ── History item ──────────────────────────────────────────────────────────────
function HistoryItem({ bio, onClick }) {
  const date = new Date(bio.generated_at || Date.now());
  const label = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <div className="bd-hist-item" onClick={onClick} style={{
      padding: "10px 14px",
      borderBottom: `1px solid ${C.border}`,
      transition: "all 0.15s",
    }}>
      <div style={{ color: C.gold, fontSize: 12 }}>{label}</div>
      {bio.period_start && (
        <div style={{ color: C.textMuted, fontSize: 10, marginTop: 2 }}>
          {bio.period_start?.slice(0, 10)} – {bio.period_end?.slice(0, 10) || "present"}
        </div>
      )}
      <div style={{ color: C.textMuted, fontSize: 10, marginTop: 1, textTransform: "capitalize" }}>
        {bio.style || "literary"} style
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function BiographyDocument({ user, onNavigate }) {
  inject();

  const [tab,        setTab]        = useState("generate"); // generate | history
  const [generating, setGenerating] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [sections,   setSections]   = useState([]);
  const [status,     setStatus]     = useState(null);
  const [readiness,  setReadiness]  = useState(null);
  const [history,    setHistory]    = useState([]);
  const [histLoading,setHistLoading]= useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const abortRef = useRef(null);

  // Check readiness on mount
  useEffect(() => {
    authFetch(`${API}/biography`)
      .then(r => r.json())
      .then(d => setReadiness(d))
      .catch(() => setReadiness({ ready: false, entry_count: 0, min_required: 10, entries_needed: 10 }));
  }, []);

  // Load history when tab switches
  useEffect(() => {
    if (tab !== "history") return;
    setHistLoading(true);
    authFetch(`${API}/biography/history`)
      .then(r => r.json())
      .then(d => setHistory(d.biographies || []))
      .catch(() => {})
      .finally(() => setHistLoading(false));
  }, [tab]);

  const generate = useCallback(async (params) => {
    setGenerating(true);
    setStreamText("");
    setSections([]);
    setSaveStatus(null);
    setStatus("Analysing your concept graph…");

    try {
      // Use streaming endpoint
      const token = localStorage.getItem("tb_access_token") || "";
      const qs = new URLSearchParams();
      if (params.period_start)  qs.set("period_start",  params.period_start);
      if (params.period_end)    qs.set("period_end",    params.period_end);
      if (params.focus_concept) qs.set("focus_concept", params.focus_concept);
      qs.set("style", params.style || "literary");

      const res = await fetch(`${API}/biography/stream?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok || !res.body) throw new Error("Stream failed");

      setStatus("Writing your biography…");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") break;
          try {
            const obj = JSON.parse(raw);
            if (obj.text) {
              fullText += obj.text;
              setStreamText(fullText);
            }
            if (obj.error) throw new Error(obj.error);
          } catch (e) { /* partial JSON line — skip */ }
        }
      }

      setStatus("Done.");
      setGenerating(false);

    } catch (e) {
      // Fallback to non-streaming generate
      try {
        const res = await authFetch(`${API}/biography/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });
        if (!res.ok) throw new Error("Generate failed");
        const d = await res.json();
        setSections(d.sections || []);
        setStreamText("");
        setStatus(null);
      } catch (e2) {
        setSections(MOCK_SECTIONS);
        setStatus("Using sample biography — connect backend to generate yours.");
      }
      setGenerating(false);
    }
  }, []);

  async function saveCurrentBiography() {
    if (!sections.length && !streamText) return;
    setSaveStatus("Saving…");
    try {
      const res = await authFetch(`${API}/biography/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections, stream_text: streamText }),
      });
      if (res.ok) setSaveStatus("Saved.");
      else setSaveStatus("Save failed.");
    } catch {
      setSaveStatus("Save failed.");
    }
    setTimeout(() => setSaveStatus(null), 3000);
  }

  const hasBiography = sections.length > 0 || streamText.length > 0;

  return (
    <div style={{ display: "flex", height: "100%", fontFamily: "'EB Garamond', Georgia, serif", color: C.text }}>

      {/* ── Left panel ──────────────────────────────────────────────── */}
      <div style={{ width: 280, flexShrink: 0, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", background: "rgba(14,13,10,0.5)" }}>
        <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ color: C.gold, fontSize: 14 }}>Biography</div>
          <div style={{ color: C.textMuted, fontSize: 11, marginTop: 2 }}>Your intellectual life, written back to you</div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: `1px solid ${C.border}` }}>
          {["generate","history"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: "8px 0",
              background: tab === t ? C.goldFaint : "none",
              border: "none", borderBottom: `2px solid ${tab === t ? C.gold : "transparent"}`,
              color: tab === t ? C.gold : C.textMuted,
              fontSize: 11, cursor: "pointer", fontFamily: "inherit",
              letterSpacing: "0.1em", textTransform: "capitalize",
              transition: "all 0.2s",
            }}>{t}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 16px" }}>
          {tab === "generate" ? (
            <>
              {readiness && !readiness.ready && (
                <div style={{ padding: "14px 0", borderBottom: `1px solid ${C.border}`, marginBottom: 4 }}>
                  <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.6 }}>
                    You need {readiness.entries_needed} more {readiness.entries_needed === 1 ? "entry" : "entries"} before your biography can be generated.
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <div style={{ height: 4, background: "rgba(180,140,80,0.12)", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{
                        height: "100%", borderRadius: 2, background: C.gold,
                        width: `${Math.min(100, ((readiness.entry_count || 0) / readiness.min_required) * 100)}%`,
                        transition: "width 0.6s ease",
                      }} />
                    </div>
                    <div style={{ color: C.goldMuted, fontSize: 10, marginTop: 4 }}>
                      {readiness.entry_count || 0} / {readiness.min_required} entries
                    </div>
                  </div>
                </div>
              )}
              <GeneratePanel onGenerate={generate} generating={generating} status={status} />
            </>
          ) : (
            <div style={{ paddingTop: 8 }}>
              {histLoading ? (
                <div style={{ color: C.textMuted, fontSize: 12, padding: "20px 0", textAlign: "center" }}>Loading…</div>
              ) : history.length === 0 ? (
                <div style={{ color: C.textMuted, fontSize: 12, padding: "20px 0", textAlign: "center", fontStyle: "italic" }}>
                  No saved biographies yet.
                </div>
              ) : (
                history.map((bio, i) => (
                  <HistoryItem key={i} bio={bio} onClick={() => { setTab("generate"); setSections(JSON.parse(bio.sections_json || "[]")); setStreamText(""); }} />
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Right — document ─────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {hasBiography ? (
          <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 52px" }}>

            {/* Document header */}
            <div style={{ marginBottom: 40, paddingBottom: 24, borderBottom: `1px solid ${C.border}`, animation: "bd-fade 0.4s ease" }}>
              <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.16em", marginBottom: 8 }}>
                {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long" }).toUpperCase()}
              </div>
              <div style={{ fontSize: 30, color: C.text, fontStyle: "italic", lineHeight: 1.2 }}>
                An Intellectual Biography
              </div>
              <div style={{ color: C.goldMuted, fontSize: 14, marginTop: 6 }}>
                {user?.display_name || "The Thinker"}
              </div>
            </div>

            {/* Content */}
            {streamText ? (
              <StreamView text={streamText} isStreaming={generating} />
            ) : (
              sections.map((sec, i) => (
                <Section key={i} section={sec} delay={i * 100} />
              ))
            )}

            {/* Save button */}
            {!generating && (
              <div style={{ marginTop: 40, paddingTop: 24, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12 }}>
                <button className="bd-btn" onClick={saveCurrentBiography} style={{
                  padding: "8px 20px", background: "none",
                  border: `1px solid ${C.border}`, borderRadius: 3,
                  color: C.goldMuted, fontSize: 11, cursor: "pointer",
                  fontFamily: "inherit", letterSpacing: "0.1em",
                  transition: "all 0.2s",
                }}>
                  Save biography
                </button>
                {saveStatus && <span style={{ color: C.textMuted, fontSize: 12 }}>{saveStatus}</span>}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: 40 }}>
            <div style={{ textAlign: "center", maxWidth: 420 }}>
              <div style={{ fontSize: 40, opacity: 0.2, marginBottom: 16 }}>≡</div>
              <div style={{ fontSize: 20, fontStyle: "italic", color: C.gold, marginBottom: 10 }}>
                Your biography will appear here
              </div>
              <div style={{ color: C.textMuted, fontSize: 13, lineHeight: 1.7 }}>
                Every great thinker kept a record of how they changed their mind. Montaigne had his essays. Darwin had his notebooks. Wittgenstein had his diaries. This is yours — written back to you.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Mock sections ─────────────────────────────────────────────────────────────
const MOCK_SECTIONS = [
  {
    title: "The Years of Outward Motion",
    body: "Between 2021 and early 2022, your thinking moved in a single consistent direction: outward. Freedom appears 23 times in this period, almost always framed as departure — from obligation, from predictability, from the versions of yourself that other people had come to expect.\n\nThis was not restlessness for its own sake. It was a coherent argument: that growth required exposure to the unfamiliar, and that the familiar had accumulated around you so gradually that you hadn't noticed until it started to feel like a wall.",
    concepts_mentioned: ["Freedom", "Growth", "Obligation"],
    period: "2021 – early 2022",
  },
  {
    title: "The Contradiction That Wouldn't Resolve",
    body: "By mid-2022, a second voice emerged alongside the first. It did not argue with Freedom directly — it simply noted that the things you valued most were the ones you had chosen to stay for.\n\nYour knowledge graph marks this as the moment when Commitment first appeared in the same entry as Freedom. The tension score between these two concepts has not dropped below 80% since. This is not a failure of thinking. It is a sign that the thinking is honest.",
    concepts_mentioned: ["Freedom", "Commitment", "Belonging"],
    period: "Mid 2022 – 2023",
  },
  {
    title: "Viktor Frankl Arrived at the Right Moment",
    body: "The third period of your intellectual biography — the one still in progress — began in late 2023, when your framing of Freedom shifted for the third and most significant time. What had been escape, then tension, became something more precise: the gap between stimulus and response.\n\nYou have Frankl to thank for the language, but the idea had been preparing itself in your writing for two years. The book arrived when you were ready to receive it. That is rarely a coincidence.",
    concepts_mentioned: ["Freedom", "Meaning", "Responsibility"],
    period: "Late 2023 – Present",
  },
];
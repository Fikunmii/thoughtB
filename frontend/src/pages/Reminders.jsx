import { useState, useEffect } from "react";
import { authFetch } from "../auth/Auth";
import { Spinner, EmptyState } from "../components/ErrorBoundary";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const C = {
  gold: "#c8a96e", goldFaint: "rgba(200,169,110,0.08)", goldMuted: "rgba(200,169,110,0.5)",
  text: "#e8dcc8", textMuted: "rgba(232,220,200,0.5)",
  border: "rgba(180,140,80,0.18)", surface: "rgba(22,20,15,0.98)",
};

const css = `
  @keyframes rm-fade { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }
  .rm-prompt:hover { border-color: rgba(180,140,80,0.4) !important; background: rgba(26,23,17,0.98) !important; }
`;

function inject() {
  if (!document.getElementById("rm-styles")) {
    const el = document.createElement("style"); el.id = "rm-styles"; el.textContent = css;
    document.head.appendChild(el);
  }
}

// ── Prompt card ───────────────────────────────────────────────────────────────
function PromptCard({ prompt, concept, type, date, onWrite, delay = 0 }) {
  const typeColors = {
    contradiction: "#e07070", drift: "#c8a96e", silence: "#8ab8d0", open: "#90c890",
  };
  const typeLabels = {
    contradiction: "Unresolved tension", drift: "Shifting concept", silence: "Long absence", open: "Open question",
  };
  return (
    <div className="rm-prompt" onClick={() => onWrite?.(prompt)} style={{
      padding: "20px 22px",
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderLeft: `3px solid ${typeColors[type] || C.gold}`,
      borderRadius: 4, marginBottom: 12,
      cursor: "pointer",
      transition: "all 0.2s",
      animation: `rm-fade 0.4s ease ${delay}ms both`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <span style={{
          padding: "2px 8px",
          background: `${typeColors[type] || C.gold}22`,
          border: `1px solid ${typeColors[type] || C.gold}44`,
          borderRadius: 10, fontSize: 10, letterSpacing: "0.1em",
          color: typeColors[type] || C.gold,
          textTransform: "uppercase",
        }}>{typeLabels[type] || type}</span>
        {concept && (
          <span style={{ color: C.goldMuted, fontSize: 11 }}>◎ {concept}</span>
        )}
      </div>
      <div style={{ color: C.text, fontSize: 15, lineHeight: 1.75, fontStyle: "italic", marginBottom: 8 }}>
        "{prompt}"
      </div>
      <div style={{ color: C.goldMuted, fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
        <span>Click to write on this →</span>
      </div>
    </div>
  );
}

// ── Reminders view ────────────────────────────────────────────────────────────
export default function Reminders({ onNavigate }) {
  inject();
  const [prompts,    setPrompts]    = useState(null);
  const [digest,     setDigest]     = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [generating, setGenerating] = useState(false);
  const [settings,   setSettings]   = useState({ weekly_email: false, in_app: true, frequency: "weekly" });
  const [saved,      setSaved]      = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [pr, dg] = await Promise.all([
        authFetch(`${API}/reminders/prompts`).then(r => r.json()),
        authFetch(`${API}/reminders/digest`).then(r => r.json()),
      ]);
      setPrompts(pr.prompts || []);
      setDigest(dg);
    } catch {
      setPrompts(MOCK_PROMPTS);
      setDigest(MOCK_DIGEST);
    } finally {
      setLoading(false);
    }
  }

  async function regenerate() {
    setGenerating(true);
    try {
      const res = await authFetch(`${API}/reminders/generate`, { method: "POST" });
      const data = await res.json();
      setPrompts(data.prompts || []);
    } catch {
      setPrompts(MOCK_PROMPTS.map(p => ({ ...p, prompt: p.prompt + " (regenerated)" })));
    } finally {
      setGenerating(false);
    }
  }

  async function saveSettings() {
    try {
      await authFetch(`${API}/reminders/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
    } catch {}
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  useEffect(() => { load(); }, []);

  if (loading) return <Spinner message="Loading your reflection prompts..." />;

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr 300px", height: "100%",
      fontFamily: "'EB Garamond', Georgia, serif", color: C.text,
    }}>
      {/* Main area */}
      <div style={{ padding: "32px 36px", overflowY: "auto" }}>
        {/* Digest banner */}
        {digest && (
          <div style={{
            padding: "18px 22px", marginBottom: 28,
            background: "rgba(180,140,80,0.06)",
            border: `1px solid ${C.border}`,
            borderRadius: 4,
            animation: "rm-fade 0.4s ease",
          }}>
            <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.14em", marginBottom: 8, textTransform: "uppercase" }}>
              Weekly digest · {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </div>
            <div style={{ color: C.text, fontSize: 15, lineHeight: 1.75 }}>
              {digest.summary}
            </div>
            <div style={{ display: "flex", gap: 20, marginTop: 14 }}>
              {digest.stats?.map((s, i) => (
                <div key={i}>
                  <div style={{ color: C.gold, fontSize: 22, fontStyle: "italic" }}>{s.value}</div>
                  <div style={{ color: C.textMuted, fontSize: 11 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Prompts header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <div style={{ color: C.gold, fontSize: 20, fontStyle: "italic" }}>Reflection prompts</div>
            <div style={{ color: C.textMuted, fontSize: 13, marginTop: 2 }}>
              Generated from your graph — places where your writing wants to go
            </div>
          </div>
          <button onClick={regenerate} disabled={generating} style={{
            padding: "9px 18px",
            background: "none",
            border: `1px solid ${C.border}`,
            borderRadius: 3,
            color: generating ? C.goldMuted : C.gold,
            fontSize: 12, letterSpacing: "0.1em",
            cursor: generating ? "not-allowed" : "pointer",
            fontFamily: "inherit",
          }}>
            {generating ? "Generating..." : "↻ Regenerate"}
          </button>
        </div>

        {prompts?.length > 0 ? (
          prompts.map((p, i) => (
            <PromptCard key={i} {...p} delay={i * 60}
              onWrite={(prompt) => onNavigate?.("journal", { prompt })} />
          ))
        ) : (
          <EmptyState icon="?" title="No prompts yet"
            subtitle="Write a few entries to let the system learn your patterns. Prompts will surface from your graph." />
        )}
      </div>

      {/* Settings sidebar */}
      <div style={{
        borderLeft: `1px solid ${C.border}`,
        padding: "28px 22px",
        background: C.surface,
        overflowY: "auto",
        display: "flex", flexDirection: "column", gap: 22,
      }}>
        <div style={{ color: C.gold, fontSize: 15, fontStyle: "italic" }}>Reminder settings</div>

        <div>
          <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.14em", marginBottom: 10, textTransform: "uppercase" }}>
            Delivery
          </div>
          {[
            { key: "in_app",       label: "In-app digest",   desc: "Show digest on dashboard" },
            { key: "weekly_email", label: "Weekly email",    desc: "Sent every Sunday morning" },
          ].map(({ key, label, desc }) => (
            <div key={key} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "10px 0",
              borderBottom: `1px solid ${C.border}`,
            }}>
              <div>
                <div style={{ color: C.text, fontSize: 13 }}>{label}</div>
                <div style={{ color: C.textMuted, fontSize: 11 }}>{desc}</div>
              </div>
              <div
                onClick={() => setSettings(s => ({ ...s, [key]: !s[key] }))}
                style={{
                  width: 38, height: 20, borderRadius: 10,
                  background: settings[key] ? "rgba(200,169,110,0.4)" : "rgba(180,140,80,0.1)",
                  border: `1px solid ${settings[key] ? "rgba(200,169,110,0.6)" : C.border}`,
                  cursor: "pointer", position: "relative", transition: "all 0.2s",
                }}>
                <div style={{
                  position: "absolute", top: 2,
                  left: settings[key] ? 18 : 2,
                  width: 14, height: 14, borderRadius: "50%",
                  background: settings[key] ? C.gold : "rgba(180,140,80,0.4)",
                  transition: "left 0.2s, background 0.2s",
                }} />
              </div>
            </div>
          ))}
        </div>

        <div>
          <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.14em", marginBottom: 10, textTransform: "uppercase" }}>
            Frequency
          </div>
          {[["daily", "Daily"], ["weekly", "Weekly"], ["biweekly", "Every 2 weeks"]].map(([k, l]) => (
            <button key={k} onClick={() => setSettings(s => ({ ...s, frequency: k }))} style={{
              display: "block", width: "100%",
              padding: "8px 12px", marginBottom: 4,
              background: settings.frequency === k ? C.goldFaint : "none",
              border: `1px solid ${settings.frequency === k ? "rgba(180,140,80,0.35)" : "transparent"}`,
              borderRadius: 3,
              color: settings.frequency === k ? C.gold : C.textMuted,
              fontSize: 12, textAlign: "left",
              cursor: "pointer", fontFamily: "inherit",
            }}>{l}</button>
          ))}
        </div>

        <button onClick={saveSettings} style={{
          padding: "11px", marginTop: "auto",
          background: saved ? "rgba(120,180,120,0.1)" : C.goldFaint,
          border: `1px solid ${saved ? "rgba(120,180,120,0.3)" : C.border}`,
          borderRadius: 3,
          color: saved ? "#8aba8a" : C.gold,
          fontSize: 12, letterSpacing: "0.1em",
          cursor: "pointer", fontFamily: "inherit",
          transition: "all 0.2s",
        }}>
          {saved ? "✓ Saved" : "Save settings"}
        </button>
      </div>
    </div>
  );
}

// ── Mock ──────────────────────────────────────────────────────────────────────
const MOCK_PROMPTS = [
  { prompt: "You haven't written about Freedom in 18 days, but it appeared implicitly in your last four entries. What would it look like to name it directly?", concept: "Freedom", type: "silence" },
  { prompt: "The tension between Ambition and Contentment has been unresolved for 14 months. What would it cost you to resolve it in favor of one?", concept: "Ambition", type: "contradiction" },
  { prompt: "Your definition of 'Success' has shifted three times in two years. What do you believe about it right now, at this exact moment?", concept: "Success", type: "drift" },
  { prompt: "Last month you asked: 'When does caution become cowardice?' You haven't returned to it. Has something changed?", concept: "Courage", type: "open" },
  { prompt: "You've mentioned Viktor Frankl in 11 entries but never written directly about what you think he got wrong. What did he miss?", concept: "Meaning", type: "silence" },
];

const MOCK_DIGEST = {
  summary: "This week you wrote 3 entries, introduced 2 new concepts, and left 1 open question unanswered. The word 'enough' appeared 7 times across different contexts — more than any other week in your record.",
  stats: [
    { value: 3,  label: "entries this week" },
    { value: 7,  label: "times 'enough'" },
    { value: 2,  label: "new concepts" },
    { value: 12, label: "open tensions" },
  ],
};
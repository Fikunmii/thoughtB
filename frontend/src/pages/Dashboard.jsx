import { useState, useEffect } from "react";
import { authFetch } from "../auth/Auth";
import { DashboardSkeleton, EmptyState, ErrorMessage } from "../components/ErrorBoundary";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const C = {
  bg: "#0f0e0b",
  gold: "#c8a96e",
  goldFaint: "rgba(200,169,110,0.12)",
  goldMuted: "rgba(200,169,110,0.5)",
  text: "#e8dcc8",
  textMuted: "rgba(232,220,200,0.5)",
  border: "rgba(180,140,80,0.18)",
  surface: "rgba(22,20,15,0.98)",
};

const css = `
  @keyframes dash-fade { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
  @keyframes dash-glow { 0%,100% { box-shadow: 0 0 0 rgba(200,169,110,0); } 50% { box-shadow: 0 0 24px rgba(200,169,110,0.08); } }
  .dash-card:hover { border-color: rgba(180,140,80,0.35) !important; background: rgba(26,23,17,0.98) !important; }
  .dash-entry:hover { background: rgba(180,140,80,0.06) !important; }
`;

function injectStyles() {
  if (typeof document !== "undefined" && !document.getElementById("dash-styles")) {
    const el = document.createElement("style");
    el.id = "dash-styles";
    el.textContent = css;
    document.head.appendChild(el);
  }
}

// ── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon, delay = 0 }) {
  return (
    <div className="dash-card" style={{
      padding: "20px 22px",
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 4,
      transition: "all 0.25s",
      animation: `dash-fade 0.5s ease ${delay}ms both`,
    }}>
      <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.16em", marginBottom: 10, textTransform: "uppercase" }}>
        {icon} {label}
      </div>
      <div style={{ color: C.gold, fontSize: 32, fontFamily: "'EB Garamond', Georgia, serif", fontStyle: "italic", lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ color: C.textMuted, fontSize: 12, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

// ── Open question card ───────────────────────────────────────────────────────
function QuestionCard({ question, entry_date, concept }) {
  return (
    <div style={{
      padding: "14px 16px",
      background: "rgba(180,140,80,0.04)",
      border: `1px solid ${C.border}`,
      borderLeft: `3px solid ${C.gold}`,
      borderRadius: 3,
      marginBottom: 10,
    }}>
      <div style={{ color: C.text, fontSize: 14, lineHeight: 1.6, marginBottom: 8, fontStyle: "italic" }}>
        "{question}"
      </div>
      <div style={{ color: C.goldMuted, fontSize: 11, letterSpacing: "0.1em" }}>
        {concept && <span style={{ marginRight: 12 }}>◎ {concept}</span>}
        {entry_date && <span>{new Date(entry_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>}
      </div>
    </div>
  );
}

// ── Contradiction pill ───────────────────────────────────────────────────────
function ContraRow({ c1, c2, tension_score }) {
  const pct = Math.round((tension_score || 0.5) * 100);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 0",
      borderBottom: `1px solid ${C.border}`,
    }}>
      <div style={{ flex: 1 }}>
        <span style={{ color: C.gold, fontSize: 13 }}>{c1}</span>
        <span style={{ color: C.textMuted, fontSize: 11, margin: "0 8px" }}>⟷</span>
        <span style={{ color: C.gold, fontSize: 13 }}>{c2}</span>
      </div>
      <div style={{
        width: 80, height: 4,
        background: "rgba(180,140,80,0.15)", borderRadius: 2, overflow: "hidden",
      }}>
        <div style={{
          height: "100%", width: `${pct}%`,
          background: pct > 70 ? "#e07070" : pct > 40 ? "#c8a96e" : "#7ab87a",
          borderRadius: 2, transition: "width 0.8s ease",
        }} />
      </div>
      <div style={{ color: C.textMuted, fontSize: 11, width: 28, textAlign: "right" }}>{pct}%</div>
    </div>
  );
}

// ── Concept drift pill ───────────────────────────────────────────────────────
function DriftPill({ label, stability }) {
  const stable = (stability || 1) > 0.7;
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "5px 12px",
      background: stable ? "rgba(120,180,120,0.08)" : "rgba(180,140,80,0.1)",
      border: `1px solid ${stable ? "rgba(120,180,120,0.25)" : "rgba(180,140,80,0.3)"}`,
      borderRadius: 12, fontSize: 12,
      color: stable ? "#8aba8a" : C.gold,
      marginRight: 6, marginBottom: 6,
    }}>
      <span style={{ fontSize: 8 }}>{stable ? "●" : "◉"}</span>
      {label}
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function Dashboard({ onNavigate, user }) {
  injectStyles();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await authFetch(`${API}/dashboard`);
      if (!res.ok) throw new Error("Failed to load dashboard");
      const d = await res.json();
      setData(d);
    } catch (e) {
      setError(e.message);
      // Use rich mock data for development
      setData(MOCK_DATA);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) return <DashboardSkeleton />;

  const d = data || MOCK_DATA;

  // Greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const name = user?.display_name?.split(" ")[0] || "friend";

  return (
    <div style={{
      padding: "32px 40px",
      fontFamily: "'EB Garamond', Georgia, serif",
      color: C.text,
      maxWidth: 1100,
    }}>
      {error && (
        <div style={{ marginBottom: 16, padding: "8px 14px", background: "rgba(180,60,60,0.08)", border: "1px solid rgba(180,60,60,0.2)", borderRadius: 3, color: "rgba(224,112,112,0.7)", fontSize: 12 }}>
          Using sample data — connect backend to see your real graph.
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 36, animation: "dash-fade 0.4s ease" }}>
        <div style={{ color: C.goldMuted, fontSize: 12, letterSpacing: "0.16em", marginBottom: 6, textTransform: "uppercase" }}>
          {new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </div>
        <div style={{ fontSize: 28, fontStyle: "italic", color: C.gold }}>
          {greeting}, {name}.
        </div>
        {d.last_entry_ago != null && (
          <div style={{ color: C.textMuted, fontSize: 14, marginTop: 4 }}>
            {d.last_entry_ago === 0
              ? "You wrote today. Your graph is current."
              : `You last wrote ${d.last_entry_ago} day${d.last_entry_ago > 1 ? "s" : ""} ago.`}
          </div>
        )}
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 32 }}>
        <StatCard label="Entries"        value={d.stats.entries}      sub="total written"       icon="✦" delay={0}   />
        <StatCard label="Concepts"       value={d.stats.concepts}     sub="mapped in your graph" icon="◎" delay={60}  />
        <StatCard label="Contradictions" value={d.stats.contradictions} sub={`${d.stats.resolved} resolved`} icon="⟷" delay={120} />
        <StatCard label="Influences"     value={d.stats.influences}   sub="people & sources"    icon="→" delay={180} />
      </div>

      {/* Main grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 20 }}>

        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Latest entry */}
          <Section title="Most recent entry" action="All entries →" onAction={() => onNavigate?.("journal")}>
            {d.latest_entry ? (
              <div style={{
                padding: "16px 18px",
                background: C.goldFaint,
                border: `1px solid ${C.border}`,
                borderRadius: 3,
                animation: "dash-fade 0.5s ease 0.2s both",
              }}>
                <div style={{ color: C.textMuted, fontSize: 11, letterSpacing: "0.1em", marginBottom: 10 }}>
                  {new Date(d.latest_entry.created_at).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                  {" · "}
                  <span style={{ fontStyle: "italic" }}>{d.latest_entry.emotional_tone}</span>
                </div>
                <div style={{ color: C.text, fontSize: 15, lineHeight: 1.7, fontStyle: "italic" }}>
                  "{d.latest_entry.excerpt}"
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
                  {d.latest_entry.concepts?.map(c => (
                    <span key={c} style={{
                      padding: "3px 10px",
                      background: "rgba(180,140,80,0.1)",
                      border: `1px solid ${C.border}`,
                      borderRadius: 10, fontSize: 11, color: C.gold,
                    }}>{c}</span>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState icon="✦" title="No entries yet"
                subtitle="Write your first journal entry to begin your thought biography."
                action="Write now" onAction={() => onNavigate?.("journal")} />
            )}
          </Section>

          {/* Open questions */}
          <Section title="Open questions" sub={`${d.open_questions?.length || 0} unresolved`} action="Resolve →" onAction={() => onNavigate?.("contradictions")}>
            {d.open_questions?.length > 0
              ? d.open_questions.slice(0, 3).map((q, i) => (
                  <QuestionCard key={i} {...q} />
                ))
              : <EmptyState icon="?" title="No open questions" subtitle="Questions surface as your writing reveals unresolved tensions." />
            }
          </Section>
        </div>

        {/* Right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Contradiction tensions */}
          <Section title="Active contradictions" action="Full view →" onAction={() => onNavigate?.("contradictions")}>
            {d.contradictions?.length > 0
              ? d.contradictions.slice(0, 4).map((c, i) => <ContraRow key={i} {...c} />)
              : <EmptyState icon="⟷" title="No contradictions" subtitle="Tensions will surface as your graph grows." />
            }
          </Section>

          {/* Shifting concepts */}
          <Section title="Concepts in flux" sub="definition shifting recently">
            <div style={{ display: "flex", flexWrap: "wrap", paddingTop: 4 }}>
              {d.shifting_concepts?.length > 0
                ? d.shifting_concepts.map((c, i) => <DriftPill key={i} label={c.label} stability={c.stability} />)
                : <div style={{ color: C.textMuted, fontSize: 13 }}>All concepts are stable.</div>
              }
            </div>
          </Section>

          {/* Prompt of the day */}
          {d.daily_prompt && (
            <Section title="Today's reflection">
              <div style={{
                padding: "14px 16px",
                background: "rgba(180,140,80,0.05)",
                border: `1px solid ${C.border}`,
                borderLeft: `3px solid rgba(180,140,80,0.6)`,
                borderRadius: 3,
                color: C.text, fontSize: 14, lineHeight: 1.7, fontStyle: "italic",
              }}>
                {d.daily_prompt}
              </div>
              <button onClick={() => onNavigate?.("journal")} style={{
                marginTop: 10, padding: "8px 16px",
                background: "none",
                border: `1px solid ${C.border}`,
                borderRadius: 3,
                color: C.gold, fontSize: 12, letterSpacing: "0.1em",
                cursor: "pointer",
                fontFamily: "'EB Garamond', Georgia, serif",
              }}>
                Write on this →
              </button>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, sub, action, onAction, children }) {
  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 4,
      overflow: "hidden",
    }}>
      <div style={{
        padding: "14px 18px",
        borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <span style={{ color: C.gold, fontSize: 13, letterSpacing: "0.06em" }}>{title}</span>
          {sub && <span style={{ color: C.textMuted, fontSize: 11, marginLeft: 10 }}>{sub}</span>}
        </div>
        {action && (
          <button onClick={onAction} style={{
            background: "none", border: "none",
            color: C.goldMuted, fontSize: 11, letterSpacing: "0.1em",
            cursor: "pointer", fontFamily: "inherit",
          }}>{action}</button>
        )}
      </div>
      <div style={{ padding: "16px 18px" }}>{children}</div>
    </div>
  );
}

// ── Mock data (shown when backend offline) ────────────────────────────────────
const MOCK_DATA = {
  last_entry_ago: 2,
  stats: { entries: 47, concepts: 83, contradictions: 12, resolved: 7, influences: 24 },
  latest_entry: {
    created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
    emotional_tone: "searching",
    excerpt: "I keep returning to the question of whether discipline is a form of care or a form of control. The answer changes depending on who's doing it, and to whom.",
    concepts: ["Discipline", "Freedom", "Control"],
  },
  open_questions: [
    { question: "Is ambition fundamentally in tension with contentment, or can they coexist?", concept: "Ambition", entry_date: new Date(Date.now() - 5 * 86400000).toISOString() },
    { question: "What would you do differently if there were no one to witness it?", concept: "Identity", entry_date: new Date(Date.now() - 12 * 86400000).toISOString() },
    { question: "When does caution become cowardice?", concept: "Courage", entry_date: new Date(Date.now() - 21 * 86400000).toISOString() },
  ],
  contradictions: [
    { c1: "Freedom",    c2: "Belonging",    tension_score: 0.85 },
    { c1: "Ambition",   c2: "Contentment",  tension_score: 0.72 },
    { c1: "Discipline", c2: "Spontaneity",  tension_score: 0.58 },
    { c1: "Solitude",   c2: "Connection",   tension_score: 0.44 },
  ],
  shifting_concepts: [
    { label: "Success",     stability: 0.38 },
    { label: "Home",        stability: 0.55 },
    { label: "Discipline",  stability: 0.61 },
    { label: "Identity",    stability: 0.82 },
    { label: "Meaning",     stability: 0.91 },
  ],
  daily_prompt: "Your last three entries all circle the word 'enough' without landing on it. What would it mean for something to truly be enough?",
};
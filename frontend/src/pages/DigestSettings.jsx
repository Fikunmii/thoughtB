import { useState, useEffect } from "react";
import { authFetch } from "../auth/Auth";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const C = {
  bg: "#0f0e0b", gold: "#c8a96e", goldFaint: "rgba(200,169,110,0.10)",
  goldMuted: "rgba(200,169,110,0.5)", text: "#e8dcc8",
  textMuted: "rgba(232,220,200,0.5)", border: "rgba(180,140,80,0.18)",
  surface: "rgba(22,20,15,0.98)",
};

const css = `
  @keyframes ds-fade { from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);} }
  .ds-btn:hover  { border-color: rgba(200,169,110,0.6) !important; color: #c8a96e !important; }
  .ds-day:hover  { border-color: rgba(200,169,110,0.4) !important; }
  .ds-day.active { border-color: #c8a96e !important; background: rgba(200,169,110,0.1) !important; color: #c8a96e !important; }
`;

function inject() {
  if (!document.getElementById("ds-css")) {
    const s = document.createElement("style");
    s.id = "ds-css"; s.textContent = css;
    document.head.appendChild(s);
  }
}

const DAYS    = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
const HOURS   = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: i === 0 ? "12 am" : i < 12 ? `${i} am` : i === 12 ? "12 pm" : `${i - 12} pm`,
}));

// ── Concept badge for preview ─────────────────────────────────────────────────
function ConceptBadge({ name }) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 9px",
      background: C.goldFaint, border: `1px solid ${C.border}`,
      borderRadius: 10, fontSize: 11, color: C.gold,
      fontFamily: "Georgia, serif",
      marginRight: 4, marginBottom: 3,
    }}>{name}</span>
  );
}

// ── Signal section in preview ─────────────────────────────────────────────────
function SignalSection({ title, items }) {
  if (!items?.length) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ color: C.goldMuted, fontSize: 9, letterSpacing: "0.15em", marginBottom: 6, textTransform: "uppercase" }}>{title}</div>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
          {item.concept_a ? (
            <>
              <ConceptBadge name={item.concept_a} />
              <span style={{ color: C.textMuted }}>⟷</span>
              <ConceptBadge name={item.concept_b} />
              {item.score !== undefined && (
                <span style={{ color: C.textMuted, marginLeft: "auto", fontSize: 10 }}>tension {item.score}</span>
              )}
              {item.delta !== undefined && (
                <span style={{ color: item.delta > 0 ? "#c0392b" : "#27ae60", marginLeft: "auto", fontSize: 10 }}>
                  {item.delta > 0 ? "↑" : "↓"} {Math.abs(item.delta)} pts
                </span>
              )}
            </>
          ) : (
            <>
              <ConceptBadge name={item.concept} />
              {item.dormant_days && (
                <span style={{ color: C.textMuted, fontSize: 10 }}>silent for {item.dormant_days} days</span>
              )}
              {item.current_stability !== undefined && (
                <span style={{ color: C.gold, fontSize: 10, marginLeft: "auto" }}>stability {item.current_stability}</span>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Digest preview card ───────────────────────────────────────────────────────
function DigestPreview({ preview }) {
  if (!preview) return null;
  const { narrative, signals, stats, week_ending } = preview;

  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 4,
      background: C.surface, overflow: "hidden",
      animation: "ds-fade 0.4s ease",
    }}>
      {/* Email header */}
      <div style={{ padding: "16px 20px", borderBottom: `2px solid ${C.gold}`, background: "rgba(14,13,10,0.6)" }}>
        <div style={{ color: C.goldMuted, fontSize: 9, letterSpacing: "0.15em", marginBottom: 4 }}>THOUGHT BIOGRAPHY</div>
        <div style={{ color: C.text, fontSize: 15, fontFamily: "Georgia, serif" }}>Your week in thought</div>
        {week_ending && (
          <div style={{ color: C.textMuted, fontSize: 10, marginTop: 3 }}>Week ending {week_ending}</div>
        )}
      </div>

      {/* Narrative */}
      {narrative && (
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}` }}>
          <p style={{
            margin: 0, color: C.text, fontSize: 13, lineHeight: 1.8,
            fontFamily: "Georgia, serif", fontStyle: "italic",
          }}>{narrative}</p>
        </div>
      )}

      {/* Signals */}
      <div style={{ padding: "14px 20px" }}>
        <SignalSection title="New contradictions" items={signals?.new_contradictions} />
        <SignalSection title="Tensions that shifted" items={signals?.shifted_tensions} />
        <SignalSection title="Concepts that reappeared" items={signals?.reappeared_concepts} />
        <SignalSection title="Stability milestones" items={signals?.milestones} />

        {signals?.most_active?.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: C.goldMuted, fontSize: 9, letterSpacing: "0.15em", marginBottom: 6, textTransform: "uppercase" }}>Most active this week</div>
            <div>{signals.most_active.map(c => <ConceptBadge key={c.concept} name={c.concept} />)}</div>
          </div>
        )}

        {stats && (
          <div style={{ color: C.textMuted, fontSize: 10, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
            {stats.total_entries} entries &nbsp;·&nbsp; {stats.total_concepts} concepts &nbsp;·&nbsp; {stats.total_contradictions} active tensions
          </div>
        )}
      </div>

      {/* CTA */}
      <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.border}`, textAlign: "center" }}>
        <div style={{ display: "inline-block", padding: "8px 20px", background: "rgba(22,20,15,0.9)", border: `1px solid ${C.border}`, borderRadius: 2, color: C.gold, fontSize: 11, letterSpacing: "0.08em" }}>
          Open your graph →
        </div>
      </div>
    </div>
  );
}

// ── Toggle ────────────────────────────────────────────────────────────────────
function Toggle({ checked, onChange, label }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
      <div
        onClick={() => onChange(!checked)}
        style={{
          width: 36, height: 20, borderRadius: 10,
          background: checked ? C.gold : "rgba(180,140,80,0.2)",
          position: "relative", transition: "background 0.25s",
          cursor: "pointer",
        }}
      >
        <div style={{
          position: "absolute", top: 3, left: checked ? 18 : 3,
          width: 14, height: 14, borderRadius: 7,
          background: checked ? "#1a1611" : "rgba(200,169,110,0.5)",
          transition: "left 0.25s",
        }} />
      </div>
      <span style={{ color: checked ? C.text : C.textMuted, fontSize: 13 }}>{label}</span>
    </label>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function DigestSettings({ user }) {
  inject();

  const [settings, setSettings]     = useState(null);
  const [loading,  setLoading]      = useState(true);
  const [saving,   setSaving]       = useState(false);
  const [saveMsg,  setSaveMsg]      = useState(null);
  const [preview,  setPreview]      = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [testing,  setTesting]      = useState(false);
  const [testMsg,  setTestMsg]      = useState(null);

  // Load current settings
  useEffect(() => {
    authFetch(`${API}/digest/settings`)
      .then(r => r.json())
      .then(d => setSettings({ enabled: true, day_of_week: "sunday", hour: 8, timezone: "UTC", ...d }))
      .catch(() => setSettings({ enabled: true, day_of_week: "sunday", hour: 8, timezone: "UTC" }))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    if (!settings) return;
    setSaving(true); setSaveMsg(null);
    try {
      const res = await authFetch(`${API}/digest/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      setSaveMsg(res.ok ? "Settings saved." : "Save failed.");
    } catch {
      setSaveMsg("Save failed.");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 3000);
    }
  }

  async function loadPreview() {
    setPreviewing(true); setPreview(null);
    try {
      const res = await authFetch(`${API}/digest/preview`, { method: "POST" });
      if (res.ok) setPreview(await res.json());
      else setPreview(MOCK_PREVIEW);
    } catch {
      setPreview(MOCK_PREVIEW);
    } finally {
      setPreviewing(false);
    }
  }

  async function sendTest() {
    setTesting(true); setTestMsg(null);
    try {
      const res = await authFetch(`${API}/digest/test`, { method: "POST" });
      const d = await res.json();
      setTestMsg(res.ok ? `Test sent to ${user?.email || "your email"}.` : d.detail || "Failed to send.");
    } catch {
      setTestMsg("Failed to send test.");
    } finally {
      setTesting(false);
      setTimeout(() => setTestMsg(null), 5000);
    }
  }

  function update(key, val) {
    setSettings(prev => ({ ...prev, [key]: val }));
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: C.goldMuted, fontSize: 13, fontFamily: "'EB Garamond',Georgia,serif" }}>
        Loading digest settings…
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 40px", fontFamily: "'EB Garamond', Georgia, serif", color: C.text }}>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.16em", marginBottom: 6 }}>TOOLS &nbsp;·&nbsp; SETTINGS</div>
        <div style={{ fontSize: 26, color: C.gold, fontStyle: "italic" }}>Weekly Digest</div>
        <div style={{ color: C.textMuted, fontSize: 13, marginTop: 4, lineHeight: 1.6 }}>
          Every week, Thought Biography checks what moved in your graph and writes you a short email. New contradictions. Concepts that reappeared. Beliefs that shifted.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>

        {/* ── Left: settings ─────────────────────────────────────────── */}
        <div>
          {/* Enable toggle */}
          <div style={{ padding: "16px 0", borderBottom: `1px solid ${C.border}`, marginBottom: 24 }}>
            <Toggle
              checked={settings.enabled}
              onChange={val => update("enabled", val)}
              label="Digest emails enabled"
            />
          </div>

          {/* Day of week */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.12em", marginBottom: 10 }}>SEND DAY</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {DAYS.map(day => (
                <button
                  key={day}
                  className={`ds-day${settings.day_of_week === day ? " active" : ""}`}
                  onClick={() => update("day_of_week", day)}
                  disabled={!settings.enabled}
                  style={{
                    padding: "5px 12px",
                    background: settings.day_of_week === day ? C.goldFaint : "none",
                    border: `1px solid ${settings.day_of_week === day ? C.gold : C.border}`,
                    borderRadius: 3,
                    color: settings.day_of_week === day ? C.gold : settings.enabled ? C.textMuted : "rgba(200,169,110,0.2)",
                    fontSize: 11, cursor: settings.enabled ? "pointer" : "default",
                    fontFamily: "inherit", letterSpacing: "0.06em",
                    textTransform: "capitalize", transition: "all 0.15s",
                  }}
                >{day.slice(0, 3)}</button>
              ))}
            </div>
          </div>

          {/* Hour */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.12em", marginBottom: 10 }}>SEND TIME (UTC)</div>
            <select
              value={settings.hour}
              onChange={e => update("hour", parseInt(e.target.value))}
              disabled={!settings.enabled}
              style={{
                padding: "7px 10px", background: "rgba(15,14,11,0.8)",
                border: `1px solid ${C.border}`, borderRadius: 3,
                color: settings.enabled ? C.text : C.textMuted,
                fontSize: 12, fontFamily: "inherit", outline: "none", cursor: "pointer",
              }}
            >
              {HOURS.map(h => (
                <option key={h.value} value={h.value}>{h.label}</option>
              ))}
            </select>
          </div>

          {/* Last sent */}
          {settings.last_sent && (
            <div style={{ color: C.textMuted, fontSize: 11, marginBottom: 16 }}>
              Last sent: {new Date(settings.last_sent).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </div>
          )}

          {/* Save */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
            <button
              className="ds-btn"
              onClick={save}
              disabled={saving}
              style={{
                padding: "8px 20px", background: "none",
                border: `1px solid ${C.border}`, borderRadius: 3,
                color: C.gold, fontSize: 11, cursor: "pointer",
                fontFamily: "inherit", letterSpacing: "0.1em",
                transition: "all 0.2s",
              }}
            >{saving ? "Saving…" : "Save settings"}</button>
            {saveMsg && <span style={{ color: C.textMuted, fontSize: 12 }}>{saveMsg}</span>}
          </div>

          {/* Test email */}
          <div style={{ padding: "16px 0", borderTop: `1px solid ${C.border}` }}>
            <div style={{ color: C.textMuted, fontSize: 12, marginBottom: 10, lineHeight: 1.6 }}>
              Send a test digest to {user?.email || "your email"} right now.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button
                className="ds-btn"
                onClick={sendTest}
                disabled={testing}
                style={{
                  padding: "7px 16px", background: "none",
                  border: `1px solid ${C.border}`, borderRadius: 3,
                  color: C.textMuted, fontSize: 11, cursor: "pointer",
                  fontFamily: "inherit", letterSpacing: "0.1em",
                  transition: "all 0.2s",
                }}
              >{testing ? "Sending…" : "Send test"}</button>
              {testMsg && <span style={{ color: C.textMuted, fontSize: 12 }}>{testMsg}</span>}
            </div>
          </div>
        </div>

        {/* ── Right: preview ──────────────────────────────────────────── */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.12em" }}>THIS WEEK'S DIGEST PREVIEW</div>
            <button
              className="ds-btn"
              onClick={loadPreview}
              disabled={previewing}
              style={{
                padding: "4px 12px", background: "none",
                border: `1px solid ${C.border}`, borderRadius: 3,
                color: C.textMuted, fontSize: 10, cursor: "pointer",
                fontFamily: "inherit", letterSpacing: "0.1em",
                transition: "all 0.2s",
              }}
            >{previewing ? "Loading…" : preview ? "Refresh" : "Preview"}</button>
          </div>

          {preview ? (
            <DigestPreview preview={preview} />
          ) : (
            <div style={{
              border: `1px dashed ${C.border}`, borderRadius: 4,
              padding: "40px 20px", textAlign: "center",
              color: C.textMuted, fontSize: 13, fontStyle: "italic",
            }}>
              Click Preview to see what this week's digest would say.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Mock preview ──────────────────────────────────────────────────────────────
const MOCK_PREVIEW = {
  narrative: "Freedom and Commitment pulled against each other again this week — but for the first time, your framing of Commitment shifted toward something you chose rather than something you endure. That distinction matters more than it might appear.",
  week_ending: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
  signals: {
    new_contradictions: [],
    shifted_tensions: [
      { concept_a: "Freedom", concept_b: "Commitment", current_score: 72, previous_score: 85, delta: -13 },
    ],
    reappeared_concepts: [
      { concept: "Solitude", dormant_days: 47 },
    ],
    milestones: [
      { concept: "Discipline", current_stability: 75, previous_stability: 68 },
    ],
    most_active: [
      { concept: "Freedom" }, { concept: "Commitment" },
      { concept: "Discipline" }, { concept: "Risk" },
    ],
  },
  stats: { total_entries: 47, total_concepts: 83, total_contradictions: 12 },
};
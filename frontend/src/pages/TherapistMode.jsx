import { useState, useEffect } from "react";
import { authFetch } from "../auth/Auth";
import { Spinner, EmptyState, ErrorMessage } from "../components/ErrorBoundary";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const C = {
  gold: "#c8a96e", goldFaint: "rgba(200,169,110,0.08)", goldMuted: "rgba(200,169,110,0.5)",
  text: "#e8dcc8", textMuted: "rgba(232,220,200,0.5)",
  border: "rgba(180,140,80,0.18)", surface: "rgba(22,20,15,0.98)",
  teal: "#6aacb8", tealFaint: "rgba(106,172,184,0.1)",
};

const css = `
  @keyframes sh-fade { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:translateY(0) } }
  .sh-row:hover { background: rgba(180,140,80,0.05) !important; }
  .sh-share:hover { border-color: rgba(180,140,80,0.45) !important; }
`;

function inject() {
  if (!document.getElementById("share-styles")) {
    const el = document.createElement("style"); el.id = "share-styles"; el.textContent = css;
    document.head.appendChild(el);
  }
}

// ── Owner view: manage shares ─────────────────────────────────────────────────
function OwnerView({ shares, onCreateShare, onRevokeShare, creating }) {
  const [email,    setEmail]    = useState("");
  const [role,     setRole]     = useState("reader");
  const [duration, setDuration] = useState(30);

  function handleCreate() {
    if (!email.trim()) return;
    onCreateShare({ email, role, expires_in_days: duration });
    setEmail("");
  }

  return (
    <div style={{ padding: "32px 40px", maxWidth: 700 }}>
      <div style={{ marginBottom: 32, animation: "sh-fade 0.4s ease" }}>
        <div style={{ color: C.gold, fontSize: 22, fontStyle: "italic", marginBottom: 6 }}>Shared access</div>
        <div style={{ color: C.textMuted, fontSize: 14, lineHeight: 1.7, maxWidth: 560 }}>
          Invite a therapist, coach, or trusted reader to view a read-only version of your graph. 
          They see concepts and relationships, never the raw text of your entries unless you enable it.
        </div>
      </div>

      {/* Invite form */}
      <div style={{
        padding: "22px 24px", marginBottom: 28,
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 4,
      }}>
        <div style={{ color: C.gold, fontSize: 14, marginBottom: 16 }}>Invite someone</div>
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <input
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleCreate()}
            placeholder="their@email.com"
            style={{
              flex: 1, minWidth: 200,
              padding: "10px 14px",
              background: "rgba(255,255,255,0.03)",
              border: `1px solid ${C.border}`,
              borderRadius: 3, color: C.text, fontSize: 14,
              fontFamily: "'EB Garamond', Georgia, serif", outline: "none",
            }}
          />
          <select value={role} onChange={e => setRole(e.target.value)} style={{
            padding: "10px 14px",
            background: "rgba(15,14,11,0.9)",
            border: `1px solid ${C.border}`,
            borderRadius: 3, color: C.text, fontSize: 13,
            fontFamily: "'EB Garamond', Georgia, serif", cursor: "pointer", outline: "none",
          }}>
            <option value="reader">Graph only</option>
            <option value="reader_with_entries">Graph + entry excerpts</option>
            <option value="annotator">Can add notes</option>
          </select>
          <select value={duration} onChange={e => setDuration(+e.target.value)} style={{
            padding: "10px 14px",
            background: "rgba(15,14,11,0.9)",
            border: `1px solid ${C.border}`,
            borderRadius: 3, color: C.text, fontSize: 13,
            fontFamily: "'EB Garamond', Georgia, serif", cursor: "pointer", outline: "none",
          }}>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
          </select>
        </div>
        <button onClick={handleCreate} disabled={creating || !email.trim()} style={{
          padding: "10px 22px",
          background: creating ? "none" : C.goldFaint,
          border: `1px solid ${creating ? "rgba(180,140,80,0.15)" : C.border}`,
          borderRadius: 3,
          color: creating ? C.goldMuted : C.gold,
          fontSize: 12, letterSpacing: "0.1em",
          cursor: creating ? "not-allowed" : "pointer",
          fontFamily: "inherit",
        }}>
          {creating ? "Creating link..." : "Create access link →"}
        </button>
        <div style={{ color: C.textMuted, fontSize: 11, marginTop: 10, lineHeight: 1.5 }}>
          They'll receive a unique link. Entry content is never shared unless you select "Graph + entry excerpts."
        </div>
      </div>

      {/* Active shares */}
      <div style={{ color: C.goldMuted, fontSize: 11, letterSpacing: "0.12em", marginBottom: 12, textTransform: "uppercase" }}>
        Active shares ({shares?.length || 0})
      </div>
      {shares?.length > 0 ? shares.map((s, i) => (
        <div key={s.id} className="sh-row" style={{
          display: "flex", alignItems: "center",
          padding: "12px 16px", marginBottom: 6,
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 3,
          animation: `sh-fade 0.3s ease ${i * 50}ms both`,
          transition: "background 0.15s",
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ color: C.text, fontSize: 13 }}>{s.email}</div>
            <div style={{ color: C.textMuted, fontSize: 11, marginTop: 2 }}>
              {s.role.replace(/_/g, " ")} · expires {new Date(s.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              {s.last_viewed && <span> · last viewed {new Date(s.last_viewed).toLocaleDateString()}</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => navigator.clipboard.writeText(s.link)}
              style={{ ...smallBtn, color: C.teal }}
              title="Copy link">⎘ Copy</button>
            <button
              onClick={() => onRevokeShare(s.id)}
              style={{ ...smallBtn, color: "rgba(224,112,112,0.7)" }}
              title="Revoke">Revoke</button>
          </div>
        </div>
      )) : (
        <EmptyState icon="◌" title="No active shares"
          subtitle="No one currently has access to your graph." />
      )}
    </div>
  );
}

const smallBtn = {
  padding: "5px 10px",
  background: "none", border: "1px solid rgba(180,140,80,0.2)",
  borderRadius: 3, fontSize: 11, cursor: "pointer",
  fontFamily: "'EB Garamond', Georgia, serif", transition: "all 0.15s",
};

// ── Shared graph viewer (for the therapist/coach) ─────────────────────────────
function SharedGraphViewer({ shareToken }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [note,    setNote]    = useState("");
  const [annotations, setAnnotations] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/shared/${shareToken}`);
        if (res.status === 404) { setError("This link is invalid or has expired."); return; }
        if (!res.ok)            { setError("Could not load the shared graph."); return; }
        const d = await res.json();
        setData(d);
        setAnnotations(d.annotations || []);
      } catch {
        setError("Could not reach the server.");
      } finally {
        setLoading(false);
      }
    })();
  }, [shareToken]);

  async function submitNote() {
    if (!note.trim()) return;
    const newNote = {
      id: Date.now(), text: note, created_at: new Date().toISOString(),
      author: "Viewer",
    };
    try {
      await fetch(`${API}/shared/${shareToken}/annotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: note }),
      });
    } catch {}
    setAnnotations(a => [...a, newNote]);
    setNote("");
  }

  if (loading) return <Spinner message="Loading shared graph..." />;
  if (error)   return <ErrorMessage title="Access error" detail={error} />;
  if (!data)   return null;

  return (
    <div style={{ padding: "32px 40px", fontFamily: "'EB Garamond', Georgia, serif", color: C.text, maxWidth: 800 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ color: C.teal, fontSize: 11, letterSpacing: "0.12em", marginBottom: 6, textTransform: "uppercase" }}>
          Read-only access · Shared graph
        </div>
        <div style={{ color: C.gold, fontSize: 22, fontStyle: "italic" }}>
          {data.owner_name}'s thought biography
        </div>
        <div style={{ color: C.textMuted, fontSize: 13, marginTop: 4 }}>
          {data.node_count} concepts · {data.edge_count} connections · access until {new Date(data.expires_at).toLocaleDateString()}
        </div>
      </div>

      {/* Core concepts */}
      <Section title="Core concepts">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {data.core_concepts?.map(c => (
            <div key={c.label} style={{
              padding: "8px 14px",
              background: C.goldFaint,
              border: `1px solid ${C.border}`,
              borderRadius: 3,
            }}>
              <div style={{ color: C.gold, fontSize: 14 }}>{c.label}</div>
              <div style={{ color: C.textMuted, fontSize: 11, marginTop: 2 }}>
                stability {Math.round(c.stability * 100)}% · freq {c.frequency}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Active contradictions */}
      <Section title="Active contradictions">
        {data.contradictions?.length > 0 ? data.contradictions.map((c, i) => (
          <div key={i} style={{
            padding: "10px 14px", marginBottom: 6,
            background: C.surface, border: `1px solid ${C.border}`, borderRadius: 3,
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <span style={{ color: C.gold, fontSize: 14 }}>{c.c1}</span>
            <span style={{ color: C.textMuted, fontSize: 11 }}>⟷</span>
            <span style={{ color: C.gold, fontSize: 14 }}>{c.c2}</span>
            <div style={{ flex: 1 }} />
            <div style={{
              width: 60, height: 3, background: "rgba(180,140,80,0.12)", borderRadius: 2,
            }}>
              <div style={{ height: "100%", width: `${c.tension_score * 100}%`, background: c.tension_score > 0.7 ? "#e07070" : C.gold, borderRadius: 2 }} />
            </div>
          </div>
        )) : <div style={{ color: C.textMuted, fontSize: 13 }}>No active contradictions.</div>}
      </Section>

      {/* Annotations */}
      {data.role === "annotator" && (
        <Section title="Your notes">
          {annotations.map(a => (
            <div key={a.id} style={{
              padding: "10px 14px", marginBottom: 6,
              background: C.tealFaint, border: `1px solid rgba(106,172,184,0.2)`, borderRadius: 3,
              fontSize: 13, color: C.text, lineHeight: 1.6,
            }}>
              <div>{a.text}</div>
              <div style={{ color: C.textMuted, fontSize: 11, marginTop: 4 }}>
                {new Date(a.created_at).toLocaleDateString()}
              </div>
            </div>
          ))}
          <div style={{ marginTop: 10 }}>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Add an observation or reflection..."
              rows={3}
              style={{
                width: "100%", boxSizing: "border-box",
                padding: "10px 14px",
                background: "rgba(255,255,255,0.03)",
                border: `1px solid ${C.border}`,
                borderRadius: 3, color: C.text, fontSize: 14, resize: "none",
                fontFamily: "'EB Garamond', Georgia, serif", outline: "none",
              }}
            />
            <button onClick={submitNote} disabled={!note.trim()} style={{
              marginTop: 8, padding: "9px 18px",
              background: C.tealFaint, border: "1px solid rgba(106,172,184,0.25)",
              borderRadius: 3, color: C.teal, fontSize: 12, letterSpacing: "0.1em",
              cursor: "pointer", fontFamily: "inherit",
            }}>
              Add note →
            </button>
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ color: C.goldMuted, fontSize: 11, letterSpacing: "0.12em", marginBottom: 12, textTransform: "uppercase" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// ── Main export: detects if viewing a shared link or managing shares ──────────
export default function TherapistMode() {
  inject();
  const [loading, setLoading] = useState(true);
  const [shares,  setShares]  = useState([]);
  const [creating, setCreating] = useState(false);
  const [error,   setError]   = useState(null);

  // Check if this is a shared view (URL has /shared/:token)
  const shareToken = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("share_token")
    : null;

  useEffect(() => {
    if (shareToken) { setLoading(false); return; }
    (async () => {
      try {
        const res = await authFetch(`${API}/shares`);
        if (!res.ok) throw new Error();
        const d = await res.json();
        setShares(d.shares || []);
      } catch {
        setShares(MOCK_SHARES);
      } finally {
        setLoading(false);
      }
    })();
  }, [shareToken]);

  async function createShare(params) {
    setCreating(true); setError(null);
    try {
      const res = await authFetch(`${API}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!res.ok) throw new Error("Failed to create share");
      const d = await res.json();
      setShares(s => [...s, d.share]);
    } catch (e) {
      setError(e.message);
      // Mock for development
      setShares(s => [...s, {
        id: Date.now(), email: params.email, role: params.role,
        expires_at: new Date(Date.now() + params.expires_in_days * 86400000).toISOString(),
        link: `${window.location.origin}?share_token=demo-${Date.now()}`,
        last_viewed: null,
      }]);
    } finally {
      setCreating(false);
    }
  }

  async function revokeShare(shareId) {
    try {
      await authFetch(`${API}/shares/${shareId}`, { method: "DELETE" });
    } catch {}
    setShares(s => s.filter(sh => sh.id !== shareId));
  }

  if (loading) return <Spinner message="Loading..." />;

  if (shareToken) return <SharedGraphViewer shareToken={shareToken} />;

  return (
    <div>
      {error && <ErrorMessage title="Share error" detail={error} onRetry={() => setError(null)} />}
      <OwnerView shares={shares} onCreateShare={createShare} onRevokeShare={revokeShare} creating={creating} />
    </div>
  );
}

const MOCK_SHARES = [
  {
    id: 1, email: "dr.chen@example.com", role: "annotator",
    expires_at: new Date(Date.now() + 25 * 86400000).toISOString(),
    link: `${typeof window !== "undefined" ? window.location.origin : ""}/shared?token=demo123`,
    last_viewed: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
];
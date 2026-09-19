import { useState, useEffect } from "react";
import { authFetch } from "../auth/Auth";
import { Spinner, EmptyState, ErrorMessage } from "../components/ErrorBoundary";
import { requestTrialPrompt } from "../components/plans";

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
function OwnerView({ shares, limit, isPro, subscribed, notice, onCreateShare, onRevokeShare, creating }) {
  const [email,    setEmail]    = useState("");
  const [role,     setRole]     = useState("reader");
  const [duration, setDuration] = useState(30);

  const [copied, setCopied] = useState(null);
  const atLimit = shares.length >= limit;

  function copyLink(s) {
    navigator.clipboard.writeText(s.link).then(() => {
      setCopied(s.id);
      setTimeout(() => setCopied(null), 1500);
    }).catch(() => {});
  }

  function handleCreate() {
    if (!email.trim() || atLimit) return;
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

      {notice && (
        <div style={{
          padding: "10px 14px", marginBottom: 20, borderRadius: 3, fontSize: 13, lineHeight: 1.5,
          background: C.tealFaint, border: "1px solid rgba(106,172,184,0.25)", color: C.teal,
        }}>{notice}</div>
      )}

      {/* Invite form — Professional only; free viewers, paid owners */}
      {isPro ? (
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
        <button onClick={handleCreate} disabled={creating || !email.trim() || atLimit} style={{
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
          We'll email them a private link — they don't need an account or a subscription. Entry content is never shared unless you select "Graph + entry excerpts."
          {atLimit && <span style={{ color: "#e0a070" }}> You've reached the limit of {limit} active links — revoke one to create another.</span>}
        </div>
      </div>
      ) : (
        <div style={{
          padding: "22px 24px", marginBottom: 28,
          background: C.goldFaint, border: `1px solid ${C.border}`, borderRadius: 4,
        }}>
          <div style={{ color: C.gold, fontSize: 14, marginBottom: 8 }}>Sharing is part of the Professional plan</div>
          <div style={{ color: C.textMuted, fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
            Share your graph with a therapist or coach — up to {limit} active links, with optional entry excerpts and a notes layer for them.
            The people you share with never need an account or a subscription.
            {shares.length > 0 && " Links you already created keep working until they expire, and you can revoke them any time."}
          </div>
          <button onClick={() => requestTrialPrompt(subscribed ? "upgrade_required" : "subscription_required")} style={{
            padding: "10px 22px", background: C.goldFaint, border: `1px solid ${C.gold}`, borderRadius: 3,
            color: C.gold, fontSize: 12, letterSpacing: "0.1em", cursor: "pointer", fontFamily: "inherit",
          }}>
            {subscribed ? "Upgrade to Professional →" : "Start your free trial →"}
          </button>
        </div>
      )}

      {/* Active shares */}
      <div style={{ color: C.goldMuted, fontSize: 11, letterSpacing: "0.12em", marginBottom: 12, textTransform: "uppercase" }}>
        Active shares ({shares.length}/{limit})
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
              onClick={() => copyLink(s)}
              style={{ ...smallBtn, color: C.teal }}
              title="Copy link">{copied === s.id ? "✓ Copied" : "⎘ Copy"}</button>
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
export function SharedGraphViewer({ shareToken }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [note,    setNote]    = useState("");
  const [annotations, setAnnotations] = useState([]);
  const [noteError, setNoteError] = useState("");

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
    const text = note.trim();
    if (!text) return;
    setNoteError("");
    try {
      const res = await fetch(`${API}/shared/${shareToken}/annotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error();
      setAnnotations(a => [...a, { id: Date.now(), text, created_at: new Date().toISOString() }]);
      setNote("");
    } catch {
      setNoteError("Couldn't save your note — please try again.");
    }
  }

  if (loading) return <Spinner message="Loading shared graph..." />;
  if (error)   return <ErrorMessage title="Access error" detail={error} />;
  if (!data)   return null;

  return (
    <div style={{ padding: "32px 40px", fontFamily: "'EB Garamond', Georgia, serif", color: C.text, maxWidth: 800 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ color: C.teal, fontSize: 11, letterSpacing: "0.12em", marginBottom: 6, textTransform: "uppercase" }}>
          {data.role === "annotator" ? "Shared graph · you can add notes" : "Read-only access · Shared graph"}
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

      {/* Recent entry excerpts (reader_with_entries / annotator) */}
      {data.recent_excerpts?.length > 0 && (
        <Section title="Recent entries (excerpts)">
          {data.recent_excerpts.map((e, i) => (
            <div key={i} style={{
              padding: "10px 14px", marginBottom: 6,
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 3,
              fontSize: 13, color: C.text, lineHeight: 1.6,
            }}>
              <div>{e.excerpt}{e.excerpt?.length >= 200 ? "…" : ""}</div>
              <div style={{ color: C.textMuted, fontSize: 11, marginTop: 4 }}>
                {e.date && new Date(e.date).toLocaleDateString()}{e.tone ? ` · ${e.tone}` : ""}
              </div>
            </div>
          ))}
        </Section>
      )}

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
            {noteError && <div style={{ color: "#e07070", fontSize: 12, marginTop: 8 }}>{noteError}</div>}
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

// ── Main export: owner's share management (the public viewer lives in SharedView) ──
export default function TherapistMode() {
  inject();
  const [loading,  setLoading]  = useState(true);
  const [shares,   setShares]   = useState([]);
  const [limit,    setLimit]    = useState(5);
  const [sub,      setSub]      = useState(null);
  const [creating, setCreating] = useState(false);
  const [error,    setError]    = useState(null);
  const [notice,   setNotice]   = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const [sr, pr] = await Promise.all([
          authFetch(`${API}/shares`),
          authFetch(`${API}/subscription/status`),
        ]);
        if (!sr.ok) throw new Error();
        const d = await sr.json();
        setShares(d.shares || []);
        if (d.limit) setLimit(d.limit);
        if (pr.ok) setSub(await pr.json());
      } catch {
        setError("Couldn't load your shares — please refresh.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function createShare(params) {
    setCreating(true); setError(null); setNotice(null);
    try {
      const res = await authFetch(`${API}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const d = await res.json().catch(() => ({}));
      // Not on Professional / not subscribed: authFetch already opened the upgrade prompt
      if (res.status === 402 && ["upgrade_required", "subscription_required", "payment_failed"].includes(d.detail?.reason)) return;
      if (!res.ok) {
        throw new Error(typeof d.detail === "string" ? d.detail : d.detail?.message || "Failed to create share");
      }
      setShares(s => [d.share, ...s]);
      setNotice(d.email_sent
        ? `Private link emailed to ${d.share.email}.`
        : "Link created, but we couldn't email it — copy it below and send it to them yourself.");
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function revokeShare(shareId) {
    setError(null);
    try {
      const res = await authFetch(`${API}/shares/${shareId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setShares(s => s.filter(sh => sh.id !== shareId));
    } catch {
      setError("Couldn't revoke that link — please try again.");
    }
  }

  if (loading) return <Spinner message="Loading..." />;

  return (
    <div>
      {error && <ErrorMessage title="Share error" detail={error} onRetry={() => setError(null)} />}
      <OwnerView
        shares={shares} limit={limit} notice={notice} creating={creating}
        subscribed={!!sub?.subscribed}
        isPro={!!sub?.subscribed && sub?.plan === "professional"}
        onCreateShare={createShare} onRevokeShare={revokeShare}
      />
    </div>
  );
}

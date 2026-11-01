/**
 * EmailCapture.jsx — Settings page for inbound email capture
 *
 * Shows the user their personal ThoughtB email address and setup instructions.
 */
import { useState, useEffect } from "react";
import { authFetch } from "../auth/Auth";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function EmailCapture({ user, onNavigate }) {
  const [address, setAddress]   = useState(null);
  const [copied, setCopied]     = useState(false);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  useEffect(() => {
    authFetch(`${API}/email/address`)
      .then(r => {
        if (!r.ok) throw new Error(`Server error ${r.status}`);
        return r.json();
      })
      .then(d => {
        setAddress(d.inbound_email || null);
        if (!d.inbound_email) setError("Address not generated yet — try refreshing.");
        setLoading(false);
      })
      .catch(e => {
        setError(`Could not load your address: ${e.message}. Try refreshing.`);
        setLoading(false);
      });
  }, [token]);

  const copy = () => {
    if (!address) return;
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "40px 24px" }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>
        Email Capture
      </h2>
      <p style={{ color: "var(--text-muted, #888)", marginBottom: 32, lineHeight: 1.6 }}>
        Every thought you email to your personal address lands in your graph —
        no app required. Forward newsletters, BCC yourself on emails you write,
        or just email a quick idea from anywhere.
      </p>

      {/* Address card */}
      <div style={{
        background: "var(--surface-2, #1a1a1a)",
        border: "1px solid var(--border, #2a2a2a)",
        borderRadius: 12,
        padding: "24px",
        marginBottom: 32,
      }}>
        <div style={{ fontSize: 12, color: "var(--text-muted, #888)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Your personal capture address
        </div>

        {loading && (
          <div style={{ color: "var(--text-muted, #888)", fontSize: 14 }}>Loading…</div>
        )}
        {error && (
          <div style={{ color: "#e55", fontSize: 14 }}>{error}</div>
        )}
        {!loading && !error && !address && (
          <div style={{ color: "var(--text-muted, #888)", fontSize: 14 }}>
            Generating your address… if it doesn't appear, please refresh the page.
          </div>
        )}
        {!loading && !error && address && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              flex: 1,
              fontFamily: "monospace",
              fontSize: 15,
              background: "var(--surface-3, #111)",
              border: "1px solid var(--border, #2a2a2a)",
              borderRadius: 8,
              padding: "10px 14px",
              wordBreak: "break-all",
            }}>
              {address}
            </div>
            <button
              onClick={copy}
              style={{
                flexShrink: 0,
                background: copied ? "var(--accent-dim, #1d3a2a)" : "var(--accent, #22c55e)",
                color: copied ? "var(--accent, #22c55e)" : "#000",
                border: "none",
                borderRadius: 8,
                padding: "10px 18px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
        )}

        <div style={{ fontSize: 12, color: "var(--text-muted, #888)", marginTop: 12 }}>
          This address is permanent and unique to you. Only emails sent <strong>from your registered email</strong> are accepted.
        </div>
      </div>

      {/* How-to section */}
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>How to use it</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {[
          {
            icon: "✎",
            title: "Email a thought",
            desc: "Compose a new email to your capture address. Write your idea in the body. It lands in your graph as a journal entry.",
          },
          {
            icon: "⟳",
            title: "BCC yourself on replies you write",
            desc: "When you email your boss, a colleague, or a client — BCC your capture address. The email and the relationship show up in your Influence Trees.",
          },
          {
            icon: "→",
            title: "Forward a newsletter or article",
            desc: "Forward any email to your address. ThoughtB detects the original sender as a Source, extracts concepts, and wires it into your knowledge graph.",
          },
          {
            icon: "◉",
            title: "Add it to your contacts",
            desc: "Save it as a contact called \"ThoughtB\" so you can find it instantly from any mail app.",
          },
        ].map(item => (
          <div key={item.title} style={{
            display: "flex",
            gap: 14,
            padding: "16px 18px",
            background: "var(--surface-2, #1a1a1a)",
            border: "1px solid var(--border, #2a2a2a)",
            borderRadius: 10,
          }}>
            <div style={{ fontSize: 20, flexShrink: 0, marginTop: 1 }}>{item.icon}</div>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 14 }}>{item.title}</div>
              <div style={{ fontSize: 13, color: "var(--text-muted, #888)", lineHeight: 1.5 }}>{item.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Setup note */}
      <div style={{
        marginTop: 32,
        padding: "16px 18px",
        background: "var(--surface-2, #1a1a1a)",
        border: "1px solid var(--border-accent, #333)",
        borderRadius: 10,
        fontSize: 13,
        color: "var(--text-muted, #888)",
        lineHeight: 1.6,
      }}>
        <strong style={{ color: "var(--text, #ccc)" }}>Confirmation emails</strong> — after each capture you'll get a short reply confirming it worked. If you don't see one, check your spam folder or contact support.
      </div>
    </div>
  );
}

import { SharedGraphViewer } from "./TherapistMode";

/**
 * Public page opened from a share link (/?share_token=...). No login, no account,
 * no subscription — the token in the link is the access.
 */
export default function SharedView({ shareToken }) {
  return (
    <div style={{ minHeight: "100dvh", background: "#0f0d0a", fontFamily: "'EB Garamond', Georgia, serif" }}>
      <div style={{
        padding: "16px clamp(16px,4vw,40px)", borderBottom: "1px solid rgba(180,140,80,0.15)",
        color: "rgba(200,169,110,0.7)", fontSize: 13, letterSpacing: "0.14em", textTransform: "uppercase",
      }}>
        Thought Biography
      </div>
      <div style={{ maxWidth: 840, margin: "0 auto" }}>
        <SharedGraphViewer shareToken={shareToken} />
      </div>
      <div style={{
        textAlign: "center", padding: "24px 16px 40px",
        color: "rgba(232,220,200,0.35)", fontSize: 12,
      }}>
        Shared with you privately — no account needed. Please don't forward this link.
      </div>
    </div>
  );
}

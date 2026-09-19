import { useState, useEffect } from "react";
import { authFetch } from "../auth/Auth";
import { PLANS, TRIAL_FINE_PRINT, startCheckout, openBillingPortal, upgradeToProfessional } from "./plans";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const C = {
  surface: "#161310", gold: "#c8a96e", goldMuted: "rgba(200,169,110,0.6)",
  border: "rgba(200,169,110,0.2)", text: "#e8dcc8", textMuted: "rgba(232,220,200,0.55)",
};

/**
 * Global "start your free trial" prompt. Opens whenever any request comes back
 * 402 subscription_required / payment_failed (authFetch fires "tb:paywall"),
 * or when something calls requestTrialPrompt().
 */
export default function TrialGate() {
  const [gate, setGate]         = useState(null);   // { reason, message }
  const [eligible, setEligible] = useState(true);
  const [busy, setBusy]         = useState(null);   // plan key | "portal"
  const [error, setError]       = useState("");

  useEffect(() => {
    function onPaywall(e) {
      setError("");
      setBusy(null);
      setGate(e.detail || { reason: "subscription_required" });
    }
    window.addEventListener("tb:paywall", onPaywall);
    return () => window.removeEventListener("tb:paywall", onPaywall);
  }, []);

  // Someone who already used their trial (cancelled and came back) shouldn't be told they get another.
  useEffect(() => {
    if (!gate || gate.reason !== "subscription_required") return;
    authFetch(`${API}/subscription/status`)
      .then(r => r.json())
      .then(d => setEligible(d.trial_eligible !== false))
      .catch(() => {});
  }, [gate]);

  if (!gate) return null;

  const paymentFailed = gate.reason === "payment_failed";
  const upgradeNeeded = gate.reason === "upgrade_required";

  async function run(key, fn) {
    setBusy(key);
    setError("");
    try { await fn(); } // navigates away on success
    catch (e) { setBusy(null); setError(e.message); }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 2000,
      background: "rgba(10,9,7,0.78)", backdropFilter: "blur(3px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div style={{
        width: "min(460px, 100%)", maxHeight: "92dvh", overflowY: "auto",
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
        padding: "28px 26px", fontFamily: "'EB Garamond', Georgia, serif",
      }}>
        <div style={{ color: C.goldMuted, fontSize: 11, letterSpacing: "0.12em", marginBottom: 10 }}>
          {paymentFailed ? "PAYMENT ISSUE" : upgradeNeeded ? "PROFESSIONAL FEATURE" : eligible ? "START YOUR FREE TRIAL" : "SUBSCRIBE TO CONTINUE"}
        </div>
        <div style={{ color: C.text, fontSize: 16, lineHeight: 1.5, marginBottom: 20 }}>
          {paymentFailed
            ? (gate.message || "Your last payment didn't go through. Update your card to keep using Thought Biography.")
            : upgradeNeeded
              ? (gate.message || "This is part of the Professional plan.")
              : eligible
              ? "Start your 14-day free trial to begin journaling."
              : "Subscribe to keep journaling."}
        </div>

        {paymentFailed ? (
          <button disabled={!!busy} onClick={() => run("portal", openBillingPortal)} style={primaryBtn(busy)}>
            {busy === "portal" ? "Opening billing portal…" : "Update payment method"}
          </button>
        ) : upgradeNeeded ? (
          <>
            <button disabled={!!busy} onClick={() => run("upgrade", upgradeToProfessional)} style={primaryBtn(busy)}>
              {busy === "upgrade" ? "Upgrading…" : "Upgrade to Professional — $49.99/mo"}
            </button>
            <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.5, margin: "4px 0 14px" }}>
              Your plan changes immediately, on the card you already added. If you're still in your free trial you won't be charged until it ends.
            </div>
          </>
        ) : (
          <>
            {PLANS.map(p => (
              <button key={p.key} disabled={!!busy} onClick={() => run(p.key, () => startCheckout(p.key))}
                style={{ ...primaryBtn(busy), opacity: busy && busy !== p.key ? 0.5 : 1 }}>
                {busy === p.key
                  ? "Starting checkout…"
                  : `${eligible ? "Start free trial" : "Subscribe"} — ${p.name} (${p.price}/mo)`}
              </button>
            ))}
            {eligible && (
              <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.5, margin: "4px 0 14px" }}>
                {TRIAL_FINE_PRINT}
              </div>
            )}
          </>
        )}

        {error && <div style={{ color: "#e07070", fontSize: 13, marginBottom: 12 }}>{error}</div>}

        <button onClick={() => setGate(null)} style={{
          width: "100%", padding: "8px 0", background: "transparent", border: "none",
          color: C.textMuted, fontSize: 12, cursor: "pointer", fontFamily: "inherit",
        }}>
          Not now
        </button>
      </div>
    </div>
  );
}

function primaryBtn(busy) {
  return {
    width: "100%", padding: "12px 0", marginBottom: 10,
    background: "rgba(200,169,110,0.12)", border: `1px solid ${C.gold}`, borderRadius: 6,
    color: C.gold, fontSize: 14, fontFamily: "inherit",
    cursor: busy ? "not-allowed" : "pointer",
  };
}

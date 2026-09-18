import { useState, useEffect } from "react";
import { authFetch } from "../auth/Auth";
import { startCheckout, openBillingPortal } from "../components/plans";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const C = {
  bg: "#0f0d0a", gold: "#c8a96e", goldMuted: "rgba(200,169,110,0.6)",
  goldFaint: "rgba(200,169,110,0.06)", border: "rgba(200,169,110,0.15)",
  text: "#e8dcc8", textMuted: "rgba(232,220,200,0.5)",
};

const PLANS = [
  {
    key: "personal", name: "Personal", price: "$15.99", period: "per month",
    trial: "14-day free trial",
    features: ["Unlimited entries", "Full concept drift tracking", "Influence trees visualization", "Time travel playback", "AI biography generation", "Semantic search", "Full data export"],
    cta: "Start 14-Day Free Trial", popular: true,
  },
  {
    key: "professional", name: "Professional", price: "$49.99", period: "per month",
    trial: "14-day free trial",
    features: ["Everything in Personal", "Share graph with therapist or coach", "Annotation layer for shared views", "Up to 5 share links", "Priority support"],
    cta: "Start Free Trial",
  },
];

export default function Billing({ user, onNavigate }) {
  const [status,    setStatus]    = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [upgrading, setUpgrading] = useState(null);

  useEffect(() => {
    authFetch(`${API}/subscription/status`)
      .then(r => r.json())
      .then(setStatus)
      .finally(() => setLoading(false));
  }, []);

  const [error, setError] = useState("");

  const handleUpgrade = async (planKey) => {
    setUpgrading(planKey);
    setError("");
    try {
      await startCheckout(planKey); // navigates to Stripe on success
    } catch (e) {
      setError(e.message);
      setUpgrading(null);
    }
  };

  const handleManage = async () => {
    setError("");
    try { await openBillingPortal(); } catch (e) { setError(e.message); }
  };

  const subscribed = !!status?.subscribed;
  const currentPlan = status?.plan || "free";
  const subStatus = status?.status;
  const paymentFailed = currentPlan !== "free" && (subStatus === "past_due" || subStatus === "unpaid");
  const trialEligible = status?.trial_eligible !== false;   // one trial per account

  return (
    <div style={{ minHeight: "100dvh", background: C.bg, padding: "clamp(24px,6vw,40px) clamp(14px,4vw,24px)", fontFamily: "'EB Garamond', Georgia, serif" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        {paymentFailed && (
          <div style={{
            background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.35)",
            borderRadius: 4, padding: "14px 18px", marginBottom: 28,
            display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12,
          }}>
            <span style={{ color: "#e07070", fontSize: 13 }}>
              Your last payment didn't go through. Update your card to avoid losing unlimited access.
            </span>
            <button onClick={handleManage} style={{
              background: "transparent", border: "1px solid rgba(192,57,43,0.5)",
              color: "#e07070", fontSize: 12, padding: "6px 14px", borderRadius: 3,
              cursor: "pointer", fontFamily: "'EB Garamond', Georgia, serif", whiteSpace: "nowrap",
            }}>
              Update payment method →
            </button>
          </div>
        )}
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div style={{ color: C.goldMuted, fontSize: 11, letterSpacing: "0.14em", marginBottom: 12 }}>PRICING</div>
          <h1 style={{ color: C.text, fontSize: 36, fontStyle: "italic", fontWeight: 400, margin: 0 }}>
            {trialEligible ? "Two plans. Both start with 14 days free." : "Pick a plan to keep journaling."}
          </h1>
          {trialEligible && (
            <div style={{ color: C.textMuted, fontSize: 13, marginTop: 12 }}>
              Card required. You won't be charged for 14 days — cancel anytime before then.
            </div>
          )}
          {error && <div style={{ color: "#e07070", fontSize: 13, marginTop: 12 }}>{error}</div>}
          {currentPlan !== "free" && (
            <div style={{ marginTop: 16 }}>
              <span style={{ color: C.gold, fontSize: 13 }}>
                Current plan: {currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)}
                {subStatus === "trialing" ? " · free trial" : ""}
              </span>
              <button onClick={handleManage} style={{
                marginLeft: 16, background: "transparent", border: `1px solid ${C.border}`,
                color: C.goldMuted, fontSize: 12, padding: "4px 12px", borderRadius: 3,
                cursor: "pointer", fontFamily: "'EB Garamond', Georgia, serif",
              }}>
                Manage subscription →
              </button>
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 20 }}>
          {PLANS.map(plan => {
            const isCurrent = subscribed && currentPlan === plan.key;
            const isPopular = plan.popular;
            return (
              <div key={plan.key} style={{
                background: isPopular ? "rgba(200,169,110,0.05)" : "transparent",
                border: `1px solid ${isPopular ? C.gold : C.border}`,
                borderRadius: 4, padding: "28px 24px", position: "relative",
              }}>
                {isPopular && (
                  <div style={{
                    position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)",
                    background: C.gold, color: "#1a1510", fontSize: 10, letterSpacing: "0.1em",
                    padding: "3px 12px", borderRadius: 2,
                  }}>MOST POPULAR</div>
                )}
                <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.12em", marginBottom: 16 }}>
                  {plan.name.toUpperCase()}
                </div>
                <div style={{ color: C.gold, fontSize: 36, fontStyle: "italic", marginBottom: 4 }}>
                  {plan.price}
                </div>
                <div style={{ color: C.textMuted, fontSize: 12, marginBottom: trialEligible ? 4 : 24 }}>
                  {plan.period}
                </div>
                {trialEligible && (
                  <div style={{ color: C.goldMuted, fontSize: 11, marginBottom: 20 }}>{plan.trial}</div>
                )}
                <div style={{ marginBottom: 24 }}>
                  {plan.features.map((f, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, color: C.text, fontSize: 13 }}>
                      <span style={{ color: C.gold }}>✦</span> {f}
                    </div>
                  ))}
                </div>
                {isCurrent ? (
                  <div style={{ textAlign: "center", color: C.goldMuted, fontSize: 12, padding: "10px 0", border: `1px solid ${C.border}`, borderRadius: 3 }}>
                    Current plan
                  </div>
                ) : (
                  <button onClick={() => handleUpgrade(plan.key)} disabled={!!upgrading || subscribed} style={{
                    width: "100%", padding: "11px 0",
                    background: isPopular ? C.gold : "transparent",
                    border: `1px solid ${C.gold}`, borderRadius: 3,
                    color: isPopular ? "#1a1510" : C.gold,
                    fontSize: 12, letterSpacing: "0.1em", cursor: (upgrading || subscribed) ? "not-allowed" : "pointer",
                    fontFamily: "'EB Garamond', Georgia, serif",
                    opacity: subscribed ? 0.5 : 1,
                  }}>
                    {upgrading === plan.key ? "Loading…" : (trialEligible ? "Start 14-Day Free Trial" : "Subscribe").toUpperCase()}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

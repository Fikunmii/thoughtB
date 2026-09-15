import { useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const C = {
  bg: "#0f0d0a", gold: "#c8a96e", goldMuted: "rgba(200,169,110,0.6)",
  border: "rgba(200,169,110,0.15)", text: "#e8dcc8", textMuted: "rgba(232,220,200,0.5)",
};

const PLANS = [
  {
    key: "free", name: "Free", price: "$0", period: "forever",
    features: ["30 journal entries", "Core concept graph", "Basic contradiction detection", "5 AI queries per day"],
    cta: "Continue with Free",
  },
  {
    key: "personal", name: "Personal", price: "$15.99", period: "per month",
    trial: "14-day free trial",
    features: ["Unlimited entries", "Full concept drift tracking", "Influence trees", "Time travel playback", "AI biography generation", "Semantic search"],
    cta: "Start 14-Day Free Trial", popular: true,
  },
  {
    key: "professional", name: "Professional", price: "$49.99", period: "per month",
    trial: "14-day free trial",
    features: ["Everything in Personal", "Share graph with therapist or coach", "Up to 5 share links", "Priority support"],
    cta: "Start Free Trial",
  },
];

/**
 * Shown once, right after registration. Free continues straight into the
 * app. Personal/Professional go to Stripe Checkout to collect payment
 * details up front — Stripe runs the 14-day trial clock from there.
 */
export default function PlanSelect({ onFree, onPaidPlanChosen }) {
  const [loadingPlan, setLoadingPlan] = useState(null);
  const [error, setError] = useState("");

  async function choose(planKey) {
    if (planKey === "free") { onFree(); return; }
    setLoadingPlan(planKey);
    setError("");
    try {
      const token = localStorage.getItem("tb_token") || sessionStorage.getItem("tb_token");
      const res = await fetch(`${API}/subscription/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ plan: planKey }),
      });
      const data = await res.json();
      if (data.checkout_url) {
        onPaidPlanChosen?.(planKey);
        window.location.href = data.checkout_url;
        return;
      }
      throw new Error("No checkout URL returned");
    } catch (e) {
      setLoadingPlan(null);
      setError("Couldn't start checkout — try again, or continue with Free for now.");
    }
  }

  return (
    <div style={{
      minHeight: "100dvh", background: C.bg, padding: "clamp(28px,6vw,48px) clamp(16px,4vw,24px)",
      fontFamily: "'EB Garamond', Georgia, serif",
    }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ color: C.goldMuted, fontSize: 11, letterSpacing: "0.14em", marginBottom: 12 }}>
            ONE LAST STEP
          </div>
          <h1 style={{ color: C.text, fontSize: 32, fontStyle: "italic", fontWeight: 400, margin: 0 }}>
            Choose how you'd like to begin
          </h1>
          <div style={{ color: C.textMuted, fontSize: 14, marginTop: 10 }}>
            Free to start · upgrade any time
          </div>
          {error && (
            <div style={{ color: "#e07070", fontSize: 13, marginTop: 14 }}>{error}</div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 20 }}>
          {PLANS.map(plan => {
            const isPopular = plan.popular;
            return (
              <div key={plan.key} style={{
                background: isPopular ? "rgba(200,169,110,0.05)" : "transparent",
                border: `1px solid ${isPopular ? C.gold : C.border}`,
                borderRadius: 4, padding: "26px 22px", position: "relative",
              }}>
                {isPopular && (
                  <div style={{
                    position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)",
                    background: C.gold, color: "#1a1510", fontSize: 10, letterSpacing: "0.1em",
                    padding: "3px 12px", borderRadius: 2,
                  }}>MOST POPULAR</div>
                )}
                <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.12em", marginBottom: 14 }}>
                  {plan.name.toUpperCase()}
                </div>
                <div style={{ color: C.gold, fontSize: 32, fontStyle: "italic", marginBottom: 4 }}>
                  {plan.price}
                </div>
                <div style={{ color: C.textMuted, fontSize: 12, marginBottom: plan.trial ? 4 : 20 }}>
                  {plan.period}
                </div>
                {plan.trial && (
                  <div style={{ color: C.goldMuted, fontSize: 11, marginBottom: 18 }}>{plan.trial}</div>
                )}
                <div style={{ marginBottom: 22 }}>
                  {plan.features.map((f, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, marginBottom: 7, color: C.text, fontSize: 13 }}>
                      <span style={{ color: C.gold }}>✦</span> {f}
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => choose(plan.key)}
                  disabled={!!loadingPlan}
                  style={{
                    width: "100%", padding: "11px 0",
                    background: isPopular ? C.gold : "transparent",
                    border: `1px solid ${C.gold}`, borderRadius: 3,
                    color: isPopular ? "#1a1510" : C.gold,
                    fontSize: 12, letterSpacing: "0.1em",
                    cursor: loadingPlan ? "not-allowed" : "pointer",
                    fontFamily: "'EB Garamond', Georgia, serif",
                    opacity: loadingPlan && loadingPlan !== plan.key ? 0.5 : 1,
                  }}
                >
                  {loadingPlan === plan.key ? "Loading…" : plan.cta.toUpperCase()}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

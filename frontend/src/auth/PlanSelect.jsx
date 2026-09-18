import { useState } from "react";
import { PLANS, TRIAL_FINE_PRINT, startCheckout } from "../components/plans";

const C = {
  bg: "#0f0d0a", gold: "#c8a96e", goldMuted: "rgba(200,169,110,0.6)",
  border: "rgba(200,169,110,0.15)", text: "#e8dcc8", textMuted: "rgba(232,220,200,0.5)",
};

/**
 * Shown right after registration. The 14-day Stripe trial (card required) is the
 * only way in: picking a plan goes to Stripe Checkout. "Skip for now" lands in
 * the app read-only — the first attempt to journal prompts the trial again.
 */
export default function PlanSelect({ onSkip }) {
  const [loadingPlan, setLoadingPlan] = useState(null);
  const [error, setError] = useState("");

  async function choose(planKey) {
    setLoadingPlan(planKey);
    setError("");
    try {
      await startCheckout(planKey); // navigates to Stripe on success
    } catch (e) {
      setLoadingPlan(null);
      setError(e.message || "Couldn't start checkout — please try again.");
    }
  }

  return (
    <div style={{
      minHeight: "100dvh", background: C.bg, padding: "clamp(28px,6vw,48px) clamp(16px,4vw,24px)",
      fontFamily: "'EB Garamond', Georgia, serif",
    }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ color: C.goldMuted, fontSize: 11, letterSpacing: "0.14em", marginBottom: 12 }}>
            ONE LAST STEP
          </div>
          <h1 style={{ color: C.text, fontSize: 32, fontStyle: "italic", fontWeight: 400, margin: 0 }}>
            Start your 14-day free trial
          </h1>
          <div style={{ color: C.textMuted, fontSize: 14, marginTop: 10, lineHeight: 1.5 }}>
            {TRIAL_FINE_PRINT}
          </div>
          {error && <div style={{ color: "#e07070", fontSize: 13, marginTop: 14 }}>{error}</div>}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20 }}>
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
                <div style={{ color: C.textMuted, fontSize: 12, marginBottom: 4 }}>{plan.period}</div>
                <div style={{ color: C.goldMuted, fontSize: 11, marginBottom: 18 }}>after your 14-day free trial</div>
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
                  {loadingPlan === plan.key ? "LOADING…" : "START 14-DAY FREE TRIAL"}
                </button>
              </div>
            );
          })}
        </div>

        <div style={{ textAlign: "center", marginTop: 28 }}>
          <button onClick={onSkip} disabled={!!loadingPlan} style={{
            background: "none", border: "none", color: C.textMuted, fontSize: 13,
            cursor: "pointer", fontFamily: "inherit", textDecoration: "underline",
          }}>
            Skip for now
          </button>
          <div style={{ color: C.textMuted, fontSize: 11, marginTop: 6, opacity: 0.7 }}>
            Without a trial you can look around, but you can't write or use AI features.
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { authFetch } from "../auth/Auth";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
const C = {
  bg: "#0f0d0a", gold: "#c8a96e", goldMuted: "rgba(200,169,110,0.6)",
  goldFaint: "rgba(200,169,110,0.06)", border: "rgba(200,169,110,0.15)",
  text: "#e8dcc8", textMuted: "rgba(232,220,200,0.5)",
};

const PLANS = [
  {
    key: "free", name: "Free", price: "$0", period: "forever",
    features: ["30 journal entries", "Core concept graph", "Basic contradiction detection", "5 AI queries per day"],
    cta: null,
  },
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

  const handleUpgrade = async (planKey) => {
    setUpgrading(planKey);
    try {
      const res = await authFetch(`${API}/subscription/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planKey }),
      });
      const { checkout_url } = await res.json();
      window.location.href = checkout_url;
    } catch (e) {
      console.error(e);
      setUpgrading(null);
    }
  };

  const handleManage = async () => {
    try {
      const res = await authFetch(`${API}/subscription/portal`, { method: "POST" });
      const { portal_url } = await res.json();
      window.location.href = portal_url;
    } catch (e) { console.error(e); }
  };

  const currentPlan = status?.plan || "free";

  return (
    <div style={{ minHeight: "100vh", background: C.bg, padding: "40px 24px", fontFamily: "'EB Garamond', Georgia, serif" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div style={{ color: C.goldMuted, fontSize: 11, letterSpacing: "0.14em", marginBottom: 12 }}>PRICING</div>
          <h1 style={{ color: C.text, fontSize: 36, fontStyle: "italic", fontWeight: 400, margin: 0 }}>
            Start free. Pay when your graph has depth.
          </h1>
          {currentPlan !== "free" && (
            <div style={{ marginTop: 16 }}>
              <span style={{ color: C.gold, fontSize: 13 }}>
                Current plan: {currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)}
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

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
          {PLANS.map(plan => {
            const isCurrent = currentPlan === plan.key;
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
                <div style={{ color: C.textMuted, fontSize: 12, marginBottom: plan.trial ? 4 : 24 }}>
                  {plan.period}
                </div>
                {plan.trial && (
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
                ) : plan.cta ? (
                  <button onClick={() => handleUpgrade(plan.key)} disabled={!!upgrading} style={{
                    width: "100%", padding: "11px 0",
                    background: isPopular ? C.gold : "transparent",
                    border: `1px solid ${C.gold}`, borderRadius: 3,
                    color: isPopular ? "#1a1510" : C.gold,
                    fontSize: 12, letterSpacing: "0.1em", cursor: upgrading ? "not-allowed" : "pointer",
                    fontFamily: "'EB Garamond', Georgia, serif",
                  }}>
                    {upgrading === plan.key ? "Loading…" : plan.cta.toUpperCase()}
                  </button>
                ) : (
                  <button onClick={() => onNavigate?.("journal")} style={{
                    width: "100%", padding: "11px 0", background: "transparent",
                    border: `1px solid ${C.border}`, borderRadius: 3,
                    color: C.goldMuted, fontSize: 12, letterSpacing: "0.1em",
                    cursor: "pointer", fontFamily: "'EB Garamond', Georgia, serif",
                  }}>
                    BEGIN FOR FREE
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

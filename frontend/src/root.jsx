import { useState, useEffect } from "react";
import Auth, { AuthStorage }  from "./auth/Auth";
import LandingPage             from "./marketing/LandingPage";
import Onboarding              from "./onboarding/Onboarding";

// ── The complete routing logic for Thought Biography ─────────────────────────
//
//  Route:
//    /           → LandingPage   (not logged in)
//    /app        → App shell     (logged in + onboarding done)
//    /onboarding → Onboarding    (logged in + first session)
//
//  State machine:
//    "landing"     — visitor hasn't authenticated
//    "auth"        — visitor clicked CTA, showing login/register
//    "onboarding"  — just registered, first-time experience
//    "app"         — authenticated + onboarded
//
// ─────────────────────────────────────────────────────────────────────────────

// Import the full App shell with all views
import App from "./App";

export default function Root() {
  const [scene, setScene] = useState(() => {
    // Determine initial scene from stored state
    if (AuthStorage.isLoggedIn()) {
      const onboarded = localStorage.getItem("tb_onboarded");
      return onboarded ? "app" : "onboarding";
    }
    return "landing";
  });

  const [user, setUser] = useState(AuthStorage.getUser());
  // Track whether the CTA was clicked (to show auth vs landing)
  const [showAuth, setShowAuth] = useState(false);
  const [pendingPlan, setPendingPlan] = useState(null);

  function handleGetStarted(plan) {
    // CTA clicked — store plan intent, go to register mode
    if (plan && plan !== "free") setPendingPlan(plan);
    setShowAuth(true);
    setScene("auth");
  }

  function handleSignIn() {
    // Nav "sign in" — go to login mode
    setShowAuth(true);
    setScene("auth");
  }

  function handleAuthenticated(u) {
    setUser(u);
    if (pendingPlan) {
      // Redirect to Stripe checkout for the selected plan
      const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
      const token = localStorage.getItem("tb_token") || sessionStorage.getItem("tb_token");
      fetch(`${API}/subscription/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ plan: pendingPlan }),
      })
        .then(r => r.json())
        .then(d => { if (d.checkout_url) window.location.href = d.checkout_url; })
        .catch(() => {
          setPendingPlan(null);
          const alreadyOnboarded = localStorage.getItem("tb_onboarded");
          setScene(alreadyOnboarded ? "app" : "onboarding");
        });
      setPendingPlan(null);
      return;
    }
    const alreadyOnboarded = localStorage.getItem("tb_onboarded");
    setScene(alreadyOnboarded ? "app" : "onboarding");
  }

  function handleOnboardingComplete() {
    localStorage.setItem("tb_onboarded", "1");
    setScene("app");
  }

  function handleLogout() {
    AuthStorage.clear();
    localStorage.removeItem("tb_onboarded");
    setUser(null);
    setShowAuth(false);
    setScene("landing");
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (scene === "landing") {
    return (
      <LandingPage
        onGetStarted={handleGetStarted}
        onSignIn={handleSignIn}
      />
    );
  }

  if (scene === "auth") {
    return (
      <Auth
        onAuthenticated={handleAuthenticated}
        // Pass mode hint so Auth shows register vs login
        // (Auth.jsx reads initialMode prop if you add it)
      />
    );
  }

  if (scene === "onboarding") {
    return (
      <Onboarding
        user={user}
        onComplete={handleOnboardingComplete}
      />
    );
  }

  // scene === "app"
  
  
  return <App user={user} onLogout={handleLogout} />;
}

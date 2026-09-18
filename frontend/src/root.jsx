import { useState, useEffect } from "react";
import Auth, { AuthStorage, authFetch } from "./auth/Auth";
import PlanSelect              from "./auth/PlanSelect";
import LandingPage             from "./marketing/LandingPage";
import Onboarding              from "./onboarding/Onboarding";
import TrialGate               from "./components/TrialGate";
import { startCheckout }        from "./components/plans";

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
//    "plan"        — just registered: start the 14-day Stripe trial (Personal/Professional) or skip
//    "confirming"  — back from Stripe Checkout, activating the subscription
//    "onboarding"  — just registered, first-time experience
//    "app"         — authenticated + onboarded
//
// ─────────────────────────────────────────────────────────────────────────────

// Import the full App shell with all views
import App from "./App";

function returnedSessionId() {
  const p = new URLSearchParams(window.location.search);
  return p.get("subscribed") === "true" ? p.get("session_id") : null;
}

function nextScene() {
  return localStorage.getItem("tb_onboarded") ? "app" : "onboarding";
}

export default function Root() {
  const [scene, setScene] = useState(() => {
    // Determine initial scene from stored state
    if (AuthStorage.isLoggedIn()) {
      // Returning from Stripe Checkout — activate the plan before showing anything
      if (returnedSessionId()) return "confirming";
      const onboarded = localStorage.getItem("tb_onboarded");
      return onboarded ? "app" : "onboarding";
    }
    return "landing";
  });
  const [authMode, setAuthMode] = useState("register");

  const [user, setUser] = useState(AuthStorage.getUser());
  // Track whether the CTA was clicked (to show auth vs landing)
  const [showAuth, setShowAuth] = useState(false);
  const [pendingPlan, setPendingPlan] = useState(null);

  // Stripe redirected back with ?session_id — confirm server-side so access never
  // depends on webhook timing, then continue. The query string is left in place
  // so <App /> can still show its "trial started" banner.
  useEffect(() => {
    if (scene !== "confirming") return;
    const API = import.meta.env.VITE_API_URL || "http://localhost:8000";
    authFetch(`${API}/subscription/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: returnedSessionId() }),
    })
      .catch(() => {})            // the webhook may already have activated the plan
      .finally(() => setScene(nextScene()));
  }, [scene]);

  function handleGetStarted(plan) {
    // CTA clicked — a pricing card remembers the chosen plan so we can jump to checkout after signup
    if (plan) setPendingPlan(plan);
    setAuthMode("register");
    setShowAuth(true);
    setScene("auth");
  }

  function handleSignIn() {
    // Nav "sign in" — go to login mode
    setAuthMode("login");
    setShowAuth(true);
    setScene("auth");
  }

  function handleAuthenticated(u, mode) {
    setUser(u);
    if (pendingPlan) {
      // They already picked a plan from a landing-page pricing card —
      // skip the picker and go straight to Stripe checkout for it.
      const plan = pendingPlan;
      setPendingPlan(null);
      startCheckout(plan).catch(() => setScene(mode === "register" ? "plan" : nextScene()));
      return;
    }
    if (mode === "register") {
      // Brand new account — the trial is the only way in, so offer it before the app.
      setScene("plan");
      return;
    }
    setScene(nextScene());
  }

  function handlePlanSkip() {
    // No trial started: straight into the (read-only) app. Onboarding writes an
    // entry, which needs a subscription, so it's skipped.
    localStorage.setItem("tb_onboarded", "1");
    setScene("app");
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
  // <TrialGate /> is mounted for every scene: any 402 from the API (a write or AI
  // call without a subscription) opens the "start your free trial" prompt.
  let content;
  if (scene === "landing") {
    content = <LandingPage onGetStarted={handleGetStarted} onSignIn={handleSignIn} />;
  } else if (scene === "auth") {
    content = <Auth onAuthenticated={handleAuthenticated} initialMode={authMode} />;
  } else if (scene === "plan") {
    content = <PlanSelect onSkip={handlePlanSkip} />;
  } else if (scene === "confirming") {
    content = (
      <div style={{
        minHeight: "100dvh", background: "#0f0d0a", color: "rgba(200,169,110,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'EB Garamond', Georgia, serif", fontSize: 16, fontStyle: "italic",
      }}>
        Activating your trial…
      </div>
    );
  } else if (scene === "onboarding") {
    content = <Onboarding user={user} onComplete={handleOnboardingComplete} />;
  } else {
    content = <App user={user} onLogout={handleLogout} />;
  }

  return (
    <>
      {content}
      <TrialGate />
    </>
  );
}

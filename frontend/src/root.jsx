import { useState, useEffect } from "react";
import Auth, { AuthStorage, authFetch } from "./auth/Auth";
import PlanSelect              from "./auth/PlanSelect";
import LandingPage             from "./marketing/LandingPage";
import Onboarding              from "./onboarding/Onboarding";
import TrialGate               from "./components/TrialGate";
import SharedView              from "./pages/SharedView";
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
//    "shared"      — opened a share link (?share_token=): public read-only viewer, no login
//    "plan"        — just registered: start the 14-day Stripe trial (Personal/Professional) or skip
//    "confirming"  — back from Stripe Checkout, activating the subscription
//    "onboarding"  — just registered, first-time experience
//    "app"         — authenticated + onboarded
//
// ─────────────────────────────────────────────────────────────────────────────

// Import the full App shell with all views
import App          from "./App";
import CapturePage  from "./views/CapturePage";

// /capture — fast-entry page when launched from home screen icon
// Must be checked before any auth/scene logic so it works immediately on tap
function isCaptureRoute() {
  return window.location.pathname === "/capture";
}

function returnedSessionId() {
  const p = new URLSearchParams(window.location.search);
  return p.get("subscribed") === "true" ? p.get("session_id") : null;
}

function shareTokenFromUrl() {
  return new URLSearchParams(window.location.search).get("share_token");
}

function nextScene() {
  return localStorage.getItem("tb_onboarded") ? "app" : "onboarding";
}

export default function Root() {
  const [scene, setScene] = useState(() => {
    // /capture — launched from home screen icon. If logged in, show capture page.
    // If not logged in, fall through to auth then return to capture.
    if (isCaptureRoute()) {
      if (AuthStorage.isLoggedIn()) return "capture";
      sessionStorage.setItem("tb_post_auth_route", "/capture");
      return "auth";
    }
    // A share link is a public page: therapists/coaches never see the marketing site or a login
    if (shareTokenFromUrl()) return "shared";
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

    // If launched from /capture and not logged in, go back to capture after auth
    const postAuthRoute = sessionStorage.getItem("tb_post_auth_route");
    if (postAuthRoute === "/capture" && mode === "login") {
      sessionStorage.removeItem("tb_post_auth_route");
      setScene("capture");
      return;
    }

    if (pendingPlan) {
      const plan = pendingPlan;
      setPendingPlan(null);
      startCheckout(plan).catch(() => setScene(mode === "register" ? "plan" : nextScene()));
      return;
    }
    if (mode === "register") {
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
  if (scene === "capture") {
    content = <CapturePage onOpenApp={() => {
      window.history.pushState({}, "", "/");
      setScene(nextScene());
    }} />;
  } else if (scene === "shared") {
    content = <SharedView shareToken={shareTokenFromUrl()} />;
  } else if (scene === "landing") {
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

import { authFetch } from "../auth/Auth";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

// The 14-day Stripe trial (card required) is the only way into the product.
export const PLANS = [
  {
    key: "personal", name: "Personal", price: "$15.99", period: "per month",
    features: [
      "Unlimited entries", "Full concept drift tracking", "Influence trees",
      "Time travel playback", "AI biography generation", "Semantic search",
    ],
    popular: true,
  },
  {
    key: "professional", name: "Professional", price: "$49.99", period: "per month",
    features: [
      "Everything in Personal", "Share graph with therapist or coach",
      "Up to 5 share links", "Priority support",
    ],
  },
];

export const TRIAL_FINE_PRINT =
  "Card required. You won't be charged for 14 days — cancel anytime before then and it costs nothing.";

async function redirectTo(req, key, errorMessage) {
  const res = await authFetch(`${API}${req.url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req.body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data[key]) {
    throw new Error(typeof data.detail === "string" ? data.detail : errorMessage);
  }
  window.location.href = data[key];
}

/** Send the user to Stripe Checkout (trial + card entry) for the given plan. */
export function startCheckout(planKey) {
  return redirectTo({ url: "/subscription/checkout", body: { plan: planKey } }, "checkout_url",
    "Couldn't start checkout — please try again.");
}

/** Send the user to the Stripe customer portal (update card, cancel, change plan). */
export function openBillingPortal() {
  return redirectTo({ url: "/subscription/portal" }, "portal_url",
    "Couldn't open the billing portal — please try again.");
}

/** Ask the app to show the "start your free trial" prompt (handled by <TrialGate />). */
export function requestTrialPrompt(reason = "subscription_required") {
  window.dispatchEvent(new CustomEvent("tb:paywall", { detail: { reason } }));
}

/** Personal -> Professional on the existing subscription (no second checkout). Reloads on success. */
export async function upgradeToProfessional() {
  const res = await authFetch(`${API}/subscription/upgrade`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan: "professional" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(typeof data.detail === "string" ? data.detail : "Couldn't upgrade — please try again.");
  }
  window.location.reload();
}

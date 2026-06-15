import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Root from "./root";

// ── Render the app ────────────────────────────────────────────────────────────
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Root />
  </StrictMode>
);

// ── Register service worker (PWA) ─────────────────────────────────────────────
// Only runs in production builds and only if the browser supports service workers.
// In development (npm run dev) the service worker is intentionally skipped so
// you don't get stale cached assets while building.

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        console.log("[PWA] Service worker registered:", registration.scope);

        // Check for updates every time the app loads
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // A new version is available — you can show an "Update available" banner here
              // For now just log it
              console.log("[PWA] New version available — refresh to update.");

              // Optionally dispatch a custom event so a React component can show a banner:
              window.dispatchEvent(new CustomEvent("sw-update-available"));
            }
          });
        });
      })
      .catch((err) => {
        console.error("[PWA] Service worker registration failed:", err);
      });
  });
}

// ── Handle shortcut deep links from the manifest ──────────────────────────────
// The manifest shortcuts use ?view=journal and ?view=graph
// This reads those params on launch and passes them to the app via sessionStorage.
// App.jsx reads this on mount.
const params = new URLSearchParams(window.location.search);
const viewParam = params.get("view");
if (viewParam) {
  sessionStorage.setItem("tb_launch_view", viewParam);
  // Clean the URL so the address bar looks right
  window.history.replaceState({}, "", "/");
}
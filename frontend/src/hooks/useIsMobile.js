import { useState, useEffect } from "react";

// Mirrors the --tb-bp-md breakpoint in index.css (768px) so CSS and JS
// branch at the same width. Uses matchMedia (not window.resize polling) so
// it's cheap and updates correctly on orientation change / window resize.
export function useMediaQuery(query) {
  const getMatch = () =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(query).matches
      : false;

  const [matches, setMatches] = useState(getMatch);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const handler = (e) => setMatches(e.matches);
    setMatches(mql.matches);
    if (mql.addEventListener) mql.addEventListener("change", handler);
    else mql.addListener(handler); // Safari < 14 fallback
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", handler);
      else mql.removeListener(handler);
    };
  }, [query]);

  return matches;
}

export function useIsMobile() {
  return useMediaQuery("(max-width: 768px)");
}

export function useIsSmallPhone() {
  return useMediaQuery("(max-width: 480px)");
}

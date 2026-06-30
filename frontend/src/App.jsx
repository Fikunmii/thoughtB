import { useState, useEffect, useCallback } from "react";
import Auth, { AuthStorage, authFetch } from "./auth/Auth";
import { ErrorBoundary, ConnectionBanner } from "./components/ErrorBoundary";

// ── All views ──────────────────────────────────────────────────────────────────
import Dashboard            from "./pages/Dashboard";
import ThoughtBiography     from "./views/ThoughtBiography";
import ThoughtGraph         from "./views/ThoughtGraph";
import ContradictionWorkflow from "./views/ContradictionWorkflow";
import ConceptDriftTimeline  from "./views/ConceptDriftTimeline";
import BiographyDocument    from "./views/BiographyDocument";
import Search               from "./pages/Search";
import Export               from "./pages/Export";
import InfluenceTrees       from "./views/InfluenceTrees";
import TemporalPlayback     from "./views/TemporalPlayback";
import Reminders            from "./pages/Reminders";
import TherapistMode        from "./pages/TherapistMode";
import DigestSettings       from "./pages/DigestSettings";
import ImportHistory        from "./pages/ImportHistory";
import Billing              from "./pages/Billing";
import Folders               from "./pages/Folders";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

// ── Nav config ────────────────────────────────────────────────────────────────
const NAV = [
  { id: "home",          label: "Home",           icon: "⌂",  shortcut: "H", group: "main"     },
  { id: "billing",       label: "Upgrade",        icon: "✦",  shortcut: "U", group: "settings"  },
  { id: "journal",       label: "Journal",         icon: "✦",  shortcut: "J", group: "main"     },
  { id: "folders",       label: "Folders",         icon: "▤",  shortcut: "F", group: "main"     },
  { id: "graph",         label: "Graph",           icon: "◉",  shortcut: "G", group: "explore"  },
  { id: "influence",     label: "Influence Trees", icon: "→",  shortcut: "I", group: "explore"  },
  { id: "temporal",      label: "Time Travel",     icon: "◌",  shortcut: "T", group: "explore"  },
  { id: "contradictions",label: "Contradictions",  icon: "⟷",  shortcut: "C", group: "reflect"  },
  { id: "drift",         label: "Concept Drift",   icon: "~",  shortcut: "D", group: "reflect"  },
  { id: "biography",     label: "Biography",       icon: "≡",  shortcut: "B", group: "reflect"  },
  { id: "search",        label: "Search",          icon: "⌕",  shortcut: "S", group: "tools"    },
  { id: "reminders",     label: "Reminders",       icon: "◑",  shortcut: "R", group: "tools"    },
  { id: "export",        label: "Export",          icon: "↗",  shortcut: "E", group: "tools"    },
  { id: "share",         label: "Shared Access",   icon: "⊕",  shortcut: null, group: "tools"   },
  { id: "digest",        label: "Weekly Digest",   icon: "✉",  shortcut: null, group: "settings" },
  { id: "import",        label: "Import Data",     icon: "⇩",  shortcut: null, group: "settings" },
];

const GROUPS = [
  { id: "main",     label: "Main"     },
  { id: "explore",  label: "Explore"  },
  { id: "reflect",  label: "Reflect"  },
  { id: "tools",    label: "Tools"    },
  { id: "settings", label: "Settings" },
];

// ── View router ───────────────────────────────────────────────────────────────
function ViewRouter({ view, user, onNavigate }) {
  const props = { user, onNavigate };
  switch (view) {
    case "home":           return <Dashboard           {...props} />;
    case "journal":        return <ThoughtBiography    {...props} />;
    case "folders":        return <Folders             {...props} />;
    case "graph":          return <ThoughtGraph        {...props} />;
    case "influence":      return <InfluenceTrees      {...props} />;
    case "temporal":       return <TemporalPlayback    {...props} />;
    case "contradictions": return <ContradictionWorkflow {...props} />;
    case "drift":          return <ConceptDriftTimeline  {...props} />;
    case "biography":      return <BiographyDocument   {...props} />;
    case "search":         return <Search              {...props} />;
    case "reminders":      return <Reminders           {...props} />;
    case "export":         return <Export              {...props} />;
    case "share":          return <TherapistMode       {...props} />;
    case "digest":         return <DigestSettings      {...props} />;
    case "import":         return <ImportHistory       {...props} />;
    case "billing":        return <Billing             {...props} />;
    default:               return <Dashboard           {...props} />;
  }
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [authed,      setAuthed]      = useState(AuthStorage.isLoggedIn());
  const [user,        setUser]        = useState(AuthStorage.getUser());
  const [activeView,  setActiveView]  = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("subscribed") === "true") {
      window.history.replaceState({}, "", window.location.pathname);
      return "home";
    }
    return "home";
  });
  const [subBanner, setSubBanner] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("subscribed") === "true" ? params.get("plan") : null;
  });
  const [collapsed,   setCollapsed]   = useState(false);
  const [connected,   setConnected]   = useState(true);
  const [stats,       setStats]       = useState({ entries: 0, concepts: 0, contradictions: 0 });
  const [badgeCounts, setBadgeCounts] = useState({ contradictions: 0 });

  // ── Health check ─────────────────────────────────────────────────────────────
  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) });
        setConnected(res.ok);
      } catch {
        setConnected(false);
      }
    }
    checkHealth();
    const id = setInterval(checkHealth, 30000);
    return () => clearInterval(id);
  }, []);

  // ── Load graph stats ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authed) return;
    authFetch(`${API}/dashboard`).then(r => r.json()).then(d => {
      if (d.stats) {
        setStats(d.stats);
        setBadgeCounts({ contradictions: d.stats.contradictions - (d.stats.resolved || 0) });
      }
    }).catch(() => {});
  }, [authed, activeView]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    function handleKey(e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "[") { setCollapsed(c => !c); return; }
      const nav = NAV.find(n => n.shortcut && n.shortcut === e.key.toUpperCase());
      if (nav) setActiveView(nav.id);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const navigate = useCallback((viewId) => setActiveView(viewId), []);

  function handleAuthenticated(u) { setUser(u); setAuthed(true); }
  function handleLogout() { AuthStorage.clear(); setAuthed(false); setUser(null); }

  if (!authed) {
    return <Auth onAuthenticated={handleAuthenticated} />;
  }

  const currentNav = NAV.find(n => n.id === activeView);

  return (
    <div style={{
      display: "flex", height: "100vh", width: "100vw",
      background: "#0f0e0b", overflow: "hidden",
      fontFamily: "'EB Garamond', Georgia, serif", color: "#e8dcc8",
    }}>
      {/* ── Sidebar ────────────────────────────────────────────────────────── */}
      <div style={{
        width: collapsed ? 56 : 220, flexShrink: 0, height: "100vh",
        background: "rgba(12,11,9,0.98)",
        borderRight: "1px solid rgba(180,140,80,0.18)",
        display: "flex", flexDirection: "column",
        transition: "width 0.25s ease", overflow: "hidden",
      }}>
        {/* Logo */}
        <div style={{
          padding: collapsed ? "18px 0" : "20px 18px",
          borderBottom: "1px solid rgba(180,140,80,0.15)",
          display: "flex", alignItems: "center",
          justifyContent: collapsed ? "center" : "space-between",
          flexShrink: 0,
        }}>
          {!collapsed && (
            <div>
              <div style={{ color: "#c8a96e", fontSize: 13, fontStyle: "italic", letterSpacing: "0.06em" }}>
                Thought Biography
              </div>
              <div style={{ color: "rgba(200,169,110,0.35)", fontSize: 10, letterSpacing: "0.1em", marginTop: 2 }}>
                {user?.display_name}
              </div>
            </div>
          )}
          <button onClick={() => setCollapsed(c => !c)} title="[ to toggle" style={{
            background: "none", border: "none",
            color: "rgba(200,169,110,0.4)", fontSize: 14,
            cursor: "pointer", padding: "4px 6px", borderRadius: 2,
          }}>
            {collapsed ? "▶" : "◀"}
          </button>
        </div>

        {/* Nav groups */}
        <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none", msOverflowStyle: "none", padding: collapsed ? "8px 0" : "8px 0" }}>
          {GROUPS.map(group => {
            const items = NAV.filter(n => n.group === group.id);
            return (
              <div key={group.id} style={{ marginBottom: 4 }}>
                {!collapsed && (
                  <div style={{
                    padding: "10px 18px 4px",
                    color: "rgba(200,169,110,0.3)",
                    fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase",
                  }}>{group.label}</div>
                )}
                {items.map(item => {
                  const active = activeView === item.id;
                  const badge  = badgeCounts[item.id];
                  return (
                    <button key={item.id} onClick={() => setActiveView(item.id)}
                      title={collapsed ? `${item.label}${item.shortcut ? ` (${item.shortcut})` : ""}` : ""}
                      style={{
                        display: "flex", alignItems: "center", width: "100%",
                        padding: collapsed ? "10px 0" : "9px 18px",
                        justifyContent: collapsed ? "center" : "flex-start",
                        gap: 10,
                        background: active ? "rgba(180,140,80,0.12)" : "none",
                        border: "none",
                        borderLeft: active ? "2px solid #c8a96e" : "2px solid transparent",
                        color: active ? "#c8a96e" : "rgba(200,169,110,0.5)",
                        fontSize: collapsed ? 15 : 13,
                        cursor: "pointer", fontFamily: "inherit",
                        transition: "all 0.15s", position: "relative",
                      }}>
                      <span style={{ fontSize: 14, lineHeight: 1 }}>{item.icon}</span>
                      {!collapsed && (
                        <>
                          <span style={{ flex: 1, textAlign: "left" }}>{item.label}</span>
                          {item.shortcut && (
                            <span style={{
                              fontSize: 9, letterSpacing: "0.1em",
                              color: "rgba(200,169,110,0.2)",
                              border: "1px solid rgba(180,140,80,0.15)",
                              padding: "1px 4px", borderRadius: 2,
                            }}>{item.shortcut}</span>
                          )}
                          {badge > 0 && (
                            <span style={{
                              background: "rgba(224,112,112,0.2)",
                              border: "1px solid rgba(224,112,112,0.35)",
                              color: "#e07070", fontSize: 9,
                              padding: "1px 5px", borderRadius: 8,
                            }}>{badge}</span>
                          )}
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Bottom: stats + connection + logout */}
        <div style={{ borderTop: "1px solid rgba(180,140,80,0.15)", flexShrink: 0 }}>
          {!collapsed && (
            <div style={{ padding: "12px 18px" }}>
              <div style={{ display: "flex", gap: 16, marginBottom: 10 }}>
                {[["entries", stats.entries], ["concepts", stats.concepts]].map(([k, v]) => (
                  <div key={k}>
                    <div style={{ color: "#c8a96e", fontSize: 16, fontStyle: "italic" }}>{v}</div>
                    <div style={{ color: "rgba(200,169,110,0.4)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase" }}>{k}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <div style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: connected ? "#6aba6a" : "#e07070",
                }} />
                <span style={{ color: "rgba(200,169,110,0.4)", fontSize: 10 }}>
                  {connected ? "Connected" : "Offline"}
                </span>
              </div>
            </div>
          )}
          <button onClick={handleLogout} title={collapsed ? "Sign out" : ""} style={{
            width: "100%", padding: collapsed ? "12px 0" : "10px 18px",
            background: "none", border: "none", borderTop: "1px solid rgba(180,140,80,0.1)",
            color: "rgba(200,169,110,0.3)",
            fontSize: collapsed ? 14 : 11, letterSpacing: collapsed ? 0 : "0.1em",
            textAlign: collapsed ? "center" : "left",
            cursor: "pointer", fontFamily: "inherit",
          }}>
            {collapsed ? "⊗" : "Sign out"}
          </button>
        </div>
      </div>

      {/* ── Main content area ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Topbar */}
        <div style={{
          height: 52, flexShrink: 0, padding: "0 28px",
          borderBottom: "1px solid rgba(180,140,80,0.15)",
          background: "rgba(12,11,9,0.7)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ color: "#c8a96e", fontSize: 16 }}>{currentNav?.icon}</span>
            <span style={{ color: "#c8a96e", fontSize: 15, fontStyle: "italic" }}>{currentNav?.label}</span>
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            {NAV.filter(n => n.group === "main").map(n => (
              <button key={n.id} onClick={() => setActiveView(n.id)} style={{
                background: "none", border: "none",
                color: activeView === n.id ? "#c8a96e" : "rgba(200,169,110,0.3)",
                fontSize: 12, cursor: "pointer",
                fontFamily: "inherit", letterSpacing: "0.08em",
                borderBottom: activeView === n.id ? "1px solid #c8a96e" : "1px solid transparent",
                padding: "2px 0",
              }}>{n.label}</button>
            ))}
          </div>
        </div>

        {/* View content */}
        <div style={{ flex: 1, overflow: "auto", scrollbarWidth: "none", msOverflowStyle: "none" }}>
          <ErrorBoundary key={activeView}>
            {subBanner && (
              <div style={{
                position: "fixed", top: 0, left: 0, right: 0, zIndex: 999,
                background: "rgba(200,169,110,0.15)", borderBottom: "1px solid rgba(200,169,110,0.3)",
                padding: "12px 24px", textAlign: "center",
                fontFamily: "'EB Garamond', Georgia, serif", color: "#c8a96e", fontSize: 14,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 16,
              }}>
                ✦ Welcome to {subBanner.charAt(0).toUpperCase() + subBanner.slice(1)}! Your 14-day free trial has started.
                <button onClick={() => setSubBanner(null)} style={{ background: "transparent", border: "none", color: "#c8a96e", cursor: "pointer", fontSize: 16 }}>×</button>
              </div>
            )}
            <ViewRouter view={activeView} user={user} onNavigate={navigate} />
          </ErrorBoundary>
        </div>
      </div>

      <ConnectionBanner connected={connected} />
    </div>
  );
}

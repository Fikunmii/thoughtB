import { Component, useState, useEffect } from "react";

// ── Shared styles ─────────────────────────────────────────────────────────────
const parchment = {
  bg: "#0f0e0b",
  surface: "rgba(20,18,14,0.95)",
  gold: "#c8a96e",
  goldFaint: "rgba(200,169,110,0.2)",
  goldMuted: "rgba(200,169,110,0.45)",
  text: "#e8dcc8",
  textMuted: "rgba(232,220,200,0.5)",
  border: "rgba(180,140,80,0.2)",
  error: "rgba(180,60,60,0.15)",
  errorBorder: "rgba(180,60,60,0.35)",
  errorText: "#e07070",
};

// ── Pulse animation ───────────────────────────────────────────────────────────
const pulseStyle = `
  @keyframes tb-pulse {
    0%, 100% { opacity: 0.4; }
    50%       { opacity: 0.8; }
  }
  @keyframes tb-spin {
    to { transform: rotate(360deg); }
  }
  @keyframes tb-fade-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
`;

function injectStyles() {
  if (typeof document !== "undefined" && !document.getElementById("tb-skeleton-styles")) {
    const el = document.createElement("style");
    el.id = "tb-skeleton-styles";
    el.textContent = pulseStyle;
    document.head.appendChild(el);
  }
}

// ── Skeleton atom ─────────────────────────────────────────────────────────────
export function Skeleton({ width = "100%", height = 16, rounded = 3, style = {} }) {
  injectStyles();
  return (
    <div style={{
      width, height,
      background: "rgba(180,140,80,0.08)",
      borderRadius: rounded,
      animation: "tb-pulse 1.8s ease-in-out infinite",
      ...style,
    }} />
  );
}

// ── Skeleton compositions ─────────────────────────────────────────────────────
export function EntryCardSkeleton() {
  return (
    <div style={{
      padding: "16px 20px",
      borderBottom: `1px solid ${parchment.border}`,
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Skeleton width={120} height={12} />
        <Skeleton width={60} height={10} />
      </div>
      <Skeleton width="90%" height={14} />
      <Skeleton width="70%" height={14} />
      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        <Skeleton width={60} height={20} rounded={10} />
        <Skeleton width={75} height={20} rounded={10} />
        <Skeleton width={50} height={20} rounded={10} />
      </div>
    </div>
  );
}

export function GraphSkeleton() {
  return (
    <div style={{
      width: "100%", height: "100%", minHeight: 400,
      display: "flex", alignItems: "center", justifyContent: "center",
      flexDirection: "column", gap: 16,
      background: "rgba(180,140,80,0.02)",
    }}>
      <div style={{
        width: 48, height: 48,
        border: `2px solid ${parchment.gold}`,
        borderTopColor: "transparent",
        borderRadius: "50%",
        animation: "tb-spin 0.9s linear infinite",
      }} />
      <div style={{ color: parchment.goldMuted, fontSize: 13, letterSpacing: "0.1em" }}>
        Loading your graph...
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div style={{ padding: 32, display: "flex", flexDirection: "column", gap: 24 }}>
      <Skeleton width={200} height={28} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        {[1,2,3].map(i => (
          <div key={i} style={{ padding: 20, border: `1px solid ${parchment.border}`, borderRadius: 4 }}>
            <Skeleton width={80}  height={11} style={{ marginBottom: 12 }} />
            <Skeleton width={120} height={32} style={{ marginBottom: 8  }} />
            <Skeleton width="60%" height={12} />
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <div style={{ padding: 20, border: `1px solid ${parchment.border}`, borderRadius: 4 }}>
          <Skeleton width={160} height={14} style={{ marginBottom: 16 }} />
          {[1,2,3].map(i => <EntryCardSkeleton key={i} />)}
        </div>
        <div style={{ padding: 20, border: `1px solid ${parchment.border}`, borderRadius: 4 }}>
          <Skeleton width={120} height={14} style={{ marginBottom: 16 }} />
          {[1,2,3].map(i => (
            <div key={i} style={{ marginBottom: 12 }}>
              <Skeleton width="80%" height={13} style={{ marginBottom: 6 }} />
              <Skeleton width="50%" height={11} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SearchSkeleton() {
  return (
    <div style={{ padding: "24px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
      {[1,2,3,4].map(i => (
        <div key={i} style={{
          padding: "16px 20px",
          border: `1px solid ${parchment.border}`,
          borderRadius: 4,
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <Skeleton width={100} height={11} />
            <Skeleton width={80}  height={11} />
          </div>
          <Skeleton width="95%" height={14} />
          <Skeleton width="80%" height={14} />
          <Skeleton width="60%" height={14} />
        </div>
      ))}
    </div>
  );
}

// ── Loading spinner ───────────────────────────────────────────────────────────
export function Spinner({ size = 24, message = "" }) {
  injectStyles();
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: 12, padding: 24,
    }}>
      <div style={{
        width: size, height: size,
        border: `2px solid ${parchment.goldFaint}`,
        borderTopColor: parchment.gold,
        borderRadius: "50%",
        animation: "tb-spin 0.8s linear infinite",
      }} />
      {message && (
        <div style={{ color: parchment.goldMuted, fontSize: 12, letterSpacing: "0.1em" }}>
          {message}
        </div>
      )}
    </div>
  );
}

// ── Error display ─────────────────────────────────────────────────────────────
export function ErrorMessage({ title = "Something went wrong", detail, onRetry }) {
  injectStyles();
  return (
    <div style={{
      margin: 24, padding: "20px 24px",
      background: parchment.error,
      border: `1px solid ${parchment.errorBorder}`,
      borderRadius: 4,
      animation: "tb-fade-in 0.3s ease",
    }}>
      <div style={{ color: parchment.errorText, fontSize: 15, fontWeight: 500, marginBottom: 6 }}>
        {title}
      </div>
      {detail && (
        <div style={{ color: "rgba(224,112,112,0.75)", fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
          {detail}
        </div>
      )}
      {onRetry && (
        <button onClick={onRetry} style={{
          padding: "7px 16px",
          background: "none",
          border: `1px solid ${parchment.errorBorder}`,
          borderRadius: 3,
          color: parchment.errorText,
          fontSize: 12, letterSpacing: "0.1em",
          cursor: "pointer",
          fontFamily: "'EB Garamond', Georgia, serif",
        }}>
          Try Again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon = "◌", title, subtitle, action, onAction }) {
  injectStyles();
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: 48, gap: 12, textAlign: "center",
      animation: "tb-fade-in 0.4s ease",
    }}>
      <div style={{ fontSize: 32, color: parchment.goldMuted, marginBottom: 8 }}>{icon}</div>
      <div style={{ color: parchment.gold, fontSize: 18, fontStyle: "italic" }}>{title}</div>
      {subtitle && (
        <div style={{ color: parchment.textMuted, fontSize: 14, maxWidth: 320, lineHeight: 1.6 }}>
          {subtitle}
        </div>
      )}
      {action && (
        <button onClick={onAction} style={{
          marginTop: 8, padding: "10px 22px",
          background: "rgba(180,140,80,0.1)",
          border: `1px solid ${parchment.border}`,
          borderRadius: 3,
          color: parchment.gold,
          fontSize: 13, letterSpacing: "0.1em",
          cursor: "pointer",
          fontFamily: "'EB Garamond', Georgia, serif",
        }}>
          {action}
        </button>
      )}
    </div>
  );
}

// ── React Error Boundary ──────────────────────────────────────────────────────
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("[ThoughtBio ErrorBoundary]", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorMessage
          title="This view encountered an error"
          detail={this.state.error?.message || "An unexpected error occurred."}
          onRetry={() => this.setState({ hasError: false, error: null })}
        />
      );
    }
    return this.props.children;
  }
}

// ── Connection status banner ──────────────────────────────────────────────────
export function ConnectionBanner({ connected }) {
  if (connected) return null;
  return (
    <div style={{
      position: "fixed", bottom: 16, left: "50%",
      transform: "translateX(-50%)",
      padding: "10px 20px",
      background: "rgba(15,14,11,0.95)",
      border: `1px solid ${parchment.errorBorder}`,
      borderRadius: 4,
      color: parchment.errorText,
      fontSize: 12, letterSpacing: "0.08em",
      zIndex: 9999,
      animation: "tb-fade-in 0.3s ease",
    }}>
      ⚠ Backend offline — run <code style={{ fontSize: 11, color: "#f0a0a0" }}>python api.py</code> to reconnect
    </div>
  );
}

import { useState, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

// ── Token management ──────────────────────────────────────────────────────────
export const AuthStorage = {
  save: (tokens, user) => {
    // Use sessionStorage for access token (clears on tab close), localStorage for refresh
    sessionStorage.setItem("tb_access",  tokens.access_token);
    localStorage.setItem("tb_refresh",   tokens.refresh_token);
    localStorage.setItem("tb_user",      JSON.stringify(user));
  },
  getAccess:  () => sessionStorage.getItem("tb_access"),
  getRefresh: () => localStorage.getItem("tb_refresh"),
  getUser:    () => { try { return JSON.parse(localStorage.getItem("tb_user")); } catch { return null; } },
  clear: () => {
    sessionStorage.removeItem("tb_access");
    localStorage.removeItem("tb_refresh");
    localStorage.removeItem("tb_user");
  },
  isLoggedIn: () => !!sessionStorage.getItem("tb_access"),
};

// ── Authenticated fetch wrapper ───────────────────────────────────────────────
export async function authFetch(url, options = {}) {
  let token = AuthStorage.getAccess();

  const res = await fetch(url, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    // Try refresh
    const refreshToken = AuthStorage.getRefresh();
    if (!refreshToken) { AuthStorage.clear(); window.location.reload(); return res; }

    const refreshRes = await fetch(`${API}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!refreshRes.ok) { AuthStorage.clear(); window.location.reload(); return res; }

    const data = await refreshRes.json();
    AuthStorage.save({ access_token: data.access_token, refresh_token: data.refresh_token }, data.user);

    // Retry original request
    return fetch(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${data.access_token}` },
    });
  }

  return res;
}

// ── Auth screen ───────────────────────────────────────────────────────────────
export default function Auth({ onAuthenticated }) {
  const [mode,   setMode]   = useState("login"); // "login" | "register"
  const [form,   setForm]   = useState({ email: "", password: "", display_name: "" });
  const [error,  setError]  = useState("");
  const [loading, setLoading] = useState(false);
  const [fadeIn,  setFadeIn]  = useState(false);

  useEffect(() => { setTimeout(() => setFadeIn(true), 50); }, []);

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function submit() {
    setError("");
    if (!form.email || !form.password) { setError("Email and password are required."); return; }
    if (mode === "register" && !form.display_name) { setError("Please enter your name."); return; }
    if (mode === "register" && form.password.length < 8) { setError("Password must be at least 8 characters."); return; }

    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/auth/login" : "/auth/register";
      const body = mode === "login"
        ? { email: form.email, password: form.password }
        : { email: form.email, password: form.password, display_name: form.display_name };

      const res = await fetch(`${API}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
  const msg = Array.isArray(data.detail)
    ? data.detail.map(e => e.msg).join(", ")
    : (data.detail || "Something went wrong.");
  setError(msg);
  return;
}

      AuthStorage.save({ access_token: data.access_token, refresh_token: data.refresh_token }, data.user);
      onAuthenticated(data.user);
    } catch {
      setError("Could not reach the server. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0f0e0b",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'EB Garamond', Georgia, serif",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Background grain texture */}
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E")`,
        opacity: 0.6, pointerEvents: "none"
      }} />

      {/* Warm glow */}
      <div style={{
        position: "absolute",
        width: 600, height: 600,
        background: "radial-gradient(circle, rgba(180,140,80,0.06) 0%, transparent 70%)",
        top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        pointerEvents: "none",
      }} />

      <div style={{
        width: 440,
        padding: "48px 40px",
        background: "rgba(20,18,14,0.95)",
        border: "1px solid rgba(180,140,80,0.2)",
        borderRadius: 4,
        boxShadow: "0 32px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(180,140,80,0.1)",
        opacity: fadeIn ? 1 : 0,
        transform: fadeIn ? "translateY(0)" : "translateY(16px)",
        transition: "opacity 0.5s ease, transform 0.5s ease",
      }}>
        {/* Logo / title */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{
            width: 48, height: 48,
            borderRadius: "50%",
            border: "1.5px solid rgba(180,140,80,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 16px",
            fontSize: 20,
          }}>◎</div>
          <div style={{ color: "#c8a96e", fontSize: 22, letterSpacing: "0.08em", fontStyle: "italic" }}>
            Thought Biography
          </div>
          <div style={{ color: "rgba(200,169,110,0.45)", fontSize: 13, marginTop: 6, letterSpacing: "0.12em" }}>
            {mode === "login" ? "CONTINUE YOUR RECORD" : "BEGIN YOUR RECORD"}
          </div>
        </div>

        {/* Mode tabs */}
        <div style={{ display: "flex", marginBottom: 32, borderBottom: "1px solid rgba(180,140,80,0.15)" }}>
          {["login", "register"].map(m => (
            <button key={m} onClick={() => { setMode(m); setError(""); }}
              style={{
                flex: 1, padding: "10px 0",
                background: "none", border: "none", cursor: "pointer",
                color: mode === m ? "#c8a96e" : "rgba(200,169,110,0.35)",
                fontSize: 12, letterSpacing: "0.14em",
                textTransform: "uppercase",
                borderBottom: mode === m ? "1px solid #c8a96e" : "1px solid transparent",
                marginBottom: -1,
                transition: "color 0.2s",
                fontFamily: "inherit",
              }}>
              {m === "login" ? "Sign In" : "Create Account"}
            </button>
          ))}
        </div>

        {/* Fields */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {mode === "register" && (
            <Field label="Your name" type="text" value={form.display_name}
              onChange={v => update("display_name", v)} placeholder="How you'll be known here" />
          )}
          <Field label="Email" type="email" value={form.email}
            onChange={v => update("email", v)} placeholder="your@email.com" />
          <Field label="Password" type="password" value={form.password}
            onChange={v => update("password", v)}
            placeholder={mode === "register" ? "At least 8 characters" : "Your password"}
            onEnter={submit} />
        </div>

        {error && (
          <div style={{
            marginTop: 16, padding: "10px 14px",
            background: "rgba(180,60,60,0.12)",
            border: "1px solid rgba(180,60,60,0.3)",
            borderRadius: 3,
            color: "#e07070", fontSize: 13, lineHeight: 1.5,
          }}>
            {error}
          </div>
        )}

        <button onClick={submit} disabled={loading} style={{
          width: "100%", marginTop: 24,
          padding: "14px",
          background: loading ? "rgba(180,140,80,0.12)" : "rgba(180,140,80,0.15)",
          border: "1px solid rgba(180,140,80,0.4)",
          borderRadius: 3,
          color: loading ? "rgba(200,169,110,0.4)" : "#c8a96e",
          fontSize: 13, letterSpacing: "0.12em",
          textTransform: "uppercase",
          cursor: loading ? "not-allowed" : "pointer",
          fontFamily: "inherit",
          transition: "all 0.2s",
        }}>
          {loading ? "..." : mode === "login" ? "Enter" : "Begin"}
        </button>

        {mode === "login" && (
          <div style={{
            marginTop: 20, textAlign: "center",
            color: "rgba(200,169,110,0.3)", fontSize: 12, letterSpacing: "0.06em",
          }}>
            Your thoughts are encrypted locally. We cannot read them.
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, type, value, onChange, placeholder, onEnter }) {
  return (
    <div>
      <label style={{
        display: "block", marginBottom: 6,
        color: "rgba(200,169,110,0.55)", fontSize: 11,
        letterSpacing: "0.14em", textTransform: "uppercase",
      }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => e.key === "Enter" && onEnter?.()}
        placeholder={placeholder}
        style={{
          width: "100%", boxSizing: "border-box",
          padding: "11px 14px",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(180,140,80,0.2)",
          borderRadius: 3,
          color: "#e8dcc8",
          fontSize: 15,
          fontFamily: "'EB Garamond', Georgia, serif",
          outline: "none",
          transition: "border-color 0.2s",
        }}
        onFocus={e => e.target.style.borderColor = "rgba(180,140,80,0.5)"}
        onBlur={e  => e.target.style.borderColor = "rgba(180,140,80,0.2)"}
      />
    </div>
  );
}

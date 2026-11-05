import { useState, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function JoinTeam({ onNavigate }) {
  const [status, setStatus] = useState("joining"); // joining | success | error
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const workspaceId = params.get("workspace_id");

    if (!token) { setStatus("error"); setMsg("Invalid invite link — no token found."); return; }

    const tb_token = sessionStorage.getItem("tb_access");
    if (!tb_token) {
      // Not logged in — save token and redirect to auth
      sessionStorage.setItem("tb_join_token", token);
      sessionStorage.setItem("tb_join_workspace", workspaceId || "");
      sessionStorage.setItem("tb_post_auth_route", "/join-team");
      window.location.href = "/";
      return;
    }

    // Extract workspace_id from token if not in URL (workspace embedded in invite URL)
    const wsId = workspaceId || sessionStorage.getItem("tb_join_workspace") || "";
    sessionStorage.removeItem("tb_join_token");
    sessionStorage.removeItem("tb_join_workspace");

    if (!wsId) { setStatus("error"); setMsg("Invalid invite link — workspace not specified."); return; }

    fetch(`${API}/teams/${wsId}/join?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${tb_token}`, "Content-Type": "application/json" },
    })
      .then(r => r.json().then(d => ({ ok: r.ok, data: d })))
      .then(({ ok, data }) => {
        if (ok) { setStatus("success"); setMsg(data.message || "You've joined the workspace."); }
        else { setStatus("error"); setMsg(data.detail || "Failed to join workspace."); }
      })
      .catch(() => { setStatus("error"); setMsg("Network error — please try again."); });
  }, []);

  return (
    <div style={{ minHeight:"100dvh", display:"flex", alignItems:"center", justifyContent:"center", background:"#0d0d0d", padding:24 }}>
      <div style={{ textAlign:"center", maxWidth:400 }}>
        {status === "joining" && (
          <>
            <div style={{ fontSize:32, marginBottom:16, opacity:0.6 }}>◈</div>
            <p style={{ color:"#888", fontSize:15 }}>Joining workspace…</p>
          </>
        )}
        {status === "success" && (
          <>
            <div style={{ fontSize:32, marginBottom:16 }}>✓</div>
            <h2 style={{ color:"#e8d5a3", fontSize:20, margin:"0 0 12px" }}>You're in</h2>
            <p style={{ color:"#888", fontSize:14, marginBottom:28 }}>{msg}</p>
            <button onClick={() => onNavigate ? onNavigate("team") : (window.location.href = "/")}
              style={{ padding:"10px 28px", background:"#c8a96e", border:"none", borderRadius:8, color:"#000", fontSize:14, fontWeight:600, cursor:"pointer" }}>
              Open Workspace
            </button>
          </>
        )}
        {status === "error" && (
          <>
            <div style={{ fontSize:32, marginBottom:16 }}>✕</div>
            <h2 style={{ color:"#e05c5c", fontSize:20, margin:"0 0 12px" }}>Couldn't join</h2>
            <p style={{ color:"#888", fontSize:14, marginBottom:28 }}>{msg}</p>
            <button onClick={() => window.location.href = "/"}
              style={{ padding:"10px 28px", background:"#333", border:"none", borderRadius:8, color:"#ccc", fontSize:14, cursor:"pointer" }}>
              Go to ThoughtB
            </button>
          </>
        )}
      </div>
    </div>
  );
}

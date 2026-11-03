import { useState, useEffect, useCallback } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

function authFetch(url, opts = {}) {
  const token = localStorage.getItem("tb_token");
  return fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}`, ...(opts.headers || {}) },
  });
}

// ── Create Workspace Modal ────────────────────────────────────────────────────
function CreateWorkspaceModal({ onCreated, onClose }) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function handleCreate() {
    if (!name.trim()) return;
    setLoading(true); setErr("");
    const res = await authFetch(`${API}/teams`, {
      method: "POST",
      body: JSON.stringify({ name: name.trim() }),
    });
    setLoading(false);
    if (res.ok) { const d = await res.json(); onCreated(d); }
    else { const d = await res.json(); setErr(d.detail || "Failed to create workspace"); }
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <div style={{ background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:12, padding:32, width:400, maxWidth:"90vw" }}>
        <h2 style={{ margin:"0 0 20px", fontSize:18, color:"#e8d5a3" }}>Create Workspace</h2>
        <input
          value={name} onChange={e => setName(e.target.value)}
          placeholder="e.g. Engineering Team, Research Group"
          onKeyDown={e => e.key === "Enter" && handleCreate()}
          style={{ width:"100%", padding:"10px 14px", background:"#111", border:"1px solid #333", borderRadius:8, color:"#e8d5a3", fontSize:14, boxSizing:"border-box" }}
          autoFocus
        />
        {err && <div style={{ color:"#e05c5c", fontSize:13, marginTop:8 }}>{err}</div>}
        <div style={{ display:"flex", gap:10, marginTop:20, justifyContent:"flex-end" }}>
          <button onClick={onClose} style={{ padding:"8px 18px", background:"none", border:"1px solid #333", borderRadius:8, color:"#888", cursor:"pointer", fontSize:13 }}>Cancel</button>
          <button onClick={handleCreate} disabled={loading || !name.trim()} style={{ padding:"8px 18px", background:"#c8a96e", border:"none", borderRadius:8, color:"#000", cursor:"pointer", fontSize:13, fontWeight:600, opacity: loading ? 0.6 : 1 }}>
            {loading ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Invite Modal ──────────────────────────────────────────────────────────────
function InviteModal({ workspaceId, onClose }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  async function handleInvite() {
    if (!email.trim()) return;
    setLoading(true); setErr(""); setResult(null);
    const res = await authFetch(`${API}/teams/${workspaceId}/invite`, {
      method: "POST",
      body: JSON.stringify({ email: email.trim() }),
    });
    setLoading(false);
    if (res.ok) { const d = await res.json(); setResult(d); }
    else { const d = await res.json(); setErr(d.detail || "Failed to send invite"); }
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <div style={{ background:"#1a1a1a", border:"1px solid #2a2a2a", borderRadius:12, padding:32, width:420, maxWidth:"90vw" }}>
        <h2 style={{ margin:"0 0 20px", fontSize:18, color:"#e8d5a3" }}>Invite Member</h2>
        {!result ? (
          <>
            <input
              value={email} onChange={e => setEmail(e.target.value)} type="email"
              placeholder="colleague@company.com"
              onKeyDown={e => e.key === "Enter" && handleInvite()}
              style={{ width:"100%", padding:"10px 14px", background:"#111", border:"1px solid #333", borderRadius:8, color:"#e8d5a3", fontSize:14, boxSizing:"border-box" }}
              autoFocus
            />
            {err && <div style={{ color:"#e05c5c", fontSize:13, marginTop:8 }}>{err}</div>}
            <div style={{ display:"flex", gap:10, marginTop:20, justifyContent:"flex-end" }}>
              <button onClick={onClose} style={{ padding:"8px 18px", background:"none", border:"1px solid #333", borderRadius:8, color:"#888", cursor:"pointer", fontSize:13 }}>Cancel</button>
              <button onClick={handleInvite} disabled={loading || !email.trim()} style={{ padding:"8px 18px", background:"#c8a96e", border:"none", borderRadius:8, color:"#000", cursor:"pointer", fontSize:13, fontWeight:600, opacity: loading ? 0.6 : 1 }}>
                {loading ? "Sending…" : "Send Invite"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ color:"#8bc89e", fontSize:14, margin:"0 0 12px" }}>✓ Invite sent to {email}</p>
            <p style={{ color:"#888", fontSize:12, margin:"0 0 16px" }}>They'll receive an email with a join link. You can also share this link directly:</p>
            <div style={{ background:"#111", border:"1px solid #2a2a2a", borderRadius:8, padding:"10px 14px", fontSize:11, color:"#c8a96e", wordBreak:"break-all", userSelect:"all" }}>
              {`${window.location.origin}/join-team?token=${result.invite_token}`}
            </div>
            <div style={{ marginTop:20, textAlign:"right" }}>
              <button onClick={onClose} style={{ padding:"8px 18px", background:"#c8a96e", border:"none", borderRadius:8, color:"#000", cursor:"pointer", fontSize:13, fontWeight:600 }}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Decision Card ─────────────────────────────────────────────────────────────
function DecisionCard({ d }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border:"1px solid #2a2a2a", borderRadius:10, padding:"14px 18px", marginBottom:10, cursor:"pointer" }} onClick={() => setOpen(o => !o)}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div>
          <div style={{ fontSize:13, color:"#e8d5a3", fontWeight:600, marginBottom:4 }}>{d.title}</div>
          <div style={{ fontSize:11, color:"#888" }}>
            {d.author_name || "Unknown"} · {d.source === "github_pr" ? "GitHub PR" : d.source} · {d.created_at ? new Date(d.created_at).toLocaleDateString() : ""}
          </div>
        </div>
        <span style={{ color:"#555", fontSize:12 }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ marginTop:14, borderTop:"1px solid #222", paddingTop:14 }}>
          <Label>Rationale</Label>
          <p style={{ margin:"4px 0 12px", fontSize:13, color:"#ccc", lineHeight:1.6 }}>{d.rationale}</p>
          <Label>Alternatives considered</Label>
          <p style={{ margin:"4px 0 12px", fontSize:13, color:"#ccc", lineHeight:1.6 }}>{d.alternatives || "Not stated"}</p>
          <Label>Outcome</Label>
          <p style={{ margin:"4px 0 0", fontSize:13, color:"#ccc", lineHeight:1.6 }}>{d.outcome}</p>
          {d.source_url && (
            <a href={d.source_url} target="_blank" rel="noopener noreferrer" style={{ display:"block", marginTop:10, fontSize:11, color:"#c8a96e" }}>View source →</a>
          )}
        </div>
      )}
    </div>
  );
}

function Label({ children }) {
  return <div style={{ fontSize:10, color:"#666", textTransform:"uppercase", letterSpacing:"0.12em", marginBottom:2 }}>{children}</div>;
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function TeamWorkspace({ user, onNavigate }) {
  const [workspaces, setWorkspaces]     = useState(null);
  const [active, setActive]             = useState(null); // selected workspace detail
  const [decisions, setDecisions]       = useState([]);
  const [tensions, setTensions]         = useState([]);
  const [brief, setBrief]               = useState(null);
  const [tab, setTab]                   = useState("overview"); // overview | decisions | tensions | brief | settings
  const [showCreate, setShowCreate]     = useState(false);
  const [showInvite, setShowInvite]     = useState(false);
  const [briefLoading, setBriefLoading] = useState(false);
  const [chatInput, setChatInput]       = useState("");
  const [chatHistory, setChatHistory]   = useState([]);
  const [chatLoading, setChatLoading]   = useState(false);
  const [linkRepo, setLinkRepo]         = useState("");
  const [repoStatus, setRepoStatus]     = useState("");

  // Load workspace list
  useEffect(() => {
    authFetch(`${API}/teams/me`).then(r => r.ok ? r.json() : []).then(setWorkspaces);
  }, []);

  // Load workspace detail when active changes
  useEffect(() => {
    if (!active) return;
    const wid = active.id;
    authFetch(`${API}/teams/${wid}`).then(r => r.ok ? r.json() : null).then(d => d && setActive(d));
    authFetch(`${API}/teams/${wid}/decisions`).then(r => r.ok ? r.json() : []).then(setDecisions);
    authFetch(`${API}/teams/${wid}/tensions`).then(r => r.ok ? r.json() : []).then(setTensions);
    authFetch(`${API}/teams/${wid}/brief`).then(r => r.ok ? r.json() : null).then(setBrief);
  }, [active?.id]);

  const handleCreated = useCallback(ws => {
    setWorkspaces(prev => [...(prev || []), ws]);
    setShowCreate(false);
    setActive(ws);
  }, []);

  async function generateBrief() {
    setBriefLoading(true);
    const res = await authFetch(`${API}/teams/${active.id}/brief`, { method: "POST" });
    setBriefLoading(false);
    if (res.ok) { const d = await res.json(); setBrief(d); }
  }

  async function linkGitHub() {
    if (!linkRepo.trim()) return;
    setRepoStatus("Saving…");
    const res = await authFetch(`${API}/teams/${active.id}/github?repo=${encodeURIComponent(linkRepo.trim())}`, { method: "PUT" });
    setRepoStatus(res.ok ? "✓ Linked. Add the webhook URL to your GitHub repo settings." : "Failed to link.");
  }

  async function sendChat() {
    if (!chatInput.trim() || chatLoading) return;
    const question = chatInput.trim();
    setChatInput("");
    setChatHistory(h => [...h, { role:"user", content: question }]);
    setChatLoading(true);
    const token = localStorage.getItem("tb_token");
    const res = await fetch(`${API}/teams/${active.id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ content: question }),
    });
    if (!res.ok) { setChatLoading(false); return; }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let answer = "";
    setChatHistory(h => [...h, { role:"assistant", content: "" }]);
    setChatLoading(false);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      answer += decoder.decode(value, { stream: true });
      setChatHistory(h => h.map((m, i) => i === h.length - 1 ? { ...m, content: answer } : m));
    }
  }

  const card = { background:"#111", border:"1px solid #2a2a2a", borderRadius:12, padding:"16px 20px" };
  const tabBtn = (id, label) => (
    <button onClick={() => setTab(id)} style={{ padding:"6px 14px", borderRadius:20, border:"none", cursor:"pointer", fontSize:12, fontWeight:500, background: tab===id ? "#c8a96e" : "transparent", color: tab===id ? "#000" : "#888" }}>
      {label}
    </button>
  );

  // ── no workspaces yet ──
  if (workspaces !== null && workspaces.length === 0 && !active) {
    return (
      <div style={{ padding:40, maxWidth:600, margin:"0 auto", textAlign:"center" }}>
        <div style={{ fontSize:32, marginBottom:16 }}>◈</div>
        <h2 style={{ color:"#e8d5a3", fontSize:22, margin:"0 0 12px" }}>Team Workspaces</h2>
        <p style={{ color:"#888", fontSize:14, lineHeight:1.7, marginBottom:32 }}>
          Create a shared workspace for your team. Publish entries to a shared graph, log decisions automatically from GitHub, and surface tensions between team members' thinking.
        </p>
        <button onClick={() => setShowCreate(true)} style={{ padding:"12px 28px", background:"#c8a96e", border:"none", borderRadius:10, color:"#000", fontSize:14, fontWeight:700, cursor:"pointer" }}>
          Create your first workspace
        </button>
        {showCreate && <CreateWorkspaceModal onCreated={handleCreated} onClose={() => setShowCreate(false)} />}
      </div>
    );
  }

  // ── workspace list sidebar + detail ──
  return (
    <div style={{ display:"flex", height:"100%", overflow:"hidden" }}>
      {/* Sidebar — workspace list */}
      <div style={{ width:220, borderRight:"1px solid #1e1e1e", padding:"20px 0", flexShrink:0, overflowY:"auto" }}>
        <div style={{ padding:"0 16px 12px", fontSize:10, color:"#555", letterSpacing:"0.12em", textTransform:"uppercase" }}>Workspaces</div>
        {(workspaces || []).map(ws => (
          <button key={ws.id} onClick={() => { setActive(ws); setTab("overview"); }}
            style={{ width:"100%", padding:"10px 16px", background: active?.id === ws.id ? "#1e1e1e" : "transparent", border:"none", textAlign:"left", cursor:"pointer", borderLeft: active?.id === ws.id ? "2px solid #c8a96e" : "2px solid transparent" }}>
            <div style={{ fontSize:13, color:"#e8d5a3", fontWeight:500 }}>{ws.name}</div>
            <div style={{ fontSize:10, color:"#666", marginTop:2, textTransform:"capitalize" }}>{ws.role}</div>
          </button>
        ))}
        <button onClick={() => setShowCreate(true)} style={{ width:"100%", padding:"10px 16px", background:"transparent", border:"none", textAlign:"left", cursor:"pointer", color:"#666", fontSize:12, marginTop:4 }}>
          + New workspace
        </button>
      </div>

      {/* Main content */}
      <div style={{ flex:1, overflowY:"auto", padding:32 }}>
        {!active ? (
          <div style={{ color:"#555", fontSize:14, marginTop:60, textAlign:"center" }}>Select a workspace</div>
        ) : (
          <>
            {/* Header */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:24 }}>
              <div>
                <h1 style={{ margin:0, fontSize:22, color:"#e8d5a3" }}>{active.name}</h1>
                <div style={{ fontSize:12, color:"#666", marginTop:4 }}>{active.stats?.member_count || 0} members · {active.stats?.published_entries || 0} published entries · {active.stats?.decisions || 0} decisions</div>
              </div>
              {(active.role === "admin" || active.role === "owner") && (
                <button onClick={() => setShowInvite(true)} style={{ padding:"8px 18px", background:"#c8a96e", border:"none", borderRadius:8, color:"#000", fontSize:12, fontWeight:600, cursor:"pointer" }}>
                  + Invite
                </button>
              )}
            </div>

            {/* Tabs */}
            <div style={{ display:"flex", gap:6, marginBottom:24, background:"#111", padding:"4px 6px", borderRadius:24, width:"fit-content" }}>
              {tabBtn("overview", "Overview")}
              {tabBtn("decisions", `Decisions (${decisions.length})`)}
              {tabBtn("tensions", `Tensions (${tensions.length})`)}
              {tabBtn("brief", "Onboarding Brief")}
              {tabBtn("chat", "Ask the Org")}
              {(active.role === "admin" || active.role === "owner") && tabBtn("settings", "Settings")}
            </div>

            {/* Overview */}
            {tab === "overview" && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
                <div style={card}>
                  <Label>Members</Label>
                  <div style={{ marginTop:10 }}>
                    {(active.members || []).map(m => (
                      <div key={m.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderBottom:"1px solid #1e1e1e" }}>
                        <div>
                          <div style={{ fontSize:13, color:"#e8d5a3" }}>{m.display_name}</div>
                          <div style={{ fontSize:11, color:"#666" }}>{m.email}</div>
                        </div>
                        <div style={{ fontSize:11, color:"#666", textTransform:"capitalize", background:"#1a1a1a", padding:"3px 10px", borderRadius:20 }}>{m.role}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={card}>
                  <Label>Latest Decisions</Label>
                  <div style={{ marginTop:10 }}>
                    {decisions.slice(0, 3).map(d => (
                      <div key={d.id} style={{ padding:"8px 0", borderBottom:"1px solid #1e1e1e" }}>
                        <div style={{ fontSize:13, color:"#e8d5a3" }}>{d.title}</div>
                        <div style={{ fontSize:11, color:"#888", marginTop:2 }}>{d.author_name} · {d.created_at ? new Date(d.created_at).toLocaleDateString() : ""}</div>
                      </div>
                    ))}
                    {decisions.length === 0 && <div style={{ fontSize:13, color:"#555", marginTop:8 }}>No decisions logged yet. Link a GitHub repo in Settings to auto-log from PRs.</div>}
                    {decisions.length > 3 && <button onClick={() => setTab("decisions")} style={{ marginTop:10, background:"none", border:"none", color:"#c8a96e", cursor:"pointer", fontSize:12 }}>View all →</button>}
                  </div>
                </div>
                <div style={{ ...card, gridColumn:"1 / -1" }}>
                  <Label>Open Tensions</Label>
                  <div style={{ marginTop:10 }}>
                    {tensions.slice(0, 3).map((t, i) => (
                      <div key={i} style={{ display:"flex", gap:12, padding:"8px 0", borderBottom:"1px solid #1e1e1e", alignItems:"center" }}>
                        <span style={{ fontSize:18, color:"#e05c5c" }}>⟷</span>
                        <div>
                          <span style={{ fontSize:13, color:"#e8d5a3" }}>{t.user_a_name}</span>
                          <span style={{ fontSize:12, color:"#666" }}> and </span>
                          <span style={{ fontSize:13, color:"#e8d5a3" }}>{t.user_b_name}</span>
                          <span style={{ fontSize:12, color:"#666" }}> hold conflicting views on </span>
                          <span style={{ fontSize:13, color:"#c8a96e" }}>{t.concept}</span>
                        </div>
                      </div>
                    ))}
                    {tensions.length === 0 && <div style={{ fontSize:13, color:"#555", marginTop:8 }}>No cross-member tensions detected yet.</div>}
                  </div>
                </div>
              </div>
            )}

            {/* Decisions */}
            {tab === "decisions" && (
              <div>
                <div style={{ fontSize:13, color:"#888", marginBottom:20, lineHeight:1.7 }}>
                  Architecture Decision Records are automatically generated when a GitHub PR is merged into a linked repo. Each decision captures the reasoning, alternatives considered, and outcome.
                </div>
                {decisions.length === 0
                  ? <div style={{ color:"#555", fontSize:14 }}>No decisions yet. Link a GitHub repo in Settings → the next merged PR will create the first decision automatically.</div>
                  : decisions.map(d => <DecisionCard key={d.id} d={d} />)
                }
              </div>
            )}

            {/* Tensions */}
            {tab === "tensions" && (
              <div>
                <div style={{ fontSize:13, color:"#888", marginBottom:20, lineHeight:1.7 }}>
                  Tensions appear when two members hold conflicting views on the same concept in their published entries. Surfacing these early prevents silent misalignment from growing.
                </div>
                {tensions.length === 0
                  ? <div style={{ color:"#555", fontSize:14 }}>No cross-member tensions detected. This updates as more entries are published to the team graph.</div>
                  : tensions.map((t, i) => (
                    <div key={i} style={{ ...card, marginBottom:12 }}>
                      <div style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
                        <span style={{ fontSize:20, color:"#e05c5c", marginTop:2 }}>⟷</span>
                        <div>
                          <div style={{ fontSize:14, color:"#e8d5a3", marginBottom:6 }}>
                            <strong>{t.user_a_name}</strong> <span style={{ color:"#666" }}>vs</span> <strong>{t.user_b_name}</strong> <span style={{ color:"#666" }}>on</span> <span style={{ color:"#c8a96e" }}>{t.concept}</span>
                          </div>
                          <div style={{ fontSize:12, color:"#888" }}>
                            {t.user_a_name}'s entry: {new Date(t.date_a).toLocaleDateString()} · {t.user_b_name}'s entry: {new Date(t.date_b).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                }
              </div>
            )}

            {/* Onboarding Brief */}
            {tab === "brief" && (
              <div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
                  <div style={{ fontSize:13, color:"#888" }}>
                    A Claude-generated brief for new members — covers the team's key themes, recent decisions, and how to contribute.
                  </div>
                  <button onClick={generateBrief} disabled={briefLoading} style={{ padding:"8px 16px", background:"#c8a96e", border:"none", borderRadius:8, color:"#000", fontSize:12, fontWeight:600, cursor:"pointer", flexShrink:0, marginLeft:16, opacity: briefLoading ? 0.6 : 1 }}>
                    {briefLoading ? "Generating…" : brief?.text ? "Regenerate" : "Generate Brief"}
                  </button>
                </div>
                {brief?.text
                  ? <div style={{ ...card, whiteSpace:"pre-wrap", fontSize:13, color:"#ccc", lineHeight:1.8 }}>{brief.text}</div>
                  : <div style={{ color:"#555", fontSize:14 }}>No brief generated yet. Click Generate Brief to create one.</div>
                }
              </div>
            )}

            {/* Ask the Org */}
            {tab === "chat" && (
              <div style={{ display:"flex", flexDirection:"column", height:"calc(100vh - 200px)", maxHeight:600 }}>
                <div style={{ fontSize:13, color:"#888", marginBottom:16, lineHeight:1.7 }}>
                  Ask anything grounded in your team's published entries and decision log. Answers are cited by author and date.
                </div>
                <div style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column", gap:12, marginBottom:16 }}>
                  {chatHistory.length === 0 && (
                    <div style={{ color:"#444", fontSize:13, marginTop:40, textAlign:"center" }}>
                      Try: "Why did we choose this architecture?" or "What does the team think about autonomy?"
                    </div>
                  )}
                  {chatHistory.map((m, i) => (
                    <div key={i} style={{ alignSelf: m.role==="user" ? "flex-end" : "flex-start", maxWidth:"80%" }}>
                      <div style={{ background: m.role==="user" ? "#c8a96e" : "#1a1a1a", color: m.role==="user" ? "#000" : "#ccc", padding:"10px 14px", borderRadius:10, fontSize:13, lineHeight:1.7, whiteSpace:"pre-wrap" }}>
                        {m.content || <span style={{ opacity:0.5 }}>Thinking…</span>}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display:"flex", gap:10 }}>
                  <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => e.key==="Enter" && !e.shiftKey && sendChat()}
                    placeholder="Ask the org's knowledge…"
                    style={{ flex:1, padding:"10px 14px", background:"#111", border:"1px solid #2a2a2a", borderRadius:8, color:"#e8d5a3", fontSize:13 }} />
                  <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()}
                    style={{ padding:"10px 18px", background:"#c8a96e", border:"none", borderRadius:8, color:"#000", fontSize:13, fontWeight:600, cursor:"pointer", opacity: chatLoading||!chatInput.trim() ? 0.5 : 1 }}>
                    {chatLoading ? "…" : "Send"}
                  </button>
                </div>
              </div>
            )}

            {/* Settings */}
            {tab === "settings" && (
              <div style={{ maxWidth:520 }}>
                <h3 style={{ color:"#e8d5a3", fontSize:15, margin:"0 0 20px" }}>GitHub Auto-ADR</h3>
                <p style={{ color:"#888", fontSize:13, lineHeight:1.7, marginBottom:16 }}>
                  Link a GitHub repo to this workspace. When a PR is merged, ThoughtB automatically generates an Architecture Decision Record from the PR title and description.
                </p>
                <div style={{ display:"flex", gap:10 }}>
                  <input value={linkRepo} onChange={e => setLinkRepo(e.target.value)} placeholder="org/repo-name"
                    style={{ flex:1, padding:"9px 14px", background:"#111", border:"1px solid #333", borderRadius:8, color:"#e8d5a3", fontSize:13 }} />
                  <button onClick={linkGitHub} style={{ padding:"9px 18px", background:"#c8a96e", border:"none", borderRadius:8, color:"#000", fontSize:13, fontWeight:600, cursor:"pointer" }}>Link</button>
                </div>
                {repoStatus && <div style={{ marginTop:10, fontSize:13, color: repoStatus.startsWith("✓") ? "#8bc89e" : "#e05c5c" }}>{repoStatus}</div>}
                {repoStatus.startsWith("✓") && (
                  <div style={{ marginTop:12, background:"#111", border:"1px solid #2a2a2a", borderRadius:8, padding:"12px 16px" }}>
                    <div style={{ fontSize:11, color:"#666", marginBottom:6 }}>Webhook URL — add this in your GitHub repo → Settings → Webhooks</div>
                    <div style={{ fontSize:12, color:"#c8a96e", userSelect:"all", wordBreak:"break-all" }}>
                      {`${API.replace("/api","")}/github/webhook`}
                    </div>
                    <div style={{ fontSize:11, color:"#888", marginTop:8 }}>Select event: <strong>Pull requests</strong>. Content type: <strong>application/json</strong>.</div>
                  </div>
                )}

                <h3 style={{ color:"#e8d5a3", fontSize:15, margin:"32px 0 16px" }}>Members</h3>
                {(active.members || []).map(m => (
                  <div key={m.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:"1px solid #1e1e1e" }}>
                    <div>
                      <div style={{ fontSize:13, color:"#e8d5a3" }}>{m.display_name}</div>
                      <div style={{ fontSize:11, color:"#666" }}>{m.email}</div>
                    </div>
                    <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                      <span style={{ fontSize:11, color:"#666", textTransform:"capitalize" }}>{m.role}</span>
                      {active.role === "owner" && m.role !== "owner" && (
                        <button onClick={async () => {
                          const newRole = m.role === "member" ? "admin" : "member";
                          await authFetch(`${API}/teams/${active.id}/members/${m.id}/role`, { method:"PUT", body: JSON.stringify({ role: newRole }) });
                          setActive(a => ({ ...a, members: a.members.map(x => x.id === m.id ? { ...x, role: newRole } : x) }));
                        }} style={{ fontSize:11, color:"#c8a96e", background:"none", border:"none", cursor:"pointer", padding:"2px 8px", borderRadius:4, border:"1px solid #333" }}>
                          Make {m.role === "member" ? "admin" : "member"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {showCreate && <CreateWorkspaceModal onCreated={handleCreated} onClose={() => setShowCreate(false)} />}
      {showInvite && active && <InviteModal workspaceId={active.id} onClose={() => setShowInvite(false)} />}
    </div>
  );
}

import { useState, useEffect, useCallback } from "react";
import { authFetch } from "../auth/Auth";
import { EmptyState } from "../components/ErrorBoundary";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const C = {
  gold: "#c8a96e",
  goldFaint: "rgba(200,169,110,0.1)",
  goldMuted: "rgba(200,169,110,0.5)",
  text: "#e8dcc8",
  textMuted: "rgba(232,220,200,0.5)",
  border: "rgba(180,140,80,0.18)",
  surface: "rgba(22,20,15,0.98)",
};

const css = `
  @keyframes fd-fade { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
  .fd-card:hover { background: rgba(180,140,80,0.06) !important; border-color: rgba(180,140,80,0.35) !important; }
  .fd-btn:hover { background: rgba(200,169,110,0.18) !important; }
  .fd-link:hover { color: #c8a96e !important; }
`;

function inject() {
  if (!document.getElementById("folders-styles")) {
    const el = document.createElement("style");
    el.id = "folders-styles"; el.textContent = css;
    document.head.appendChild(el);
  }
}

function fmtDate(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Suggestion card ──────────────────────────────────────────────────────────
function SuggestionCard({ suggestion, onAccept, onDismiss }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(suggestion.name);
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    await onAccept(suggestion.id, name);
    setBusy(false);
  }

  return (
    <div style={{
      padding: "18px 20px",
      background: "rgba(200,169,110,0.05)",
      border: `1px solid rgba(200,169,110,0.3)`,
      borderRadius: 4, marginBottom: 12,
      animation: "fd-fade 0.3s ease",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
            Suggested folder · {suggestion.entry_count} entries
          </div>
          {editing ? (
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              style={{
                background: "rgba(255,255,255,0.04)",
                border: `1px solid ${C.border}`,
                borderRadius: 3, padding: "6px 10px",
                color: C.text, fontSize: 17, fontFamily: "inherit",
                outline: "none", width: "100%", marginBottom: 6,
              }}
            />
          ) : (
            <div
              onClick={() => setEditing(true)}
              style={{ color: C.gold, fontSize: 17, fontWeight: 500, cursor: "text", marginBottom: 6 }}
              title="Click to rename"
            >
              {name}
            </div>
          )}
          {suggestion.rationale && (
            <div style={{ color: C.textMuted, fontSize: 13, lineHeight: 1.6, fontStyle: "italic" }}>
              {suggestion.rationale}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button className="fd-btn" disabled={busy} onClick={accept} style={{
          padding: "7px 16px",
          background: "rgba(200,169,110,0.14)",
          border: `1px solid rgba(200,169,110,0.5)`,
          borderRadius: 3, color: C.gold,
          fontSize: 12, letterSpacing: "0.06em",
          cursor: busy ? "default" : "pointer",
          fontFamily: "inherit", transition: "background 0.15s",
          opacity: busy ? 0.6 : 1,
        }}>
          {busy ? "Creating…" : "Accept"}
        </button>
        <button onClick={() => onDismiss(suggestion.id, false)} style={{
          padding: "7px 16px",
          background: "none",
          border: `1px solid ${C.border}`,
          borderRadius: 3, color: C.textMuted,
          fontSize: 12, letterSpacing: "0.06em",
          cursor: "pointer", fontFamily: "inherit",
        }}>
          Not now
        </button>
        <button onClick={() => onDismiss(suggestion.id, true)} style={{
          padding: "7px 16px",
          background: "none", border: "none",
          color: "rgba(232,220,200,0.3)",
          fontSize: 12, cursor: "pointer", fontFamily: "inherit",
          marginLeft: "auto",
        }}>
          Don't suggest this again
        </button>
      </div>
    </div>
  );
}

// ── Folder tile ──────────────────────────────────────────────────────────────
function FolderTile({ folder, onOpen, onRename, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(folder.name);

  function submitRename() {
    setEditing(false);
    if (name.trim() && name !== folder.name) onRename(folder.id, name.trim());
  }

  return (
    <div className="fd-card" onClick={() => !editing && onOpen(folder)} style={{
      padding: "18px 20px",
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 4, cursor: "pointer",
      transition: "all 0.2s",
      animation: "fd-fade 0.3s ease",
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        {editing ? (
          <input
            value={name}
            autoFocus
            onClick={e => e.stopPropagation()}
            onChange={e => setName(e.target.value)}
            onBlur={submitRename}
            onKeyDown={e => e.key === "Enter" && submitRename()}
            style={{
              background: "rgba(255,255,255,0.04)",
              border: `1px solid ${C.border}`,
              borderRadius: 3, padding: "4px 8px",
              color: C.text, fontSize: 16, fontFamily: "inherit",
              outline: "none", width: "100%",
            }}
          />
        ) : (
          <div style={{ color: C.text, fontSize: 16, fontWeight: 500 }}>{folder.name}</div>
        )}
        <div style={{ display: "flex", gap: 8, flexShrink: 0, marginLeft: 8 }}>
          <span
            className="fd-link"
            onClick={e => { e.stopPropagation(); setEditing(true); }}
            style={{ color: "rgba(232,220,200,0.3)", fontSize: 13, cursor: "pointer" }}
            title="Rename"
          >✎</span>
          <span
            className="fd-link"
            onClick={e => { e.stopPropagation(); onDelete(folder.id); }}
            style={{ color: "rgba(232,220,200,0.3)", fontSize: 13, cursor: "pointer" }}
            title="Delete folder"
          >×</span>
        </div>
      </div>
      <div style={{ color: C.goldMuted, fontSize: 12 }}>
        {folder.entry_count} {folder.entry_count === 1 ? "entry" : "entries"}
      </div>
    </div>
  );
}

// ── Folder detail (entries inside it) ───────────────────────────────────────
function FolderDetail({ folder, entries, onBack }) {
  return (
    <div style={{ animation: "fd-fade 0.25s ease" }}>
      <div
        className="fd-link"
        onClick={onBack}
        style={{ color: C.goldMuted, fontSize: 13, cursor: "pointer", marginBottom: 18, display: "inline-block" }}
      >
        ← All folders
      </div>
      <div style={{ color: C.gold, fontSize: 22, marginBottom: 4, fontFamily: "'EB Garamond', Georgia, serif" }}>
        {folder.name}
      </div>
      <div style={{ color: C.textMuted, fontSize: 13, marginBottom: 24 }}>
        {entries.length} {entries.length === 1 ? "entry" : "entries"}
      </div>
      {entries.length === 0 ? (
        <EmptyState icon="✦" title="No entries yet" subtitle="Entries filed into this folder will appear here." />
      ) : (
        entries.map(e => (
          <div key={e.id} style={{
            padding: "16px 20px",
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 4, marginBottom: 10,
          }}>
            <div style={{ color: C.goldMuted, fontSize: 11, letterSpacing: "0.1em", marginBottom: 8 }}>
              {fmtDate(e.created_at)}
              {e.emotional_tone && <span style={{ marginLeft: 10, fontStyle: "italic" }}>· {e.emotional_tone}</span>}
            </div>
            <div style={{ color: C.text, fontSize: 14, lineHeight: 1.7 }}>
              {(e.content || "").slice(0, 280)}{(e.content || "").length > 280 ? "…" : ""}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Folders() {
  inject();
  const [folders, setFolders]         = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [openFolder, setOpenFolder]   = useState(null);
  const [folderEntries, setFolderEntries] = useState([]);
  const [creating, setCreating]       = useState(false);
  const [newName, setNewName]         = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [fRes, sRes] = await Promise.all([
        authFetch(`${API}/folders`),
        authFetch(`${API}/folders/suggestions`),
      ]);
      const fData = fRes.ok ? await fRes.json() : { folders: [] };
      const sData = sRes.ok ? await sRes.json() : { suggestions: [] };
      setFolders(fData.folders || []);
      setSuggestions(sData.suggestions || []);
    } catch {
      setFolders([]);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function openFolderDetail(folder) {
    setOpenFolder(folder);
    try {
      const res = await authFetch(`${API}/folders/${folder.id}/entries`);
      const data = await res.json();
      setFolderEntries(data.entries || []);
    } catch {
      setFolderEntries([]);
    }
  }

  async function acceptSuggestion(id, name) {
    try {
      const res = await authFetch(`${API}/folders/suggestions/${id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) await load();
    } catch {}
  }

  async function dismissSuggestion(id, permanent) {
    try {
      await authFetch(`${API}/folders/suggestions/${id}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permanent }),
      });
      setSuggestions(prev => prev.filter(s => s.id !== id));
    } catch {}
  }

  async function renameFolder(id, name) {
    try {
      await authFetch(`${API}/folders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      await load();
    } catch {}
  }

  async function deleteFolder(id) {
    if (!confirm("Delete this folder? Entries inside it will be unfiled, not deleted.")) return;
    try {
      await authFetch(`${API}/folders/${id}`, { method: "DELETE" });
      await load();
    } catch {}
  }

  async function createFolder() {
    if (!newName.trim()) return;
    try {
      const res = await authFetch(`${API}/folders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        setNewName("");
        setCreating(false);
        await load();
      }
    } catch {}
  }

  return (
    <div style={{
      height: "100%", overflowY: "auto",
      padding: "28px 32px 60px",
      fontFamily: "'EB Garamond', Georgia, serif", color: C.text,
    }}>
      {openFolder ? (
        <FolderDetail
          folder={openFolder}
          entries={folderEntries}
          onBack={() => { setOpenFolder(null); setFolderEntries([]); }}
        />
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ color: C.gold, fontSize: 24, fontFamily: "'EB Garamond', Georgia, serif" }}>
              Folders
            </div>
            <button onClick={() => setCreating(v => !v)} style={{
              padding: "8px 16px",
              background: "none",
              border: `1px solid ${C.border}`,
              borderRadius: 3, color: C.goldMuted,
              fontSize: 12, letterSpacing: "0.08em",
              cursor: "pointer", fontFamily: "inherit",
            }}>
              + New folder
            </button>
          </div>
          <div style={{ color: C.textMuted, fontSize: 13, marginBottom: 24 }}>
            Entries are filed automatically as they're written. New folders are always suggested first — nothing is created without your approval.
          </div>

          {creating && (
            <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && createFolder()}
                autoFocus
                placeholder="Folder name…"
                style={{
                  flex: 1, padding: "10px 14px",
                  background: "rgba(255,255,255,0.03)",
                  border: `1px solid ${C.border}`,
                  borderRadius: 3, color: C.text, fontSize: 14,
                  fontFamily: "inherit", outline: "none",
                }}
              />
              <button onClick={createFolder} style={{
                padding: "10px 18px",
                background: "rgba(200,169,110,0.14)",
                border: `1px solid rgba(200,169,110,0.5)`,
                borderRadius: 3, color: C.gold, fontSize: 13,
                cursor: "pointer", fontFamily: "inherit",
              }}>Create</button>
            </div>
          )}

          {suggestions.length > 0 && (
            <div style={{ marginBottom: 32 }}>
              <div style={{ color: C.goldMuted, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 12 }}>
                Pending suggestions
              </div>
              {suggestions.map(s => (
                <SuggestionCard
                  key={s.id}
                  suggestion={s}
                  onAccept={acceptSuggestion}
                  onDismiss={dismissSuggestion}
                />
              ))}
            </div>
          )}

          {loading ? (
            <div style={{ color: C.textMuted, fontSize: 13 }}>Loading…</div>
          ) : folders.length === 0 ? (
            <EmptyState icon="✦" title="No folders yet"
              subtitle="Folders form automatically as themes emerge in your journal — or create one yourself." />
          ) : (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 14,
            }}>
              {folders.map(f => (
                <FolderTile
                  key={f.id}
                  folder={f}
                  onOpen={openFolderDetail}
                  onRename={renameFolder}
                  onDelete={deleteFolder}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

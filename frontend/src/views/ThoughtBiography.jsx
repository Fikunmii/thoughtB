import { useState, useEffect, useRef, useCallback } from "react";
import { authFetch } from "../auth/Auth";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const C = {
  bg: "#0f0e0b", gold: "#c8a96e", goldFaint: "rgba(200,169,110,0.10)",
  goldMuted: "rgba(200,169,110,0.5)", text: "#e8dcc8",
  textMuted: "rgba(232,220,200,0.5)", border: "rgba(180,140,80,0.18)",
  surface: "rgba(22,20,15,0.98)", red: "#c0392b", green: "#27ae60",
};

const css = `
  @keyframes tb-fade  { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
  @keyframes tb-pulse { 0%,100% { opacity:0.4; } 50% { opacity:1; } }
  .tb-entry:hover { background: rgba(180,140,80,0.05) !important; }
  .tb-btn:hover   { border-color: rgba(200,169,110,0.6) !important; color: #c8a96e !important; }
  .tb-save:hover  { background: rgba(200,169,110,0.18) !important; }
  textarea.tb-area:focus { outline: none; border-color: rgba(180,140,80,0.4) !important; }
`;

function injectStyles() {
  if (typeof document !== "undefined" && !document.getElementById("tb-styles")) {
    const el = document.createElement("style");
    el.id = "tb-styles"; el.textContent = css;
    document.head.appendChild(el);
  }
}

// ── Voice Recorder ────────────────────────────────────────────────────────────
function VoiceButton({ onTranscript, disabled }) {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => { stream.getTracks().forEach(t => t.stop()); sendAudio(); };
      mediaRef.current = mr;
      mr.start(200);
      setRecording(true);
    } catch (e) {
      setError("Microphone access denied.");
    }
  }

  function stop() {
    if (mediaRef.current && mediaRef.current.state !== "inactive") {
      mediaRef.current.stop();
      setRecording(false);
      setProcessing(true);
    }
  }

  async function sendAudio() {
    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    if (blob.size < 100) { setProcessing(false); return; }
    const form = new FormData();
    form.append("file", blob, "recording.webm");
    try {
      const res = await authFetch(`${API}/transcribe`, { method: "POST", body: form });
      if (!res.ok) throw new Error("Transcription failed");
      const d = await res.json();
      onTranscript(d.text);
    } catch (e) {
      setError("Transcription failed. Try typing instead.");
    } finally {
      setProcessing(false);
    }
  }

  const label = recording ? "■ Stop" : processing ? "…" : "🎙";

  return (
    <div style={{ position: "relative" }}>
      <button
        className="tb-btn"
        onClick={recording ? stop : start}
        disabled={disabled || processing}
        title={recording ? "Stop recording" : "Record voice entry"}
        style={{
          padding: "7px 12px", background: "none",
          border: `1px solid ${recording ? C.red : C.border}`,
          borderRadius: 3, color: recording ? C.red : C.goldMuted,
          fontSize: recording ? 13 : 15, cursor: "pointer",
          fontFamily: "inherit",
          animation: recording ? "tb-pulse 1.2s ease infinite" : "none",
          transition: "all 0.2s",
        }}
      >
        {label}
      </button>
      {error && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0,
          background: "#1a0e0e", border: `1px solid ${C.red}`,
          borderRadius: 3, padding: "6px 10px",
          color: "#e07070", fontSize: 11, whiteSpace: "nowrap", zIndex: 10,
        }}>
          {error}
        </div>
      )}
    </div>
  );
}

// ── Concept tags (shown after save) ──────────────────────────────────────────
function ConceptTag({ label }) {
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px",
      background: C.goldFaint, border: `1px solid ${C.border}`,
      borderRadius: 10, fontSize: 11, color: C.gold,
      marginRight: 5, marginBottom: 4,
    }}>{label}</span>
  );
}

// ── Entry list item ───────────────────────────────────────────────────────────
function EntryItem({ entry, isActive, onClick }) {
  const date = new Date(entry.created_at);
  const label = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div
      className="tb-entry"
      onClick={onClick}
      style={{
        padding: "12px 16px",
        borderBottom: `1px solid ${C.border}`,
        cursor: "pointer",
        background: isActive ? C.goldFaint : "transparent",
        borderLeft: isActive ? `3px solid ${C.gold}` : "3px solid transparent",
        transition: "all 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ color: isActive ? C.gold : C.goldMuted, fontSize: 11, letterSpacing: "0.06em" }}>{label}</span>
        <span style={{ color: C.textMuted, fontSize: 10 }}>{entry.word_count}w</span>
      </div>
      <div style={{ color: C.text, fontSize: 13, lineHeight: 1.5, fontStyle: "italic" }}>
        {entry.excerpt || entry.content?.slice(0, 100)}…
      </div>
      {entry.concepts?.length > 0 && (
        <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 3 }}>
          {entry.concepts.slice(0, 3).map(c => (
            <span key={c} style={{ fontSize: 10, color: C.goldMuted }}>◎ {c}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ThoughtBiography({ user, onNavigate }) {
  injectStyles();

  const [entries,      setEntries]      = useState([]);
  const [activeId,     setActiveId]     = useState(null);
  const [draft,        setDraft]        = useState("");
  const [saving,       setSaving]       = useState(false);
  const [saveResult,   setSaveResult]   = useState(null);  // {concepts, summary}
  const [loading,      setLoading]      = useState(true);
  const [deleting,     setDeleting]     = useState(false);
  const [wordCount,    setWordCount]    = useState(0);
  const [mode,         setMode]         = useState("new"); // new | view
  const textareaRef = useRef(null);

  // Load entry list
  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${API}/entries?limit=50`);
      if (res.ok) {
        const d = await res.json();
        setEntries(d.entries || []);
      }
    } catch (e) { /* offline — keep empty */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  // Word count
  useEffect(() => {
    setWordCount(draft.trim().split(/\s+/).filter(Boolean).length);
  }, [draft]);

  // Auto-focus textarea on new mode
  useEffect(() => {
    if (mode === "new" && textareaRef.current) textareaRef.current.focus();
  }, [mode]);

  function startNew() {
    setMode("new");
    setActiveId(null);
    setDraft("");
    setSaveResult(null);
  }

  function openEntry(entry) {
    setMode("view");
    setActiveId(entry.id);
    setDraft(entry.content || "");
    setSaveResult(null);
  }

  async function saveEntry() {
    if (!draft.trim() || saving) return;
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await authFetch(`${API}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      if (!res.ok) throw new Error("Save failed");
      const d = await res.json();
      setSaveResult(d);
      await loadEntries();
      // Stay in the textarea so writer can keep going
      setTimeout(() => setSaveResult(null), 6000);
    } catch (e) {
      setSaveResult({ error: "Save failed — check connection." });
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(id) {
    if (!window.confirm("Delete this entry? This cannot be undone.")) return;
    setDeleting(true);
    try {
      await authFetch(`${API}/entries/${id}`, { method: "DELETE" });
      await loadEntries();
      startNew();
    } catch (e) { /* silent */ }
    finally { setDeleting(false); }
  }

  function handleVoiceTranscript(text) {
    setDraft(prev => prev ? prev + "\n\n" + text : text);
    setMode("new");
    if (textareaRef.current) textareaRef.current.focus();
  }

  // Keyboard shortcut: Ctrl+Enter to save
  function handleKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") saveEntry();
  }

  const activeEntry = entries.find(e => e.id === activeId);

  return (
    <div style={{
      display: "flex", height: "100%",
      fontFamily: "'EB Garamond', Georgia, serif",
      color: C.text,
    }}>

      {/* ── Entry list (left) ─────────────────────────────────────── */}
      <div style={{
        width: 260, flexShrink: 0,
        borderRight: `1px solid ${C.border}`,
        display: "flex", flexDirection: "column",
        background: "rgba(14,13,10,0.6)",
      }}>
        {/* Header */}
        <div style={{
          padding: "14px 16px",
          borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ color: C.goldMuted, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </span>
          <button
            className="tb-btn"
            onClick={startNew}
            style={{
              padding: "4px 10px", background: "none",
              border: `1px solid ${C.border}`, borderRadius: 3,
              color: C.goldMuted, fontSize: 11, cursor: "pointer",
              fontFamily: "inherit", letterSpacing: "0.08em",
              transition: "all 0.2s",
            }}
          >+ New</button>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <div style={{ padding: "24px 16px", color: C.textMuted, fontSize: 13, textAlign: "center" }}>
              Loading…
            </div>
          ) : entries.length === 0 ? (
            <div style={{ padding: "24px 16px", color: C.textMuted, fontSize: 13, textAlign: "center", lineHeight: 1.6 }}>
              No entries yet.<br />Write your first one.
            </div>
          ) : (
            entries.map(entry => (
              <EntryItem
                key={entry.id}
                entry={entry}
                isActive={entry.id === activeId}
                onClick={() => openEntry(entry)}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Writing area (right) ──────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Toolbar */}
        <div style={{
          padding: "10px 28px",
          borderBottom: `1px solid ${C.border}`,
          display: "flex", alignItems: "center", gap: 10,
          background: "rgba(14,13,10,0.4)",
        }}>
          {mode === "view" && activeEntry ? (
            <>
              <span style={{ color: C.goldMuted, fontSize: 12, flex: 1 }}>
                {new Date(activeEntry.created_at).toLocaleDateString("en-US", {
                  weekday: "long", year: "numeric", month: "long", day: "numeric"
                })}
              </span>
              <button
                className="tb-btn"
                onClick={() => deleteEntry(activeEntry.id)}
                disabled={deleting}
                style={{
                  padding: "5px 12px", background: "none",
                  border: `1px solid ${C.border}`, borderRadius: 3,
                  color: "rgba(192,57,43,0.6)", fontSize: 11, cursor: "pointer",
                  fontFamily: "inherit", transition: "all 0.2s",
                }}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </>
          ) : (
            <>
              <span style={{ color: C.textMuted, fontSize: 11, flex: 1, letterSpacing: "0.08em" }}>
                {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                {wordCount > 0 && <span style={{ marginLeft: 10, color: C.goldMuted }}>{wordCount} words</span>}
              </span>
              <VoiceButton onTranscript={handleVoiceTranscript} disabled={saving} />
              <button
                className="tb-btn tb-save"
                onClick={saveEntry}
                disabled={saving || !draft.trim()}
                style={{
                  padding: "6px 18px", background: C.goldFaint,
                  border: `1px solid ${C.border}`, borderRadius: 3,
                  color: draft.trim() ? C.gold : C.textMuted,
                  fontSize: 11, letterSpacing: "0.1em",
                  cursor: draft.trim() ? "pointer" : "default",
                  fontFamily: "inherit", transition: "all 0.2s",
                }}
              >
                {saving ? "Saving…" : "Save  ⌘↵"}
              </button>
            </>
          )}
        </div>

        {/* Textarea / view */}
        <div style={{ flex: 1, overflow: "auto", padding: "36px 60px", maxWidth: 800, margin: "0 auto", width: "100%" }}>
          {mode === "view" ? (
            <div style={{
              color: C.text, fontSize: 17, lineHeight: 1.9,
              fontFamily: "'EB Garamond', Georgia, serif",
              whiteSpace: "pre-wrap", animation: "tb-fade 0.3s ease",
            }}>
              {activeEntry?.content}
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              className="tb-area"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                `${new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening"}. What are you thinking about?`
              }
              style={{
                width: "100%", height: "100%", minHeight: 400,
                background: "none", border: `1px solid ${C.border}`,
                borderRadius: 3, padding: "20px 24px",
                color: C.text, fontSize: 17, lineHeight: 1.9,
                fontFamily: "'EB Garamond', Georgia, serif",
                resize: "none", boxSizing: "border-box",
                transition: "border-color 0.2s",
              }}
            />
          )}
        </div>

        {/* Concepts saved notification */}
        {saveResult && !saveResult.error && (
          <div style={{
            padding: "12px 28px",
            borderTop: `1px solid ${C.border}`,
            background: "rgba(200,169,110,0.05)",
            animation: "tb-fade 0.4s ease",
          }}>
            <div style={{ color: C.goldMuted, fontSize: 11, letterSpacing: "0.1em", marginBottom: 6 }}>
              ✓ SAVED  ·  CONCEPTS EXTRACTED
            </div>
            <div style={{ display: "flex", flexWrap: "wrap" }}>
              {saveResult.concepts?.map(c => (
                <ConceptTag key={c.label || c} label={c.label || c} />
              ))}
            </div>
            {saveResult.summary && (
              <div style={{ color: C.textMuted, fontSize: 12, marginTop: 6, fontStyle: "italic" }}>
                {saveResult.summary}
              </div>
            )}
          </div>
        )}
        {saveResult?.error && (
          <div style={{
            padding: "10px 28px",
            borderTop: `1px solid ${C.border}`,
            background: "rgba(192,57,43,0.05)",
            color: "#e07070", fontSize: 12,
          }}>
            {saveResult.error}
          </div>
        )}
      </div>
    </div>
  );
}
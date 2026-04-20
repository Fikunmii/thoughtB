import { useState, useEffect, useRef, useCallback } from "react";
import { authFetch } from "../auth/Auth";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const C = {
  bg: "#0f0e0b", gold: "#c8a96e", goldFaint: "rgba(200,169,110,0.10)",
  goldMuted: "rgba(200,169,110,0.5)", text: "#e8dcc8",
  textMuted: "rgba(232,220,200,0.5)", border: "rgba(180,140,80,0.18)",
  surface: "rgba(22,20,15,0.98)",
  green: "#27ae60", red: "#c0392b",
};

const css = `
  @keyframes ih-fade  { from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);} }
  @keyframes ih-spin  { to { transform: rotate(360deg); } }
  @keyframes ih-pulse { 0%,100%{opacity:0.5;}50%{opacity:1;} }
  .ih-drop { transition: all 0.2s; }
  .ih-drop.over { border-color: #c8a96e !important; background: rgba(200,169,110,0.06) !important; }
  .ih-btn:hover { border-color: rgba(200,169,110,0.6) !important; color: #c8a96e !important; }
  .ih-del:hover { border-color: rgba(192,57,43,0.5) !important; color: rgba(192,57,43,0.8) !important; }
`;

function inject() {
  if (!document.getElementById("ih-css")) {
    const s = document.createElement("style");
    s.id = "ih-css"; s.textContent = css;
    document.head.appendChild(s);
  }
}

// ── Spinner ───────────────────────────────────────────────────────────────────
function Spinner({ size = 16 }) {
  return (
    <div style={{
      width: size, height: size, border: `2px solid rgba(200,169,110,0.2)`,
      borderTopColor: C.gold, borderRadius: "50%",
      display: "inline-block",
      animation: "ih-spin 0.8s linear infinite",
    }} />
  );
}

// ── Progress bar ─────────────────────────────────────────────────────────────
function ProgressBar({ pct, status }) {
  const color = status === "complete" ? C.green : status === "failed" ? C.red : C.gold;
  return (
    <div>
      <div style={{ height: 4, background: "rgba(180,140,80,0.1)", borderRadius: 2, overflow: "hidden", marginBottom: 4 }}>
        <div style={{
          height: "100%", width: `${pct}%`, background: color,
          borderRadius: 2, transition: "width 0.5s ease",
          animation: status === "processing" ? "ih-pulse 1.5s ease infinite" : "none",
        }} />
      </div>
      <div style={{ color: C.textMuted, fontSize: 10 }}>{pct}%</div>
    </div>
  );
}

// ── Upload zone ───────────────────────────────────────────────────────────────
function UploadZone({ onFile }) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef    = useRef(null);

  function handleDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  }

  function handleChange(e) {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    e.target.value = "";
  }

  return (
    <div
      className={`ih-drop${isDragging ? " over" : ""}`}
      onDragEnter={e => { e.preventDefault(); setIsDragging(true); }}
      onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `2px dashed ${C.border}`, borderRadius: 4,
        padding: "40px 24px", textAlign: "center",
        cursor: "pointer",
      }}
    >
      <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.4 }}>↑</div>
      <div style={{ color: C.gold, fontSize: 14, fontStyle: "italic", marginBottom: 6 }}>
        Drop your Limitless export here
      </div>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.6 }}>
        Accepts .json or .zip &nbsp;·&nbsp; max 50MB<br />
        Export your data from the Limitless app before December 19
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".json,.zip"
        onChange={handleChange}
        style={{ display: "none" }}
      />
    </div>
  );
}

// ── Active job card ───────────────────────────────────────────────────────────
function ActiveJobCard({ job, onDone }) {
  const [status, setStatus] = useState(job);
  const pollRef = useRef(null);

  const poll = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/import/limitless/status/${job.job_id}`);
      if (!res.ok) return;
      const d = await res.json();
      setStatus(d);
      if (d.status === "complete" || d.status === "failed") {
        clearInterval(pollRef.current);
        setTimeout(onDone, 2000);
      }
    } catch { /* ignore */ }
  }, [job.job_id, onDone]);

  useEffect(() => {
    if (job.status === "processing") {
      poll();
      pollRef.current = setInterval(poll, 2500);
    }
    return () => clearInterval(pollRef.current);
  }, [job.job_id, poll]);

  const pct = status.progress_pct ?? (status.total > 0 ? Math.round((status.processed / status.total) * 100) : 0);

  return (
    <div style={{
      padding: "18px 20px",
      background: C.goldFaint, border: `1px solid ${C.border}`,
      borderRadius: 4, marginBottom: 20,
      animation: "ih-fade 0.3s ease",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        {status.status === "processing" ? <Spinner /> : (
          <span style={{ fontSize: 14, color: status.status === "complete" ? C.green : C.red }}>
            {status.status === "complete" ? "✓" : "✕"}
          </span>
        )}
        <div>
          <div style={{ color: C.gold, fontSize: 13 }}>
            {status.status === "processing" ? "Importing…" :
             status.status === "complete"   ? "Import complete" : "Import failed"}
          </div>
          {status.filename && (
            <div style={{ color: C.textMuted, fontSize: 11, marginTop: 1 }}>{status.filename}</div>
          )}
        </div>
      </div>

      <ProgressBar pct={pct} status={status.status} />

      <div style={{ marginTop: 10, display: "flex", gap: 20, fontSize: 11, color: C.textMuted }}>
        <span>Total: {status.total || 0}</span>
        <span style={{ color: C.green }}>Imported: {status.imported || 0}</span>
        {status.failed > 0 && <span style={{ color: C.red }}>Failed: {status.failed}</span>}
        {status.date_from && (
          <span>{status.date_from} – {status.date_to || "present"}</span>
        )}
      </div>
    </div>
  );
}

// ── History row ───────────────────────────────────────────────────────────────
function HistoryRow({ imp, onDelete }) {
  const date = imp.completed_at
    ? new Date(imp.completed_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : new Date(imp.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const statusColor = imp.status === "complete" ? C.green : imp.status === "processing" ? C.gold : C.red;

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr 80px 60px 60px 80px 36px",
      gap: 12, alignItems: "center",
      padding: "12px 16px", borderBottom: `1px solid ${C.border}`,
      fontSize: 12,
    }}>
      <div>
        <div style={{ color: C.text }}>{imp.filename || "Unknown file"}</div>
        {imp.date_from && (
          <div style={{ color: C.textMuted, fontSize: 10, marginTop: 2 }}>
            {imp.date_from} – {imp.date_to || "present"}
          </div>
        )}
      </div>
      <div style={{ color: C.textMuted }}>{date}</div>
      <div style={{ color: C.green }}>{imp.imported || 0}</div>
      {imp.failed > 0
        ? <div style={{ color: C.red }}>{imp.failed}</div>
        : <div style={{ color: C.textMuted }}>—</div>
      }
      <div>
        <span style={{
          padding: "2px 8px", borderRadius: 8, fontSize: 10,
          color: statusColor,
          border: `1px solid ${statusColor}44`,
          textTransform: "capitalize",
        }}>{imp.status}</span>
      </div>
      <button
        className="ih-del"
        onClick={() => onDelete(imp.job_id)}
        title="Delete this import batch"
        style={{
          padding: "3px 7px", background: "none",
          border: `1px solid ${C.border}`, borderRadius: 3,
          color: "rgba(192,57,43,0.4)", fontSize: 11, cursor: "pointer",
          fontFamily: "inherit", transition: "all 0.2s",
        }}
      >✕</button>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ImportHistory({ user, onNavigate }) {
  inject();

  const [activeJob,  setActiveJob]  = useState(null);
  const [history,    setHistory]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [uploading,  setUploading]  = useState(false);
  const [uploadErr,  setUploadErr]  = useState(null);
  const [deleteMsg,  setDeleteMsg]  = useState(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/import/limitless/history`);
      if (res.ok) {
        const d = await res.json();
        setHistory(d.imports || []);
      }
    } catch { /* offline */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  async function handleFile(file) {
    setUploadErr(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      const res = await authFetch(`${API}/import/limitless`, {
        method: "POST",
        body: form,
      });
      const d = await res.json();
      if (!res.ok) {
        setUploadErr(d.detail || "Upload failed.");
        return;
      }
      if (d.status === "nothing_new") {
        setUploadErr("All sessions in this file have already been imported.");
        return;
      }
      setActiveJob(d);
    } catch (e) {
      setUploadErr("Upload failed — check your connection.");
    } finally {
      setUploading(false);
    }
  }

  async function deleteImport(jobId) {
    if (!window.confirm("Delete this import batch? All entries it created will be removed.")) return;
    try {
      const res = await authFetch(`${API}/import/limitless/${jobId}`, { method: "DELETE" });
      const d   = await res.json();
      setDeleteMsg(`Deleted ${d.entries_deleted} entries.`);
      await loadHistory();
      setTimeout(() => setDeleteMsg(null), 4000);
    } catch {
      setDeleteMsg("Delete failed.");
    }
  }

  function onJobDone() {
    setActiveJob(null);
    loadHistory();
  }

  const totalImported = history.reduce((n, i) => n + (i.imported || 0), 0);

  return (
    <div style={{
      maxWidth: 860, margin: "0 auto",
      padding: "32px 40px",
      fontFamily: "'EB Garamond', Georgia, serif",
      color: C.text,
    }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.16em", marginBottom: 6 }}>TOOLS &nbsp;·&nbsp; IMPORT</div>
        <div style={{ fontSize: 26, color: C.gold, fontStyle: "italic" }}>Limitless Import</div>
        <div style={{ color: C.textMuted, fontSize: 13, marginTop: 6, lineHeight: 1.6, maxWidth: 580 }}>
          Limitless was acquired by Meta in December 2025 and shut down. If you exported your data before December 19,
          you can import it here. Your transcripts will be processed through the same concept extraction pipeline as
          your journal entries — building your graph from everything you captured.
        </div>
      </div>

      {/* Stats bar */}
      {totalImported > 0 && (
        <div style={{
          display: "flex", gap: 28, padding: "12px 0",
          borderBottom: `1px solid ${C.border}`, marginBottom: 24,
          animation: "ih-fade 0.4s ease",
        }}>
          <div>
            <div style={{ color: C.gold, fontSize: 24, fontStyle: "italic" }}>{totalImported}</div>
            <div style={{ color: C.textMuted, fontSize: 10, letterSpacing: "0.1em" }}>SESSIONS IMPORTED</div>
          </div>
          <div>
            <div style={{ color: C.gold, fontSize: 24, fontStyle: "italic" }}>{history.length}</div>
            <div style={{ color: C.textMuted, fontSize: 10, letterSpacing: "0.1em" }}>IMPORT BATCHES</div>
          </div>
        </div>
      )}

      {/* Active job */}
      {activeJob && <ActiveJobCard job={activeJob} onDone={onJobDone} />}

      {/* Upload zone */}
      {!activeJob && (
        <div style={{ marginBottom: 32 }}>
          {uploading ? (
            <div style={{
              border: `1px solid ${C.border}`, borderRadius: 4,
              padding: "30px", textAlign: "center",
            }}>
              <Spinner size={24} />
              <div style={{ color: C.textMuted, fontSize: 13, marginTop: 12 }}>Uploading and parsing export file…</div>
            </div>
          ) : (
            <UploadZone onFile={handleFile} />
          )}
          {uploadErr && (
            <div style={{
              marginTop: 10, padding: "9px 14px",
              background: "rgba(192,57,43,0.06)", border: `1px solid rgba(192,57,43,0.25)`,
              borderRadius: 3, color: "#e07070", fontSize: 12, lineHeight: 1.5,
            }}>{uploadErr}</div>
          )}
        </div>
      )}

      {/* Supported formats */}
      <div style={{
        padding: "14px 16px", background: C.goldFaint,
        border: `1px solid ${C.border}`, borderRadius: 3,
        marginBottom: 32, fontSize: 12, lineHeight: 1.7,
      }}>
        <div style={{ color: C.gold, marginBottom: 4 }}>What formats are supported?</div>
        <div style={{ color: C.textMuted }}>
          .json — Single transcript export or full archive (transcripts.json)<br />
          .zip — ZIP archive containing multiple session files<br />
          Rewind legacy format (memories export) is also supported.<br />
          Sessions shorter than 30 words are skipped. Re-uploading the same file is safe — duplicates are detected automatically.
        </div>
      </div>

      {/* History table */}
      <div>
        <div style={{
          display: "flex", alignItems: "center",
          justifyContent: "space-between", marginBottom: 12,
        }}>
          <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.14em" }}>IMPORT HISTORY</div>
          {deleteMsg && <span style={{ color: C.textMuted, fontSize: 11 }}>{deleteMsg}</span>}
        </div>

        {loading ? (
          <div style={{ padding: "20px 0", textAlign: "center" }}><Spinner /></div>
        ) : history.length === 0 ? (
          <div style={{
            padding: "28px 0", textAlign: "center",
            color: C.textMuted, fontSize: 13, fontStyle: "italic",
          }}>No imports yet.</div>
        ) : (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
            {/* Table header */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 80px 60px 60px 80px 36px",
              gap: 12, padding: "8px 16px",
              background: "rgba(200,169,110,0.06)",
              borderBottom: `1px solid ${C.border}`,
              fontSize: 9, letterSpacing: "0.12em", color: C.goldMuted,
              textTransform: "uppercase",
            }}>
              <span>File</span>
              <span>Date</span>
              <span>Imported</span>
              <span>Failed</span>
              <span>Status</span>
              <span />
            </div>
            {history.map((imp, i) => (
              <HistoryRow key={imp.job_id || i} imp={imp} onDelete={deleteImport} />
            ))}
          </div>
        )}
      </div>

      {/* Graph note */}
      {totalImported > 0 && (
        <div style={{
          marginTop: 24, padding: "14px 16px",
          border: `1px solid ${C.border}`, borderRadius: 3,
          color: C.textMuted, fontSize: 12, lineHeight: 1.7,
        }}>
          Your imported sessions have been processed through the concept extraction pipeline and added to your knowledge graph.
          {" "}
          <span
            onClick={() => onNavigate?.("graph")}
            style={{ color: C.gold, cursor: "pointer", textDecoration: "underline" }}
          >
            View your graph →
          </span>
        </div>
      )}
    </div>
  );
}
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

// File type info
const FILE_TYPES = [
  { ext: ".pdf",  icon: "📄", label: "PDF" },
  { ext: ".docx", icon: "📝", label: "Word" },
  { ext: ".txt",  icon: "📃", label: "Text" },
  { ext: ".md",   icon: "📃", label: "Markdown" },
  { ext: ".json", icon: "🗂", label: "JSON / Limitless" },
  { ext: ".zip",  icon: "📦", label: "ZIP Archive" },
];

function FileTypeChips() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
      {FILE_TYPES.map(ft => (
        <span key={ft.ext} style={{
          padding: "3px 10px", borderRadius: 20, fontSize: 11,
          border: `1px solid ${C.border}`, color: C.textMuted,
        }}>
          {ft.icon} {ft.label}
        </span>
      ))}
    </div>
  );
}

function UploadZone({ onFile, uploading }) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef(null);

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

  if (uploading) {
    return (
      <div style={{
        border: `1px solid ${C.border}`, borderRadius: 4,
        padding: "30px", textAlign: "center",
      }}>
        <Spinner size={24} />
        <div style={{ color: C.textMuted, fontSize: 13, marginTop: 12 }}>
          Uploading and processing file…
        </div>
      </div>
    );
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
      <div style={{ fontSize: 32, marginBottom: 10 }}>↑</div>
      <div style={{ color: C.gold, fontSize: 15, fontStyle: "italic", marginBottom: 8 }}>
        Drop any file here, or click to browse
      </div>
      <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.6, marginBottom: 12 }}>
        Your file will be processed through the concept extraction pipeline<br />
        and added to your knowledge graph as journal entries.
      </div>
      <FileTypeChips />
      <div style={{ color: C.textMuted, fontSize: 11, marginTop: 10 }}>
        Max 50 MB
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.txt,.md,.json,.zip"
        onChange={handleChange}
        style={{ display: "none" }}
      />
    </div>
  );
}

function ActiveJobCard({ job, onDone }) {
  const [status, setStatus] = useState(job);
  const pollRef = useRef(null);

  const poll = useCallback(async () => {
    try {
      const res = await authFetch(`${API}/import/file/status/${job.job_id}`);
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
            {status.status === "processing" ? "Processing…" :
             status.status === "complete"   ? "Import complete" : "Import failed"}
          </div>
          {status.filename && (
            <div style={{ color: C.textMuted, fontSize: 11, marginTop: 1 }}>{String(status.filename)}</div>
          )}
        </div>
      </div>

      <ProgressBar pct={pct} status={status.status} />

      <div style={{ marginTop: 10, display: "flex", gap: 20, fontSize: 11, color: C.textMuted }}>
        <span>Chunks: {status.total || 0}</span>
        <span style={{ color: C.green }}>Imported: {status.imported || 0}</span>
        {(status.failed || 0) > 0 && <span style={{ color: C.red }}>Failed: {status.failed}</span>}
      </div>
    </div>
  );
}

function typeIcon(fileType) {
  const map = { pdf: "📄", docx: "📝", txt: "📃", md: "📃", json: "🗂", zip: "📦" };
  return map[fileType] || "📁";
}

function HistoryRow({ imp, onDelete }) {
  const dateStr = imp.completed_at || imp.created_at;
  const date = dateStr
    ? new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";

  const statusColor = imp.status === "complete" ? C.green : imp.status === "processing" ? C.gold : C.red;

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "32px 1fr 80px 60px 60px 80px 36px",
      minWidth: 460,
      gap: 10, alignItems: "center",
      padding: "12px 16px", borderBottom: `1px solid ${C.border}`,
      fontSize: 12,
    }}>
      <div style={{ fontSize: 16, textAlign: "center" }}>{typeIcon(imp.file_type)}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {String(imp.filename || "Unknown file")}
        </div>
      </div>
      <div style={{ color: C.textMuted }}>{date}</div>
      <div style={{ color: C.green }}>{imp.imported || 0}</div>
      {(imp.failed || 0) > 0
        ? <div style={{ color: C.red }}>{imp.failed}</div>
        : <div style={{ color: C.textMuted }}>—</div>
      }
      <div>
        <span style={{
          padding: "2px 8px", borderRadius: 8, fontSize: 10,
          color: statusColor,
          border: `1px solid ${statusColor}44`,
          textTransform: "capitalize",
        }}>{String(imp.status || "unknown")}</span>
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
      const res = await authFetch(`${API}/import/file/history`);
      if (res.ok) {
        const d = await res.json();
        setHistory(Array.isArray(d.imports) ? d.imports : []);
      }
      // 422/401/403 → just show empty history, don't crash
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
      const res = await authFetch(`${API}/import/file`, {
        method: "POST",
        body: form,
      });
      let d;
      try { d = await res.json(); } catch { d = {}; }

      if (!res.ok) {
        // d.detail can be a string or a FastAPI validation array
        let msg = `Upload failed (${res.status}).`;
        if (d && d.detail) {
          if (typeof d.detail === "string") msg = d.detail;
          else if (Array.isArray(d.detail)) msg = d.detail.map(e => e.msg || JSON.stringify(e)).join("; ");
          else msg = JSON.stringify(d.detail);
        }
        setUploadErr(msg);
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
      const res = await authFetch(`${API}/import/file/${jobId}`, { method: "DELETE" });
      let d;
      try { d = await res.json(); } catch { d = {}; }
      setDeleteMsg(`Deleted ${d.entries_deleted || 0} entries.`);
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
        <div style={{ fontSize: 26, color: C.gold, fontStyle: "italic" }}>Import Data</div>
        <div style={{ color: C.textMuted, fontSize: 13, marginTop: 6, lineHeight: 1.6, maxWidth: 580 }}>
          Import any file into your knowledge graph. Books, notes, documents, transcripts — 
          anything you've read or written gets processed through the same concept extraction 
          pipeline as your journal entries.
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
            <div style={{ color: C.textMuted, fontSize: 10, letterSpacing: "0.1em" }}>CHUNKS IMPORTED</div>
          </div>
          <div>
            <div style={{ color: C.gold, fontSize: 24, fontStyle: "italic" }}>{history.length}</div>
            <div style={{ color: C.textMuted, fontSize: 10, letterSpacing: "0.1em" }}>FILES PROCESSED</div>
          </div>
        </div>
      )}

      {/* Active job */}
      {activeJob && <ActiveJobCard job={activeJob} onDone={onJobDone} />}

      {/* Upload zone */}
      {!activeJob && (
        <div style={{ marginBottom: 32 }}>
          <UploadZone onFile={handleFile} uploading={uploading} />
          {uploadErr && (
            <div style={{
              marginTop: 10, padding: "9px 14px",
              background: "rgba(192,57,43,0.06)", border: `1px solid rgba(192,57,43,0.25)`,
              borderRadius: 3, color: "#e07070", fontSize: 12, lineHeight: 1.5,
            }}>{String(uploadErr)}</div>
          )}
        </div>
      )}

      {/* How it works */}
      <div style={{
        padding: "14px 16px", background: C.goldFaint,
        border: `1px solid ${C.border}`, borderRadius: 3,
        marginBottom: 32, fontSize: 12, lineHeight: 1.8,
      }}>
        <div style={{ color: C.gold, marginBottom: 6 }}>How import works</div>
        <div style={{ color: C.textMuted }}>
          <strong style={{ color: C.text }}>📄 PDF</strong> — Books, articles, research papers, exported notes<br />
          <strong style={{ color: C.text }}>📝 Word (.docx)</strong> — Documents, essays, notes<br />
          <strong style={{ color: C.text }}>📃 Text / Markdown</strong> — Plain text notes, journal exports, blog drafts<br />
          <strong style={{ color: C.text }}>🗂 JSON</strong> — Limitless / Rewind transcript exports<br />
          <strong style={{ color: C.text }}>📦 ZIP</strong> — Archive of multiple files (JSON or text)<br />
          <br />
          Long documents are split into ~800-word chunks. Each chunk is processed individually 
          for concept extraction. Re-uploading a file is safe.
        </div>
      </div>

      {/* History table */}
      <div>
        <div style={{
          display: "flex", alignItems: "center",
          justifyContent: "space-between", marginBottom: 12,
        }}>
          <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.14em" }}>IMPORT HISTORY</div>
          {deleteMsg && <span style={{ color: C.textMuted, fontSize: 11 }}>{String(deleteMsg)}</span>}
        </div>

        {loading ? (
          <div style={{ padding: "20px 0", textAlign: "center" }}><Spinner /></div>
        ) : history.length === 0 ? (
          <div style={{
            padding: "28px 0", textAlign: "center",
            color: C.textMuted, fontSize: 13, fontStyle: "italic",
          }}>No imports yet.</div>
        ) : (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <div style={{
              display: "grid", gridTemplateColumns: "32px 1fr 80px 60px 60px 80px 36px",
              minWidth: 460,
              gap: 10, padding: "8px 16px",
              background: "rgba(200,169,110,0.06)",
              borderBottom: `1px solid ${C.border}`,
              fontSize: 9, letterSpacing: "0.12em", color: C.goldMuted,
              textTransform: "uppercase",
            }}>
              <span />
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

      {totalImported > 0 && (
        <div style={{
          marginTop: 24, padding: "14px 16px",
          border: `1px solid ${C.border}`, borderRadius: 3,
          color: C.textMuted, fontSize: 12, lineHeight: 1.7,
        }}>
          Your imported files have been processed and added to your knowledge graph.{" "}
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

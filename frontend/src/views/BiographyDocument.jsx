import { useState, useEffect, useRef, useCallback } from "react";
import { authFetch, AuthStorage } from "../auth/Auth";
import { useIsMobile } from "../hooks/useIsMobile";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const C = {
  bg: "#0f0e0b", gold: "#c8a96e", goldFaint: "rgba(200,169,110,0.10)",
  goldMuted: "rgba(200,169,110,0.5)", text: "#e8dcc8",
  textMuted: "rgba(232,220,200,0.5)", border: "rgba(180,140,80,0.18)",
  surface: "rgba(22,20,15,0.98)",
};

const css = `
  @keyframes bd-fade  { from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);} }
  @keyframes bd-blink { 0%,100%{opacity:1;}50%{opacity:0;} }
  @keyframes bd-glow  { 0%,100%{box-shadow:0 0 0 rgba(200,169,110,0);}50%{box-shadow:0 0 28px rgba(200,169,110,0.07);} }
  .bd-btn:hover { border-color: rgba(200,169,110,0.6) !important; color: #c8a96e !important; }
  .bd-hist-item:hover { background: rgba(180,140,80,0.05) !important; cursor: pointer; }
  .bd-export-btn:hover { background: rgba(200,169,110,0.12) !important; }
`;

function inject() {
  if (!document.getElementById("bd-css")) {
    const s = document.createElement("style");
    s.id = "bd-css"; s.textContent = css;
    document.head.appendChild(s);
  }
}

function Cursor() {
  return <span style={{ display: "inline-block", width: 2, height: "0.9em", background: C.gold, verticalAlign: "middle", margin: "0 1px", animation: "bd-blink 1s step-end infinite" }} />;
}

function StreamView({ text, isStreaming }) {
  const parts = text.split(/^(##\s+.+)$/m).filter(Boolean);
  return (
    <div>
      {parts.map((part, i) => {
        if (part.startsWith("## ")) {
          return (
            <h2 key={i} style={{
              fontFamily: "'EB Garamond', Georgia, serif",
              fontSize: 19, fontWeight: "normal", fontStyle: "italic",
              color: C.gold, marginBottom: 14, marginTop: i > 0 ? 32 : 0,
              paddingBottom: 8, borderBottom: `1px solid ${C.border}`,
            }}>{part.replace(/^##\s+/, "")}</h2>
          );
        }
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <p key={i} style={{
              color: C.text, fontSize: 16, lineHeight: 1.9,
              fontFamily: "'EB Garamond', Georgia, serif",
              margin: "0 0 16px 0", fontWeight: 500,
            }}>{part.slice(2, -2)}</p>
          );
        }
        if (part.trim() === "---") {
          return <hr key={i} style={{ border: "none", borderTop: `1px solid ${C.border}`, margin: "32px 0" }} />;
        }
        return part.split("\n\n").filter(Boolean).map((para, j) => (
          <p key={`${i}-${j}`} style={{
            color: C.text, fontSize: 16, lineHeight: 1.9,
            fontFamily: "'EB Garamond', Georgia, serif",
            margin: "0 0 16px 0",
          }}>{para.trim()}</p>
        ));
      })}
      {isStreaming && <Cursor />}
    </div>
  );
}

function SectionStatus({ label, status }) {
  const dot = status === "complete" ? "✓" : status === "generating" ? "…" : "◎";
  const color = status === "complete" ? C.gold : status === "generating" ? C.goldMuted : C.textMuted;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
      <span style={{ color, fontSize: 11, width: 14 }}>{dot}</span>
      <span style={{ color: status === "complete" ? C.textMuted : C.textMuted, fontSize: 11 }}>{label}</span>
    </div>
  );
}

function GeneratePanel({ onGenerate, generating, sectionStatuses, status, readiness }) {
  const [style, setStyle] = useState("literary");

  function submit() {
    onGenerate({ style });
  }

  const hasEnough = !readiness || readiness.ready;

  return (
    <div style={{ padding: "20px 0" }}>
      {readiness && !readiness.ready && (
        <div style={{ marginBottom: 16, padding: "12px 14px", background: "rgba(200,169,110,0.05)", border: `1px solid ${C.border}`, borderRadius: 4 }}>
          <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.7 }}>
            Write {readiness.entries_needed} more {readiness.entries_needed === 1 ? "entry" : "entries"} to unlock your biography.
          </div>
          <div style={{ marginTop: 8, height: 3, background: "rgba(180,140,80,0.12)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 2, background: C.gold,
              width: `${Math.min(100, ((readiness.entry_count || 0) / readiness.min_required) * 100)}%`,
              transition: "width 0.6s ease",
            }} />
          </div>
          <div style={{ color: C.goldMuted, fontSize: 10, marginTop: 4 }}>
            {readiness.entry_count || 0} / {readiness.min_required} entries
          </div>
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.12em", marginBottom: 6 }}>STYLE</div>
        <div style={{ display: "flex", gap: 6 }}>
          {["literary", "analytical", "reflective"].map(s => (
            <button key={s} onClick={() => setStyle(s)} style={{
              flex: 1, padding: "6px 0",
              background: style === s ? C.goldFaint : "none",
              border: `1px solid ${style === s ? C.gold : C.border}`,
              borderRadius: 3, color: style === s ? C.gold : C.textMuted,
              fontSize: 11, cursor: "pointer", fontFamily: "inherit",
              letterSpacing: "0.08em", textTransform: "capitalize",
              transition: "all 0.2s",
            }}>{s}</button>
          ))}
        </div>
      </div>

      {generating && Object.keys(sectionStatuses).length > 0 && (
        <div style={{ marginBottom: 16, padding: "12px 14px", background: "rgba(200,169,110,0.04)", border: `1px solid ${C.border}`, borderRadius: 4 }}>
          {Object.entries(sectionStatuses).map(([key, st]) => (
            <SectionStatus key={key} label={key.replace(/_/g, " ")} status={st} />
          ))}
        </div>
      )}

      {status && !generating && (
        <div style={{ marginBottom: 10, color: C.textMuted, fontSize: 12, fontStyle: "italic" }}>{status}</div>
      )}

      <button
        className="bd-btn"
        onClick={submit}
        disabled={generating || !hasEnough}
        style={{
          width: "100%", padding: "11px 0",
          background: generating ? C.goldFaint : "none",
          border: `1px solid ${generating ? C.gold : hasEnough ? C.border : "rgba(180,140,80,0.1)"}`,
          borderRadius: 3,
          color: generating ? C.goldMuted : hasEnough ? C.gold : C.textMuted,
          fontSize: 12, letterSpacing: "0.12em",
          cursor: generating || !hasEnough ? "default" : "pointer",
          fontFamily: "'EB Garamond', Georgia, serif",
          animation: generating ? "bd-glow 2s ease infinite" : "none",
          transition: "all 0.3s",
        }}
      >
        {generating ? "Writing your biography…" : "Generate Biography"}
      </button>
    </div>
  );
}

function ExportBar({ fullText, onSave, saveStatus }) {
  const [exporting, setExporting] = useState(null);

  async function exportAs(fmt) {
    if (!fullText) return;
    setExporting(fmt);
    try {
      const res = await authFetch(`${API}/biography/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_text: fullText, format: fmt }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const ext = fmt === "pdf" ? "pdf" : fmt === "docx" ? "docx" : "md";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `thought-biography-${new Date().toISOString().slice(0, 10)}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export error", e);
    } finally {
      setExporting(null);
    }
  }

  const btnStyle = (fmt) => ({
    padding: "7px 14px",
    background: "none",
    border: `1px solid ${C.border}`,
    borderRadius: 3,
    color: exporting === fmt ? C.gold : C.goldMuted,
    fontSize: 11,
    cursor: exporting ? "default" : "pointer",
    fontFamily: "inherit",
    letterSpacing: "0.08em",
    transition: "all 0.2s",
  });

  return (
    <div style={{
      marginTop: 40, paddingTop: 24,
      borderTop: `1px solid ${C.border}`,
      display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
    }}>
      <button className="bd-export-btn" style={btnStyle("pdf")} onClick={() => exportAs("pdf")}>
        {exporting === "pdf" ? "Exporting…" : "↓ PDF"}
      </button>
      <button className="bd-export-btn" style={btnStyle("docx")} onClick={() => exportAs("docx")}>
        {exporting === "docx" ? "Exporting…" : "↓ Word"}
      </button>
      <button className="bd-export-btn" style={btnStyle("md")} onClick={() => exportAs("md")}>
        {exporting === "md" ? "Exporting…" : "↓ Markdown"}
      </button>
      <div style={{ flex: 1 }} />
      <button
        className="bd-btn"
        onClick={onSave}
        style={{
          padding: "7px 16px", background: "none",
          border: `1px solid ${C.border}`, borderRadius: 3,
          color: C.goldMuted, fontSize: 11, cursor: "pointer",
          fontFamily: "inherit", letterSpacing: "0.08em", transition: "all 0.2s",
        }}
      >
        Save
      </button>
      {saveStatus && <span style={{ color: C.textMuted, fontSize: 12 }}>{saveStatus}</span>}
    </div>
  );
}

function HistoryItem({ bio, onClick }) {
  const d = new Date(bio.generated_at || Date.now());
  const label = isNaN(d) ? "Unknown date" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <div className="bd-hist-item" onClick={onClick} style={{
      padding: "10px 14px",
      borderBottom: `1px solid ${C.border}`,
      transition: "all 0.15s",
    }}>
      <div style={{ color: C.gold, fontSize: 12 }}>{label}</div>
      <div style={{ color: C.textMuted, fontSize: 10, marginTop: 1, textTransform: "capitalize" }}>
        {bio.style || "literary"} style
      </div>
    </div>
  );
}

export default function BiographyDocument({ user, onNavigate }) {
  inject();
  const isMobile = useIsMobile();

  const [tab,              setTab]              = useState("generate");
  const [generating,       setGenerating]       = useState(false);
  const [streamText,       setStreamText]       = useState("");
  const [sectionStatuses,  setSectionStatuses]  = useState({});
  const [status,           setStatus]           = useState(null);
  const [readiness,        setReadiness]        = useState(null);
  const [history,          setHistory]          = useState([]);
  const [histLoading,      setHistLoading]      = useState(false);
  const [saveStatus,       setSaveStatus]       = useState(null);
  const [error,            setError]            = useState(null);

  useEffect(() => {
    authFetch(`${API}/biography`)
      .then(r => r.json())
      .then(d => {
        setReadiness(d);
        if (d.text) setStreamText(d.text);
      })
      .catch(() => setReadiness({ ready: false, entry_count: 0, min_required: 5, entries_needed: 5 }));
  }, []);

  useEffect(() => {
    if (tab !== "history") return;
    setHistLoading(true);
    authFetch(`${API}/biography/history`)
      .then(r => r.json())
      .then(d => setHistory(d.biographies || []))
      .catch(() => {})
      .finally(() => setHistLoading(false));
  }, [tab]);

  const generate = useCallback(async (params) => {
    setGenerating(true);
    setStreamText("");
    setSectionStatuses({});
    setSaveStatus(null);
    setError(null);
    setStatus("Analysing your journal…");

    try {
      let token = AuthStorage.getAccess() || "";
      const qs = new URLSearchParams({ style: params.style || "literary" });
      let res = await fetch(`${API}/biography/stream?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      // If token expired, try refresh once (mirrors authFetch behaviour)
      if (res.status === 401) {
        const refreshToken = AuthStorage.getRefresh();
        if (refreshToken) {
          const refreshRes = await fetch(`${API}/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token: refreshToken }),
          });
          if (refreshRes.ok) {
            const data = await refreshRes.json();
            AuthStorage.save({ access_token: data.access_token, refresh_token: data.refresh_token }, data.user);
            token = data.access_token;
            res = await fetch(`${API}/biography/stream?${qs}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
          } else {
            AuthStorage.clear();
            window.location.reload();
            return;
          }
        }
      }

      if (!res.ok || !res.body) throw new Error(`Server error: ${res.status}`);

      setStatus(null);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") break;
          try {
            const obj = JSON.parse(raw);
            if (obj.error) throw new Error(obj.error);

            const sec = obj.section || "";
            const st = obj.status || "";

            // Update section progress
            if (sec && sec !== "__complete__") {
              const label = sec
                .replace("opening_revised", "revised opening")
                .replace("era_", "")
                .replace("concept_", "concept: ")
                .replace("contradiction_", "tension: ")
                .replace(/_/g, " ");
              setSectionStatuses(prev => ({ ...prev, [label]: st }));
            }

            if (obj.text) {
              fullText += obj.text;
              setStreamText(fullText);
            }

            if (st === "done" && obj.full_text) {
              fullText = obj.full_text;
              setStreamText(fullText);
            }
          } catch (e) {
            if (e.message && !e.message.includes("JSON")) throw e;
          }
        }
      }

      setStatus(null);
      setGenerating(false);
    } catch (e) {
      setError(e.message || "Generation failed. Please try again.");
      setGenerating(false);
      setStatus(null);
    }
  }, []);

  async function saveCurrentBiography() {
    if (!streamText) return;
    setSaveStatus("Saving…");
    try {
      const res = await authFetch(`${API}/biography/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_text: streamText }),
      });
      setSaveStatus(res.ok ? "Saved." : "Save failed.");
    } catch {
      setSaveStatus("Save failed.");
    }
    setTimeout(() => setSaveStatus(null), 3000);
  }

  const hasBiography = streamText.length > 0;

  return (
    <div style={{
      display: "flex", flexDirection: isMobile ? "column" : "row",
      height: "100%", overflowY: isMobile ? "auto" : "visible",
      fontFamily: "'EB Garamond', Georgia, serif", color: C.text,
    }}>

      {/* ── Left panel ── */}
      <div style={{
        width: isMobile ? "100%" : 272, flexShrink: 0,
        maxHeight: isMobile ? "none" : "none",
        borderRight: isMobile ? "none" : `1px solid ${C.border}`,
        borderBottom: isMobile ? `1px solid ${C.border}` : "none",
        display: "flex", flexDirection: "column",
        background: "rgba(14,13,10,0.5)",
      }}>
        <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ color: C.gold, fontSize: 14 }}>Biography</div>
          <div style={{ color: C.textMuted, fontSize: 11, marginTop: 2 }}>
            Your intellectual life, written back to you
          </div>
        </div>

        <div style={{ display: "flex", borderBottom: `1px solid ${C.border}` }}>
          {["generate", "history"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: "8px 0",
              background: tab === t ? C.goldFaint : "none",
              border: "none", borderBottom: `2px solid ${tab === t ? C.gold : "transparent"}`,
              color: tab === t ? C.gold : C.textMuted,
              fontSize: 11, cursor: "pointer", fontFamily: "inherit",
              letterSpacing: "0.1em", textTransform: "capitalize",
              transition: "all 0.2s",
            }}>{t}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 16px" }}>
          {tab === "generate" ? (
            <GeneratePanel
              onGenerate={generate}
              generating={generating}
              sectionStatuses={sectionStatuses}
              status={status}
              readiness={readiness}
            />
          ) : (
            <div style={{ paddingTop: 8 }}>
              {histLoading ? (
                <div style={{ color: C.textMuted, fontSize: 12, padding: "20px 0", textAlign: "center" }}>Loading…</div>
              ) : history.length === 0 ? (
                <div style={{ color: C.textMuted, fontSize: 12, padding: "20px 0", textAlign: "center", fontStyle: "italic" }}>
                  No saved biographies yet.
                </div>
              ) : (
                history.map((bio, i) => (
                  <HistoryItem
                    key={i}
                    bio={bio}
                    onClick={() => { setTab("generate"); setStreamText(bio.text || ""); }}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Right — document ── */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {error && !generating && (
          <div style={{
            margin: "20px 40px",
            padding: "12px 16px",
            background: "rgba(192,57,43,0.08)",
            border: "1px solid rgba(192,57,43,0.3)",
            borderRadius: 4, color: "#e07070", fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {hasBiography ? (
          <div style={{ maxWidth: 720, margin: "0 auto", padding: isMobile ? "28px 20px" : "48px 52px" }}>

            {/* Document header */}
            <div style={{
              marginBottom: 40, paddingBottom: 24,
              borderBottom: `1px solid ${C.border}`,
              animation: "bd-fade 0.4s ease",
            }}>
              <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.16em", marginBottom: 8 }}>
                {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long" }).toUpperCase()}
              </div>
              <div style={{ fontSize: 28, color: C.text, fontStyle: "italic", lineHeight: 1.2 }}>
                An Intellectual Biography
              </div>
              <div style={{ color: C.goldMuted, fontSize: 14, marginTop: 6 }}>
                {user?.display_name || user?.email?.split("@")[0] || "The Thinker"}
              </div>
            </div>

            <StreamView text={streamText} isStreaming={generating} />

            {!generating && (
              <ExportBar
                fullText={streamText}
                onSave={saveCurrentBiography}
                saveStatus={saveStatus}
              />
            )}
          </div>
        ) : !generating && (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: "100%", padding: 40,
          }}>
            <div style={{ textAlign: "center", maxWidth: 420 }}>
              <div style={{ fontSize: 40, opacity: 0.15, marginBottom: 16 }}>≡</div>
              <div style={{ fontSize: 20, fontStyle: "italic", color: C.gold, marginBottom: 10 }}>
                Your biography will appear here
              </div>
              <div style={{ color: C.textMuted, fontSize: 13, lineHeight: 1.8 }}>
                Every great thinker kept a record of how they changed their mind.
                Montaigne had his essays. Darwin had his notebooks.
                Wittgenstein had his diaries.
                <br /><br />
                This is yours — written back to you.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { authFetch } from "../auth/Auth";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const C = {
  gold: "#c8a96e",
  goldFaint: "rgba(200,169,110,0.08)",
  goldMuted: "rgba(200,169,110,0.5)",
  text: "#e8dcc8",
  textMuted: "rgba(232,220,200,0.5)",
  border: "rgba(180,140,80,0.18)",
  surface: "rgba(22,20,15,0.98)",
};

const css = `
  @keyframes ex-fade { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
  @keyframes ex-spin { to { transform: rotate(360deg); } }
  .ex-card:hover { border-color: rgba(180,140,80,0.4) !important; background: rgba(26,24,18,0.98) !important; }
`;

function inject() {
  if (!document.getElementById("export-styles")) {
    const el = document.createElement("style");
    el.id = "export-styles"; el.textContent = css;
    document.head.appendChild(el);
  }
}

// ── Download helper ───────────────────────────────────────────────────────────
function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Export card ───────────────────────────────────────────────────────────────
function ExportCard({ icon, title, description, format, loading, onExport }) {
  return (
    <div className="ex-card" style={{
      padding: "24px 28px",
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 4,
      transition: "all 0.2s",
      animation: "ex-fade 0.4s ease",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 16 }}>
        <div style={{
          width: 44, height: 44, flexShrink: 0,
          border: `1px solid ${C.border}`,
          borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 20, color: C.gold,
        }}>{icon}</div>
        <div>
          <div style={{ color: C.gold, fontSize: 16, marginBottom: 4 }}>{title}</div>
          <div style={{ color: C.textMuted, fontSize: 13, lineHeight: 1.6 }}>{description}</div>
        </div>
      </div>
      <button
        onClick={onExport}
        disabled={loading}
        style={{
          padding: "10px 22px",
          background: loading ? "rgba(180,140,80,0.05)" : C.goldFaint,
          border: `1px solid ${loading ? "rgba(180,140,80,0.15)" : C.border}`,
          borderRadius: 3,
          color: loading ? C.goldMuted : C.gold,
          fontSize: 12, letterSpacing: "0.12em",
          textTransform: "uppercase",
          cursor: loading ? "not-allowed" : "pointer",
          fontFamily: "'EB Garamond', Georgia, serif",
          display: "flex", alignItems: "center", gap: 8,
          transition: "all 0.2s",
        }}
      >
        {loading && (
          <div style={{
            width: 12, height: 12,
            border: "1.5px solid rgba(200,169,110,0.3)",
            borderTopColor: C.gold,
            borderRadius: "50%",
            animation: "ex-spin 0.8s linear infinite",
          }} />
        )}
        {loading ? "Preparing..." : `Export ${format}`}
      </button>
    </div>
  );
}

// ── Export panel ──────────────────────────────────────────────────────────────
export default function Export() {
  inject();
  const [loadingFormat, setLoadingFormat] = useState(null);
  const [lastExport,    setLastExport]    = useState(null);
  const [error,         setError]         = useState(null);

  const now = () => new Date().toISOString().split("T")[0];

  async function doExport(format) {
    setLoadingFormat(format); setError(null);
    try {
      const res = await authFetch(`${API}/export?format=${format}`);
      if (!res.ok) throw new Error("Export failed");
      const data = await res.json();

      if (format === "json") {
        downloadBlob(
          JSON.stringify(data.content, null, 2),
          `thought-biography-${now()}.json`,
          "application/json"
        );
      } else if (format === "markdown") {
        downloadBlob(data.content, `thought-biography-${now()}.md`, "text/markdown");
      } else if (format === "graph") {
        downloadBlob(
          JSON.stringify(data.content, null, 2),
          `thought-graph-${now()}.json`,
          "application/json"
        );
      }

      setLastExport({ format, time: new Date().toLocaleTimeString(), size: data.size_hint });
    } catch {
      // Demo mode
      setError("Backend offline — connect the server to export your real data.");
      if (format === "markdown") {
        downloadBlob(DEMO_MARKDOWN, `thought-biography-demo-${now()}.md`, "text/markdown");
        setLastExport({ format, time: new Date().toLocaleTimeString(), size: "demo" });
      }
    } finally {
      setLoadingFormat(null);
    }
  }

  return (
    <div style={{
      padding: "36px 40px",
      fontFamily: "'EB Garamond', Georgia, serif",
      color: C.text,
      maxWidth: 780,
    }}>
      <div style={{ marginBottom: 36, animation: "ex-fade 0.3s ease" }}>
        <div style={{ color: C.gold, fontSize: 24, fontStyle: "italic", marginBottom: 6 }}>
          Export your record
        </div>
        <div style={{ color: C.textMuted, fontSize: 14, lineHeight: 1.7 }}>
          Your thought biography belongs to you entirely. Export it in any form you need —
          for archiving, migrating, or simply knowing that your intellectual history is portable.
        </div>
      </div>

      {error && (
        <div style={{
          marginBottom: 24, padding: "10px 16px",
          background: "rgba(180,60,60,0.08)", border: "1px solid rgba(180,60,60,0.2)",
          borderRadius: 3, color: "rgba(224,112,112,0.8)", fontSize: 13,
        }}>{error}</div>
      )}

      {lastExport && (
        <div style={{
          marginBottom: 24, padding: "10px 16px",
          background: "rgba(120,180,120,0.08)", border: "1px solid rgba(120,180,120,0.25)",
          borderRadius: 3, color: "#8aba8a", fontSize: 13,
          animation: "ex-fade 0.3s ease",
        }}>
          ✓ {lastExport.format.toUpperCase()} exported at {lastExport.time}
          {lastExport.size && ` · ${lastExport.size}`}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <ExportCard
          icon="{ }"
          title="Raw graph data"
          format="JSON"
          description="The complete graph in JSON format — all entries, concepts, relationships, and embeddings. Useful for migration, backup, or building your own tools on top."
          loading={loadingFormat === "json"}
          onExport={() => doExport("json")}
        />

        <ExportCard
          icon="≡"
          title="Reading copy"
          format="Markdown"
          description="All journal entries formatted as readable Markdown — date headers, concept tags, and emotional tones. Opens cleanly in Obsidian, Notion, or any text editor."
          loading={loadingFormat === "markdown"}
          onExport={() => doExport("markdown")}
        />

        <ExportCard
          icon="◉"
          title="Graph topology"
          format="Graph JSON"
          description="Nodes and edges only — no entry content. The pure relational structure of your thought graph, compatible with Gephi, Cytoscape, or any graph visualization tool."
          loading={loadingFormat === "graph"}
          onExport={() => doExport("graph")}
        />
      </div>

      <div style={{
        marginTop: 36, padding: "18px 22px",
        background: "rgba(180,140,80,0.04)",
        border: `1px solid ${C.border}`,
        borderRadius: 4,
        fontSize: 13, color: C.textMuted, lineHeight: 1.7,
      }}>
        <strong style={{ color: C.gold }}>Privacy note:</strong> Exports are generated fresh from your local graph and downloaded directly to your device. 
        Nothing is sent to external servers. If you are using end-to-end encryption, exported files will be decrypted — keep them secure.
      </div>
    </div>
  );
}

const DEMO_MARKDOWN = `# Thought Biography — Export
*Generated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}*

---

## March 15, 2024
**Tone:** searching | **Concepts:** Freedom, Belonging, Identity

I keep returning to the question of whether freedom is something you move toward or away from. 
The word carries so much weight when I write it now — heavier than it did five years ago, 
when I thought of it as simply the absence of obligation.

---

## January 22, 2024
**Tone:** resolved | **Concepts:** Ambition, Success, Work

Success used to mean being seen. Now I'm not sure it means anything I can point to. 
There's something relieving about that uncertainty, and something terrifying.

---

*This is a demo export. Connect the backend to export your real data.*
`;
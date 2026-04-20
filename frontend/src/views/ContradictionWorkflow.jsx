import { useState, useEffect, useRef } from "react";
import * as d3 from "d3";
import { authFetch } from "../auth/Auth";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const C = {
  bg: "#0f0e0b", gold: "#c8a96e", goldFaint: "rgba(200,169,110,0.10)",
  goldMuted: "rgba(200,169,110,0.5)", text: "#e8dcc8",
  textMuted: "rgba(232,220,200,0.5)", border: "rgba(180,140,80,0.18)",
  surface: "rgba(22,20,15,0.98)",
  high: "#c0392b", mid: "#c8a96e", low: "#27ae60",
};

const css = `
  @keyframes cw-fade { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
  .cw-row:hover { background: rgba(180,140,80,0.05) !important; cursor: pointer; }
`;

function injectStyles() {
  if (!document.getElementById("cw-styles")) {
    const el = document.createElement("style");
    el.id = "cw-styles"; el.textContent = css;
    document.head.appendChild(el);
  }
}

function tensionColor(score) {
  if (score >= 0.7) return C.high;
  if (score >= 0.4) return C.mid;
  return C.low;
}

function TensionBar({ score }) {
  const pct   = Math.round(score * 100);
  const color = tensionColor(score);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 4, background: "rgba(180,140,80,0.1)", borderRadius: 2 }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2, transition: "width 0.8s ease" }} />
      </div>
      <span style={{ color, fontSize: 11, width: 30, textAlign: "right" }}>{pct}%</span>
    </div>
  );
}

// ── Radial map using D3 ───────────────────────────────────────────────────────
function RadialMap({ pairs, selected, onSelect }) {
  const svgRef = useRef(null);

  useEffect(() => {
    if (!svgRef.current || !pairs.length) return;
    const W = 420, H = 420, cx = W / 2, cy = H / 2, R = 150;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${W} ${H}`);

    // Collect unique concept nodes
    const nodeSet = new Set(pairs.flatMap(p => [p.concept_a, p.concept_b]));
    const nodeArr = Array.from(nodeSet);
    const angle   = (i) => (i / nodeArr.length) * 2 * Math.PI - Math.PI / 2;
    const pos = (label) => {
      const i = nodeArr.indexOf(label);
      return { x: cx + R * Math.cos(angle(i)), y: cy + R * Math.sin(angle(i)) };
    };

    // Draw edges
    pairs.forEach(p => {
      const a = pos(p.concept_a), b = pos(p.concept_b);
      const color = tensionColor(p.tension_score);
      const isSelected = selected?.concept_a === p.concept_a && selected?.concept_b === p.concept_b;
      svg.append("line")
        .attr("x1", a.x).attr("y1", a.y)
        .attr("x2", b.x).attr("y2", b.y)
        .attr("stroke", color)
        .attr("stroke-width", isSelected ? 2 : 1)
        .attr("stroke-opacity", isSelected ? 0.9 : 0.35)
        .style("cursor", "pointer")
        .on("click", () => onSelect(p));
    });

    // Draw nodes
    nodeArr.forEach(label => {
      const { x, y } = pos(label);
      const isInSelected = selected && (selected.concept_a === label || selected.concept_b === label);

      const g = svg.append("g").style("cursor", "pointer");

      g.append("circle")
        .attr("cx", x).attr("cy", y).attr("r", isInSelected ? 8 : 6)
        .attr("fill", isInSelected ? C.gold : "rgba(200,169,110,0.3)")
        .attr("stroke", C.gold).attr("stroke-width", isInSelected ? 1.5 : 0.5)
        .attr("stroke-opacity", 0.6);

      const textAnchor = x < cx - 10 ? "end" : x > cx + 10 ? "start" : "middle";
      const dx = x < cx - 10 ? -12 : x > cx + 10 ? 12 : 0;
      const dy = y < cy - 10 ? -12 : 14;

      g.append("text")
        .text(label.length > 16 ? label.slice(0, 14) + "…" : label)
        .attr("x", x + dx).attr("y", y + dy)
        .attr("text-anchor", textAnchor)
        .attr("font-size", 11)
        .attr("font-family", "'EB Garamond', Georgia, serif")
        .attr("fill", isInSelected ? C.gold : C.goldMuted);
    });

  }, [pairs, selected]);

  return <svg ref={svgRef} style={{ width: "100%", maxWidth: 420 }} />;
}

// ── Detail panel ──────────────────────────────────────────────────────────────
function DetailPanel({ pair }) {
  if (!pair) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.textMuted, fontSize: 14, fontStyle: "italic" }}>
        Select a tension to examine it
      </div>
    );
  }

  return (
    <div style={{ flex: 1, padding: "28px 32px", animation: "cw-fade 0.3s ease" }}>
      <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.14em", marginBottom: 10 }}>ACTIVE TENSION</div>
      <div style={{ fontSize: 22, color: C.text, fontStyle: "italic", marginBottom: 6 }}>
        {pair.concept_a}
        <span style={{ color: C.goldMuted, fontSize: 14, margin: "0 10px" }}>⟷</span>
        {pair.concept_b}
      </div>
      <div style={{ marginBottom: 20 }}>
        <TensionBar score={pair.tension_score} />
      </div>

      {pair.evidence && (
        <div style={{
          padding: "14px 16px",
          background: C.goldFaint, border: `1px solid ${C.border}`,
          borderLeft: `3px solid ${tensionColor(pair.tension_score)}`,
          borderRadius: 3, marginBottom: 20,
        }}>
          <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.12em", marginBottom: 6 }}>WHY THIS IS A TENSION</div>
          <div style={{ color: C.text, fontSize: 14, lineHeight: 1.7, fontStyle: "italic" }}>
            {pair.evidence}
          </div>
        </div>
      )}

      {pair.detected_at && (
        <div style={{ color: C.textMuted, fontSize: 11 }}>
          Detected: {new Date(pair.detected_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        </div>
      )}

      <div style={{ marginTop: 24, padding: "14px 0", borderTop: `1px solid ${C.border}` }}>
        <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.7 }}>
          This tension does not need to be resolved — many productive thinkers hold genuine contradictions.
          The question is whether you are holding it <em style={{ color: C.text }}>consciously</em> or
          being pulled by it without knowing.
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ContradictionWorkflow({ user, onNavigate }) {
  injectStyles();

  const [pairs,   setPairs]   = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view,    setView]    = useState("map"); // map | list

  useEffect(() => {
    authFetch(`${API}/graph`)
      .then(r => r.json())
      .then(d => {
        // Extract contradiction pairs from full graph
        const contradictions = (d.edges || [])
          .filter(e => e.type === "CONTRADICTS")
          .map(e => ({
            concept_a:    e.source,
            concept_b:    e.target,
            tension_score: e.tension_score || e.weight || 0.5,
          }));
        setPairs(contradictions.length ? contradictions : MOCK_PAIRS);
      })
      .catch(() => setPairs(MOCK_PAIRS))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: C.goldMuted, fontSize: 14, fontFamily: "'EB Garamond',Georgia,serif" }}>Loading contradictions…</div>;
  }

  return (
    <div style={{ display: "flex", height: "100%", fontFamily: "'EB Garamond', Georgia, serif", color: C.text }}>

      {/* Left — map + list */}
      <div style={{
        width: 480, flexShrink: 0,
        borderRight: `1px solid ${C.border}`,
        display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <span style={{ color: C.gold, fontSize: 14 }}>Contradiction Map</span>
            <span style={{ color: C.textMuted, fontSize: 11, marginLeft: 10 }}>{pairs.length} active tensions</span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {["map","list"].map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: "3px 10px", background: view === v ? C.goldFaint : "none",
                border: `1px solid ${view === v ? C.gold : C.border}`,
                borderRadius: 10, color: view === v ? C.gold : C.textMuted,
                fontSize: 10, cursor: "pointer", fontFamily: "inherit",
                letterSpacing: "0.1em", textTransform: "uppercase",
              }}>{v}</button>
            ))}
          </div>
        </div>

        {view === "map" ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <RadialMap pairs={pairs} selected={selected} onSelect={setSelected} />
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: "auto" }}>
            {pairs
              .slice()
              .sort((a, b) => b.tension_score - a.tension_score)
              .map((p, i) => {
                const isSelected = selected?.concept_a === p.concept_a && selected?.concept_b === p.concept_b;
                return (
                  <div
                    key={i}
                    className="cw-row"
                    onClick={() => setSelected(isSelected ? null : p)}
                    style={{
                      padding: "14px 20px",
                      borderBottom: `1px solid ${C.border}`,
                      background: isSelected ? C.goldFaint : "transparent",
                      borderLeft: `3px solid ${isSelected ? C.gold : "transparent"}`,
                      transition: "all 0.15s",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <div style={{ fontSize: 13 }}>
                        <span style={{ color: C.gold }}>{p.concept_a}</span>
                        <span style={{ color: C.goldMuted, margin: "0 8px", fontSize: 11 }}>⟷</span>
                        <span style={{ color: C.gold }}>{p.concept_b}</span>
                      </div>
                    </div>
                    <TensionBar score={p.tension_score} />
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Right — detail */}
      <DetailPanel pair={selected} />
    </div>
  );
}

const MOCK_PAIRS = [
  { concept_a: "Freedom",    concept_b: "Commitment",  tension_score: 0.85, evidence: "You frame freedom as the absence of obligation, but your deepest commitments are the things you say give your life meaning. These framings cannot both be fully true.", detected_at: "2023-04-10" },
  { concept_a: "Ambition",   concept_b: "Contentment", tension_score: 0.72, evidence: "Ambition requires wanting more than you have. Contentment requires being satisfied with what you have. You have been writing about both as virtues without addressing the contradiction.", detected_at: "2023-06-22" },
  { concept_a: "Solitude",   concept_b: "Belonging",   tension_score: 0.60, evidence: "Your most productive thinking happens alone, but you describe loneliness as your most recurring difficulty.", detected_at: "2023-09-01" },
  { concept_a: "Discipline", concept_b: "Spontaneity", tension_score: 0.45, evidence: "You value systems and routines but frequently write about the loss of aliveness that comes with over-structuring your days.", detected_at: "2024-01-14" },
];
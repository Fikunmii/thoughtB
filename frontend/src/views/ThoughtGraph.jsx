import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import { authFetch } from "../auth/Auth";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const C = {
  bg: "#0f0e0b", gold: "#c8a96e", goldFaint: "rgba(200,169,110,0.10)",
  goldMuted: "rgba(200,169,110,0.45)", text: "#e8dcc8",
  textMuted: "rgba(232,220,200,0.5)", border: "rgba(180,140,80,0.18)",
  surface: "rgba(22,20,15,0.98)",
  reinforce: "#4a8c4a", contradict: "#a04040", evolve: "#c8a96e",
};

const css = `
  @keyframes tg-fade { from { opacity:0; } to { opacity:1; } }
  .tg-node { cursor: pointer; }
  .tg-node:hover circle { filter: brightness(1.3); }
  .tg-tooltip { pointer-events: none; position: absolute; z-index: 20; }
`;

function injectStyles() {
  if (typeof document !== "undefined" && !document.getElementById("tg-styles")) {
    const el = document.createElement("style");
    el.id = "tg-styles"; el.textContent = css;
    document.head.appendChild(el);
  }
}

// ── Concept panel ─────────────────────────────────────────────────────────────
function ConceptPanel({ concept, onClose, onNavigate }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    authFetch(`${API}/concepts/${encodeURIComponent(concept.label)}`)
      .then(r => r.json())
      .then(d => { setDetail(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [concept.label]);

  return (
    <div style={{
      position: "absolute", top: 20, right: 20,
      width: 300, maxHeight: "calc(100% - 40px)",
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 4, overflow: "auto",
      boxShadow: "0 4px 32px rgba(0,0,0,0.6)",
      animation: "tg-fade 0.25s ease",
    }}>
      {/* Header */}
      <div style={{
        padding: "14px 16px", borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "flex-start", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ color: C.gold, fontSize: 15 }}>{concept.label}</div>
          <div style={{ color: C.textMuted, fontSize: 11, marginTop: 3 }}>
            {concept.entry_count} entries
            {concept.stability_score !== undefined && (
              <span style={{ marginLeft: 8 }}>
                stability {Math.round(concept.stability_score * 100)}%
              </span>
            )}
          </div>
        </div>
        <button onClick={onClose} style={{
          background: "none", border: "none", color: C.textMuted,
          fontSize: 16, cursor: "pointer", padding: 0, lineHeight: 1,
        }}>×</button>
      </div>

      {loading ? (
        <div style={{ padding: 20, color: C.textMuted, fontSize: 12, textAlign: "center" }}>Loading…</div>
      ) : detail ? (
        <div style={{ padding: "14px 16px" }}>

          {/* First / last seen */}
          {detail.first_seen && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.12em", marginBottom: 4 }}>TIMELINE</div>
              <div style={{ color: C.textMuted, fontSize: 12 }}>
                First: {detail.first_seen?.slice(0,10)}
                {detail.last_seen && detail.last_seen !== detail.first_seen && (
                  <> &nbsp;·&nbsp; Last: {detail.last_seen?.slice(0,10)}</>
                )}
              </div>
            </div>
          )}

          {/* Connected concepts */}
          {detail.connected_concepts?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.12em", marginBottom: 6 }}>CONNECTIONS</div>
              {detail.connected_concepts.slice(0, 5).map((c, i) => {
                const color = c.relationship === "CONTRADICTS" ? "#a07070"
                            : c.relationship === "REINFORCES"  ? "#70a070" : C.gold;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span style={{ color, fontSize: 9, width: 6 }}>
                      {c.relationship === "CONTRADICTS" ? "⟷" : c.relationship === "REINFORCES" ? "↔" : "→"}
                    </span>
                    <span style={{ color: C.text, fontSize: 12 }}>{c.label}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Influences */}
          {detail.influences?.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.12em", marginBottom: 6 }}>INTRODUCED BY</div>
              {detail.influences.map((inf, i) => (
                <div key={i} style={{ color: C.textMuted, fontSize: 12, marginBottom: 3 }}>
                  {inf.name}
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
            <button onClick={() => onNavigate?.("drift")} style={{
              flex: 1, padding: "6px 0", background: C.goldFaint,
              border: `1px solid ${C.border}`, borderRadius: 3,
              color: C.gold, fontSize: 11, cursor: "pointer",
              fontFamily: "inherit", letterSpacing: "0.08em",
            }}>See drift →</button>
          </div>
        </div>
      ) : (
        <div style={{ padding: 20, color: C.textMuted, fontSize: 12 }}>Not found.</div>
      )}
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────
function Legend() {
  const items = [
    { color: C.reinforce, label: "Reinforces" },
    { color: C.contradict, label: "Contradicts" },
    { color: C.evolve,    label: "Evolved into" },
  ];
  return (
    <div style={{
      position: "absolute", bottom: 20, left: 20,
      background: "rgba(15,14,11,0.85)", border: `1px solid ${C.border}`,
      borderRadius: 4, padding: "10px 14px",
    }}>
      {items.map(({ color, label }) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, fontSize: 11 }}>
          <div style={{ width: 20, height: 2, background: color, opacity: 0.7 }} />
          <span style={{ color: C.textMuted }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ThoughtGraph({ user, onNavigate }) {
  injectStyles();

  const svgRef     = useRef(null);
  const containerRef = useRef(null);
  const [graphData,    setGraphData]    = useState(null);
  const [selected,     setSelected]     = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [stats,        setStats]        = useState({});
  const [filterType,   setFilterType]   = useState("all"); // all | contradicts | reinforces

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${API}/graph`);
      if (res.ok) {
        const d = await res.json();
        setGraphData(d);
        setStats(d.stats || { concepts: d.nodes?.length || 0, entries: 0, contradictions: 0 });
      }
    } catch (e) {
      // Use mock data for development
      setGraphData(MOCK_GRAPH);
      setStats({ concepts: 12, entries: 34, contradictions: 4 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Build D3 graph
  useEffect(() => {
    if (!graphData || !svgRef.current || !containerRef.current) return;

    const { width, height } = containerRef.current.getBoundingClientRect();
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // Filter edges
    let edges = graphData.edges || [];
    if (filterType !== "all") {
      edges = edges.filter(e => e.type.toLowerCase().includes(filterType));
    }

    // Visible nodes — only those connected by current edges
    const connectedIds = new Set(edges.flatMap(e => [e.source, e.target]));
    let nodes = (graphData.nodes || []).filter(n =>
      connectedIds.has(n.label) || filterType === "all"
    );
    if (nodes.length === 0) nodes = graphData.nodes || [];

    // Size scale — entry count drives node size
    const maxCount = Math.max(...nodes.map(n => n.entry_count || 1));
    const rScale = d3.scaleSqrt().domain([1, maxCount]).range([6, 22]);

    // Stability → color brightness
    const nodeColor = n => {
      const s = n.stability_score || 0;
      const base = [200, 169, 110];
      const fade = base.map(v => Math.round(v * (0.3 + s * 0.7)));
      return `rgb(${fade.join(",")})`;
    };

    // Edge color
    const edgeColor = type => {
      if (type === "CONTRADICTS") return C.contradict;
      if (type === "REINFORCES")  return C.reinforce;
      return C.evolve;
    };

    // Force simulation
    const sim = d3.forceSimulation(nodes)
      .force("link",   d3.forceLink(edges).id(d => d.label).distance(80).strength(0.3))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide(d => rScale(d.entry_count || 1) + 8));

    const g = svg.append("g");

    // Zoom
    svg.call(d3.zoom().scaleExtent([0.3, 3]).on("zoom", e => g.attr("transform", e.transform)));

    // Arrowhead marker
    const defs = svg.append("defs");
    ["reinforce", "contradict", "evolve"].forEach(t => {
      const color = t === "reinforce" ? C.reinforce : t === "contradict" ? C.contradict : C.evolve;
      defs.append("marker")
        .attr("id", `arrow-${t}`)
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 18).attr("refY", 0)
        .attr("markerWidth", 6).attr("markerHeight", 6)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .attr("fill", color).attr("opacity", 0.6);
    });

    // Draw edges
    const link = g.append("g").selectAll("line")
      .data(edges).enter().append("line")
      .attr("stroke", d => edgeColor(d.type))
      .attr("stroke-width", d => Math.sqrt((d.weight || 1)) * 0.8)
      .attr("stroke-opacity", 0.4)
      .attr("marker-end", d => {
        const t = d.type === "CONTRADICTS" ? "contradict" : d.type === "REINFORCES" ? "reinforce" : "evolve";
        return `url(#arrow-${t})`;
      });

    // Draw node groups
    const node = g.append("g").selectAll(".tg-node")
      .data(nodes).enter().append("g")
      .attr("class", "tg-node")
      .call(d3.drag()
        .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag",  (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on("end",   (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
      )
      .on("click", (e, d) => { e.stopPropagation(); setSelected(d); });

    node.append("circle")
      .attr("r", d => rScale(d.entry_count || 1))
      .attr("fill", d => nodeColor(d))
      .attr("fill-opacity", 0.85)
      .attr("stroke", C.gold)
      .attr("stroke-width", 0.5)
      .attr("stroke-opacity", 0.3);

    node.append("text")
      .text(d => d.label.length > 18 ? d.label.slice(0, 16) + "…" : d.label)
      .attr("font-size", d => Math.max(9, Math.min(13, rScale(d.entry_count || 1) * 0.7)))
      .attr("text-anchor", "middle")
      .attr("dy", d => rScale(d.entry_count || 1) + 13)
      .attr("fill", C.goldMuted)
      .attr("font-family", "'EB Garamond', Georgia, serif")
      .style("pointer-events", "none");

    // Simulation tick
    sim.on("tick", () => {
      link
        .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
      node.attr("transform", d => `translate(${d.x},${d.y})`);
    });

    // Click background to deselect
    svg.on("click", () => setSelected(null));

    return () => sim.stop();
  }, [graphData, filterType]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: C.goldMuted, fontSize: 14, fontFamily: "'EB Garamond', Georgia, serif" }}>
        Loading your graph…
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%", background: C.bg, fontFamily: "'EB Garamond', Georgia, serif" }}>

      {/* Stats bar */}
      <div style={{
        position: "absolute", top: 20, left: 20,
        display: "flex", gap: 20, zIndex: 10,
      }}>
        {[
          { label: "Concepts", value: stats.concepts || 0 },
          { label: "Entries",  value: stats.entries  || 0 },
          { label: "Tensions", value: stats.contradictions || 0 },
        ].map(({ label, value }) => (
          <div key={label} style={{ textAlign: "center" }}>
            <div style={{ color: C.gold, fontSize: 22, fontStyle: "italic", lineHeight: 1 }}>{value}</div>
            <div style={{ color: C.textMuted, fontSize: 10, letterSpacing: "0.1em", marginTop: 2 }}>{label.toUpperCase()}</div>
          </div>
        ))}
      </div>

      {/* Filter buttons */}
      <div style={{
        position: "absolute", top: 20, left: "50%", transform: "translateX(-50%)",
        display: "flex", gap: 6, zIndex: 10,
      }}>
        {[
          { id: "all",         label: "All" },
          { id: "contradict",  label: "Tensions" },
          { id: "reinforce",   label: "Reinforcing" },
        ].map(f => (
          <button
            key={f.id}
            onClick={() => setFilterType(f.id)}
            style={{
              padding: "5px 14px", background: filterType === f.id ? C.goldFaint : "rgba(15,14,11,0.8)",
              border: `1px solid ${filterType === f.id ? C.gold : C.border}`,
              borderRadius: 12, color: filterType === f.id ? C.gold : C.textMuted,
              fontSize: 11, cursor: "pointer", fontFamily: "inherit",
              letterSpacing: "0.08em", transition: "all 0.2s",
            }}
          >{f.label}</button>
        ))}
      </div>

      {/* SVG canvas */}
      <svg ref={svgRef} width="100%" height="100%" style={{ display: "block" }} />

      <Legend />

      {/* Concept panel */}
      {selected && (
        <ConceptPanel
          concept={selected}
          onClose={() => setSelected(null)}
          onNavigate={onNavigate}
        />
      )}

      {/* Empty state */}
      {(!graphData?.nodes || graphData.nodes.length === 0) && (
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%,-50%)",
          textAlign: "center", color: C.textMuted,
        }}>
          <div style={{ fontSize: 32, opacity: 0.3, marginBottom: 12 }}>◉</div>
          <div style={{ fontSize: 16, fontStyle: "italic" }}>Your graph will appear here</div>
          <div style={{ fontSize: 12, marginTop: 6 }}>Write your first journal entry to begin mapping your thinking.</div>
        </div>
      )}
    </div>
  );
}

// ── Mock data ─────────────────────────────────────────────────────────────────
const MOCK_GRAPH = {
  nodes: [
    { label: "Freedom",     entry_count: 12, stability_score: 0.52, first_seen: "2021-01-10" },
    { label: "Discipline",  entry_count: 9,  stability_score: 0.71, first_seen: "2021-02-03" },
    { label: "Commitment",  entry_count: 8,  stability_score: 0.68, first_seen: "2021-03-15" },
    { label: "Ambition",    entry_count: 7,  stability_score: 0.45, first_seen: "2021-04-20" },
    { label: "Contentment", entry_count: 5,  stability_score: 0.80, first_seen: "2022-01-08" },
    { label: "Belonging",   entry_count: 6,  stability_score: 0.63, first_seen: "2022-02-14" },
    { label: "Solitude",    entry_count: 4,  stability_score: 0.77, first_seen: "2022-05-09" },
    { label: "Risk",        entry_count: 6,  stability_score: 0.41, first_seen: "2022-07-22" },
  ],
  edges: [
    { source: "Freedom",    target: "Commitment",  type: "CONTRADICTS",  weight: 0.85 },
    { source: "Ambition",   target: "Contentment", type: "CONTRADICTS",  weight: 0.72 },
    { source: "Freedom",    target: "Belonging",   type: "CONTRADICTS",  weight: 0.58 },
    { source: "Discipline", target: "Freedom",     type: "REINFORCES",   weight: 0.45 },
    { source: "Solitude",   target: "Belonging",   type: "CONTRADICTS",  weight: 0.60 },
    { source: "Ambition",   target: "Risk",        type: "REINFORCES",   weight: 0.70 },
    { source: "Discipline", target: "Commitment",  type: "REINFORCES",   weight: 0.80 },
  ],
};
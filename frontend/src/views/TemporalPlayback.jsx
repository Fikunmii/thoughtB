import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import { authFetch } from "../auth/Auth";
import { GraphSkeleton } from "../components/ErrorBoundary";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const C = {
  gold: "#c8a96e", goldFaint: "rgba(200,169,110,0.1)", goldMuted: "rgba(200,169,110,0.5)",
  text: "#e8dcc8", textMuted: "rgba(232,220,200,0.5)",
  border: "rgba(180,140,80,0.18)", surface: "rgba(22,20,15,0.98)",
  nodeTypes: { Concept: "#c8a96e", Person: "#c8908a", Source: "#8ab8d0", LifeContext: "#90c890" },
  edgeTypes: { REINFORCES: "rgba(120,180,120,0.5)", CONTRADICTS: "rgba(180,100,100,0.5)", EVOLVED_INTO: "rgba(200,169,110,0.5)", INTRODUCED: "rgba(138,184,208,0.5)" },
};

const css = `
  @keyframes tp-fade { from { opacity:0 } to { opacity:1 } }
  @keyframes tp-pulse { 0%,100%{opacity:0.5} 50%{opacity:1} }
  .tp-scrubber::-webkit-slider-thumb {
    -webkit-appearance: none; width: 18px; height: 18px;
    background: #c8a96e; border-radius: 50%; cursor: pointer;
    box-shadow: 0 0 8px rgba(200,169,110,0.5);
  }
  .tp-scrubber { -webkit-appearance: none; height: 3px; outline: none; border-radius: 2px; }
`;

function inject() {
  if (!document.getElementById("tp-styles")) {
    const el = document.createElement("style"); el.id = "tp-styles"; el.textContent = css;
    document.head.appendChild(el);
  }
}

export default function TemporalPlayback() {
  useEffect(() => { inject(); }, []);
  const svgRef        = useRef(null);
  const simRef        = useRef(null);
  const [allData,     setAllData]     = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [sliderVal,   setSliderVal]   = useState(100);  // 0–100 pct of timeline
  const [currentDate, setCurrentDate] = useState(null);
  const [playing,     setPlaying]     = useState(false);
  const [speed,       setSpeed]       = useState(1);    // 1x, 2x, 5x
  const playRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch(`${API}/temporal-data`);
        if (!res.ok) throw new Error();
        setAllData(await res.json());
      } catch {
        setAllData(MOCK_DATA);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Compute graph snapshot at a given slider percentage ─────────────────────
  const getSnapshot = useCallback((pct) => {
    if (!allData) return { nodes: [], edges: [] };
    const sorted = [...allData.all_dates].sort();
    const idx    = Math.max(0, Math.min(sorted.length - 1, Math.floor(pct / 100 * (sorted.length - 1))));
    const cutoff = sorted[idx];
    // setCurrentDate handled by drawGraph

    const activeNodes = allData.nodes.filter(n => n.first_seen <= cutoff);
    const activeNodeIds = new Set(activeNodes.map(n => n.id));
    const activeEdges   = allData.edges.filter(e =>
      e.first_observed <= cutoff && activeNodeIds.has(e.source) && activeNodeIds.has(e.target)
    );
    return { nodes: activeNodes, edges: activeEdges };
  }, [allData]);

  // ── Draw graph ───────────────────────────────────────────────────────────────
  const drawGraph = useCallback((pct) => {
    const el = svgRef.current;
    if (!el || !allData) return;
    const { nodes, edges } = getSnapshot(pct);

    const W = el.clientWidth  || 800;
    const H = el.clientHeight || 500;

    d3.select(el).selectAll("*").remove();
    const svg = d3.select(el).attr("width", W).attr("height", H);
    svg.append("defs").append("style").text(css);

    const g = svg.append("g");
    d3.select(el).call(
      d3.zoom().scaleExtent([0.2, 4]).on("zoom", e => g.attr("transform", e.transform))
    );

    if (nodes.length === 0) {
      svg.append("text")
        .attr("x", W / 2).attr("y", H / 2)
        .attr("text-anchor", "middle")
        .attr("fill", "rgba(200,169,110,0.4)")
        .attr("font-family", "'EB Garamond', Georgia, serif")
        .attr("font-size", 14)
        .text("No concepts existed yet at this point in time");
      return;
    }

    if (simRef.current) simRef.current.stop();

    const sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(edges).id(d => d.id).distance(90).strength(0.4))
      .force("charge", d3.forceManyBody().strength(-120))
      .force("center", d3.forceCenter(W / 2, H / 2))
      .force("collide", d3.forceCollide(30));

    simRef.current = sim;

    const link = g.append("g").selectAll("line")
      .data(edges).join("line")
      .attr("stroke", d => C.edgeTypes[d.type] || "rgba(180,140,80,0.3)")
      .attr("stroke-width", d => d.type === "CONTRADICTS" ? 2 : 1.2)
      .attr("stroke-dasharray", d => d.type === "EVOLVED_INTO" ? "6,3" : "none");

    const nodeG = g.append("g").selectAll("g")
      .data(nodes).join("g")
      .call(d3.drag()
        .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on("drag",  (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on("end",   (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
      );

    nodeG.append("circle")
      .attr("r", d => d.type === "Concept" ? 6 + (d.frequency || 1) * 2 : 8)
      .attr("fill", d => `${C.nodeTypes[d.type] || C.gold}33`)
      .attr("stroke", d => C.nodeTypes[d.type] || C.gold)
      .attr("stroke-width", 1.5);

    nodeG.append("text")
      .attr("dy", -12).attr("text-anchor", "middle")
      .attr("fill", d => C.nodeTypes[d.type] || C.gold)
      .attr("font-size", 11)
      .attr("font-family", "'EB Garamond', Georgia, serif")
      .text(d => d.label || d.name);

    sim.on("tick", () => {
      link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
          .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
      nodeG.attr("transform", d => `translate(${d.x},${d.y})`);
    });
  }, [allData, getSnapshot]);

  useEffect(() => { if (allData) drawGraph(sliderVal); }, [allData, sliderVal, drawGraph]);

  // ── Playback ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (playing) {
      playRef.current = setInterval(() => {
        setSliderVal(v => {
          if (v >= 100) { setPlaying(false); return 100; }
          return Math.min(100, v + speed * 0.5);
        });
      }, 50);
    } else {
      clearInterval(playRef.current);
    }
    return () => clearInterval(playRef.current);
  }, [playing, speed]);

  if (loading) return <GraphSkeleton />;

  const totalNodes = allData?.nodes?.length || 0;
  const snapshot = { nodes: [], edges: [] };

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      fontFamily: "'EB Garamond', Georgia, serif", color: C.text,
    }}>
      {/* Graph area */}
      <div style={{ flex: 1, position: "relative" }}>
        <svg ref={svgRef} style={{ width: "100%", height: "100%", display: "block" }} />

        {/* Overlay stats */}
        <div style={{
          position: "absolute", top: 20, left: 20,
          padding: "10px 16px",
          background: "rgba(10,9,7,0.85)",
          border: `1px solid ${C.border}`,
          borderRadius: 3,
          animation: "tp-fade 0.3s ease",
        }}>
          <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.12em", marginBottom: 4, textTransform: "uppercase" }}>
            Snapshot
          </div>
          {currentDate && (
            <div style={{ color: C.gold, fontSize: 14 }}>
              {new Date(currentDate).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </div>
          )}
          <div style={{ color: C.textMuted, fontSize: 12, marginTop: 4 }}>
            {snapshot.nodes.length} of {totalNodes} concepts · {snapshot.edges.length} connections
          </div>
        </div>

        {/* Legend */}
        <div style={{
          position: "absolute", top: 20, right: 20,
          padding: "10px 14px",
          background: "rgba(10,9,7,0.85)",
          border: `1px solid ${C.border}`,
          borderRadius: 3,
        }}>
          {Object.entries(C.edgeTypes).map(([k, v]) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <div style={{ width: 20, height: 2, background: v, borderRadius: 1 }} />
              <span style={{ color: C.textMuted, fontSize: 10, textTransform: "capitalize" }}>
                {k.toLowerCase().replace(/_/g, " ")}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Scrubber bar */}
      <div style={{
        padding: "20px 32px 24px",
        background: C.surface,
        borderTop: `1px solid ${C.border}`,
      }}>
        {/* Timeline markers */}
        {allData?.all_dates && (
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            {[0, 25, 50, 75, 100].map(pct => {
              const sorted = [...allData.all_dates].sort();
              const idx    = Math.floor(pct / 100 * (sorted.length - 1));
              const date   = sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
              return (
                <div key={pct} style={{ color: C.textMuted, fontSize: 10 }}>
                  {date ? new Date(date).getFullYear() : ""}
                </div>
              );
            })}
          </div>
        )}

        {/* Slider */}
        <input
          type="range" min={0} max={100} value={sliderVal}
          onChange={e => { setSliderVal(+e.target.value); setPlaying(false); }}
          className="tp-scrubber"
          style={{
            width: "100%", marginBottom: 16,
            background: `linear-gradient(to right, rgba(200,169,110,0.6) ${sliderVal}%, rgba(180,140,80,0.15) ${sliderVal}%)`,
            cursor: "pointer",
          }}
        />

        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setSliderVal(0)} title="Rewind" style={btnStyle}>⏮</button>
          <button onClick={() => setPlaying(p => !p)} title={playing ? "Pause" : "Play"} style={{
            ...btnStyle, background: playing ? "rgba(200,169,110,0.15)" : "rgba(180,140,80,0.08)",
            border: `1px solid ${playing ? "rgba(200,169,110,0.4)" : C.border}`,
            color: playing ? C.gold : C.goldMuted,
          }}>
            {playing ? "⏸" : "▶"}
          </button>
          <button onClick={() => setSliderVal(100)} title="Jump to now" style={btnStyle}>⏭</button>

          <div style={{ display: "flex", gap: 4, marginLeft: 8 }}>
            {[1, 2, 5].map(s => (
              <button key={s} onClick={() => setSpeed(s)} style={{
                padding: "5px 10px",
                background: speed === s ? "rgba(200,169,110,0.12)" : "none",
                border: `1px solid ${speed === s ? C.border : "transparent"}`,
                borderRadius: 3,
                color: speed === s ? C.gold : C.textMuted,
                fontSize: 11, cursor: "pointer",
                fontFamily: "inherit",
              }}>{s}×</button>
            ))}
          </div>

          <div style={{ flex: 1 }} />
          <div style={{ color: C.textMuted, fontSize: 12, fontStyle: "italic" }}>
            Drag the scrubber to travel through your intellectual history
          </div>
        </div>
      </div>
    </div>
  );
}

const btnStyle = {
  padding: "8px 14px", background: "none",
  border: `1px solid rgba(180,140,80,0.2)`,
  borderRadius: 3, color: "rgba(200,169,110,0.6)",
  fontSize: 14, cursor: "pointer", fontFamily: "'EB Garamond', Georgia, serif",
  transition: "all 0.15s",
};

// ── Mock ───────────────────────────────────────────────────────────────────────
const MOCK_DATA = (() => {
  const nodes = [
    { id: "c1", label: "Freedom",     type: "Concept", frequency: 12, first_seen: "2018-09-01" },
    { id: "c2", label: "Ambition",    type: "Concept", frequency: 8,  first_seen: "2019-01-15" },
    { id: "c3", label: "Meaning",     type: "Concept", frequency: 10, first_seen: "2019-04-01" },
    { id: "c4", label: "Belonging",   type: "Concept", frequency: 7,  first_seen: "2020-02-10" },
    { id: "c5", label: "Justice",     type: "Concept", frequency: 6,  first_seen: "2020-09-01" },
    { id: "c6", label: "Identity",    type: "Concept", frequency: 9,  first_seen: "2021-01-01" },
    { id: "c7", label: "Solitude",    type: "Concept", frequency: 5,  first_seen: "2021-06-15" },
    { id: "c8", label: "Discipline",  type: "Concept", frequency: 7,  first_seen: "2022-01-01" },
    { id: "c9", label: "Contentment", type: "Concept", frequency: 4,  first_seen: "2022-08-01" },
    { id: "p1", label: "Viktor Frankl", type: "Person", first_seen: "2019-04-01" },
    { id: "s1", label: "Man's Search for Meaning", type: "Source", first_seen: "2019-04-01" },
    { id: "l1", label: "Graduate School", type: "LifeContext", first_seen: "2018-09-01" },
  ];
  const edges = [
    { source: "c1", target: "c4", type: "CONTRADICTS",  first_observed: "2020-03-01" },
    { source: "c2", target: "c9", type: "CONTRADICTS",  first_observed: "2022-10-01" },
    { source: "c3", target: "c2", type: "REINFORCES",   first_observed: "2019-06-01" },
    { source: "c1", target: "c3", type: "REINFORCES",   first_observed: "2019-05-01" },
    { source: "c6", target: "c1", type: "REINFORCES",   first_observed: "2021-02-01" },
    { source: "p1", target: "c3", type: "INTRODUCED",   first_observed: "2019-04-01" },
    { source: "s1", target: "c3", type: "INTRODUCED",   first_observed: "2019-04-01" },
    { source: "c2", target: "c8", type: "EVOLVED_INTO", first_observed: "2022-03-01" },
    { source: "c7", target: "c6", type: "REINFORCES",   first_observed: "2021-07-01" },
  ];
  const all_dates = [...new Set([...nodes.map(n => n.first_seen), ...edges.map(e => e.first_observed)])].sort();
  return { nodes, edges, all_dates };
})();


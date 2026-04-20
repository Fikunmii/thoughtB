import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { authFetch } from "../auth/Auth";
import { GraphSkeleton, EmptyState } from "../components/ErrorBoundary";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const C = {
  gold: "#c8a96e",
  goldFaint: "rgba(200,169,110,0.1)",
  goldMuted: "rgba(200,169,110,0.5)",
  text: "#e8dcc8",
  textMuted: "rgba(232,220,200,0.5)",
  border: "rgba(180,140,80,0.18)",
  surface: "rgba(22,20,15,0.98)",
  typeColors: {
    author:     "#c8a96e",
    book:       "#8ab8d0",
    mentor:     "#c8908a",
    peer:       "#90c890",
    historical: "#b8a0d0",
    article:    "#d0b880",
    podcast:    "#a0c8b8",
    conversation: "#c8b0a0",
  },
};

const css = `
  @keyframes inf-fade { from { opacity:0 } to { opacity:1 } }
  .inf-node { cursor: pointer; transition: opacity 0.2s; }
  .inf-node:hover circle { filter: brightness(1.4); }
  .inf-link { transition: opacity 0.2s; }
`;

export default function InfluenceTrees() {
  const svgRef  = useRef(null);
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [sortBy, setSortBy]   = useState("impact"); // impact | recency | depth

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch(`${API}/influence-trees`);
        if (!res.ok) throw new Error();
        setData(await res.json());
      } catch {
        setData(MOCK_DATA);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!data || !svgRef.current) return;

    const el = svgRef.current;
    d3.select(el).selectAll("*").remove();

    const W = el.clientWidth  || 900;
    const H = el.clientHeight || 600;
    const cx = W / 2, cy = H / 2;

    // Build hierarchy: root → influence → catalyzed concepts
    const sorted = [...data.influences].sort((a, b) => {
      if (sortBy === "impact")  return b.impact_score - a.impact_score;
      if (sortBy === "recency") return new Date(b.first_mentioned) - new Date(a.first_mentioned);
      return b.concepts.length - a.concepts.length;
    });

    const hierarchyData = {
      id: "root", label: "You", type: "root",
      children: sorted.map(inf => ({
        ...inf,
        children: inf.concepts.map(c => ({ id: c.id, label: c.label, type: "concept", weight: c.weight })),
      })),
    };

    const root = d3.hierarchy(hierarchyData);
    const radius = Math.min(W, H) / 2 - 80;

    const treeLayout = d3.tree()
      .size([2 * Math.PI, radius])
      .separation((a, b) => (a.parent === b.parent ? 1 : 2) / a.depth);

    treeLayout(root);

    const svg = d3.select(el)
      .attr("width", W).attr("height", H)
      .append("g")
      .attr("transform", `translate(${cx},${cy})`);

    // ── Inject styles
    const defs = svg.append("defs");
    defs.append("style").text(css);

    // ── Zoom
    d3.select(el).call(
      d3.zoom().scaleExtent([0.3, 3]).on("zoom", e => svg.attr("transform", `translate(${cx + e.transform.x}, ${cy + e.transform.y}) scale(${e.transform.k})`))
    );

    // ── Links
    svg.append("g").attr("class", "links")
      .selectAll("path")
      .data(root.links())
      .join("path")
      .attr("class", "inf-link")
      .attr("d", d3.linkRadial().angle(d => d.x).radius(d => d.y))
      .attr("fill", "none")
      .attr("stroke", d => {
        if (d.target.data.type === "concept") return "rgba(200,169,110,0.2)";
        return "rgba(180,140,80,0.35)";
      })
      .attr("stroke-width", d => d.target.data.type === "concept" ? 1 : 1.5)
      .attr("stroke-dasharray", d => d.target.data.type === "concept" ? "3,3" : "none");

    // ── Nodes
    const node = svg.append("g").attr("class", "nodes")
      .selectAll("g")
      .data(root.descendants())
      .join("g")
      .attr("class", "inf-node")
      .attr("transform", d => {
        if (d.depth === 0) return "";
        return `rotate(${(d.x * 180 / Math.PI - 90)}) translate(${d.y},0)`;
      })
      .on("click", (event, d) => {
        event.stopPropagation();
        if (d.depth === 0) return;
        setSelected(d.data);
      });

    // Root node
    node.filter(d => d.depth === 0)
      .append("circle")
      .attr("r", 20)
      .attr("fill", "rgba(180,140,80,0.2)")
      .attr("stroke", C.gold)
      .attr("stroke-width", 2);

    node.filter(d => d.depth === 0)
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("fill", C.gold)
      .attr("font-size", 11)
      .attr("font-family", "'EB Garamond', Georgia, serif")
      .text("You");

    // Influence nodes (depth 1)
    const infNode = node.filter(d => d.depth === 1);

    infNode.append("circle")
      .attr("r", d => 6 + Math.min(d.data.impact_score * 14, 16))
      .attr("fill", d => `${C.typeColors[d.data.type] || C.gold}33`)
      .attr("stroke", d => C.typeColors[d.data.type] || C.gold)
      .attr("stroke-width", 1.5);

    infNode.append("text")
      .attr("dy", "0.35em")
      .attr("x", d => d.x < Math.PI ? 12 + Math.min(d.data.impact_score * 14, 16) : -(12 + Math.min(d.data.impact_score * 14, 16)))
      .attr("text-anchor", d => d.x < Math.PI ? "start" : "end")
      .attr("fill", d => C.typeColors[d.data.type] || C.gold)
      .attr("font-size", 12)
      .attr("font-family", "'EB Garamond', Georgia, serif")
      .attr("transform", d => d.x >= Math.PI ? "rotate(180)" : "")
      .text(d => d.data.name || d.data.title);

    // Concept nodes (depth 2)
    const conceptNode = node.filter(d => d.depth === 2);

    conceptNode.append("circle")
      .attr("r", 4)
      .attr("fill", "rgba(200,169,110,0.4)")
      .attr("stroke", "rgba(200,169,110,0.7)")
      .attr("stroke-width", 1);

    conceptNode.append("text")
      .attr("dy", "0.35em")
      .attr("x", d => d.x < Math.PI ? 8 : -8)
      .attr("text-anchor", d => d.x < Math.PI ? "start" : "end")
      .attr("fill", C.textMuted)
      .attr("font-size", 10)
      .attr("font-family", "'EB Garamond', Georgia, serif")
      .attr("transform", d => d.x >= Math.PI ? "rotate(180)" : "")
      .text(d => d.data.label);

  }, [data, sortBy]);

  if (loading) return <GraphSkeleton />;

  return (
    <div style={{
      display: "flex", height: "100%",
      fontFamily: "'EB Garamond', Georgia, serif",
      color: C.text, position: "relative",
    }}>
      {/* Controls */}
      <div style={{
        width: 220, flexShrink: 0,
        padding: "24px 20px",
        borderRight: `1px solid ${C.border}`,
        display: "flex", flexDirection: "column", gap: 20,
        background: C.surface,
      }}>
        <div>
          <div style={{ color: C.gold, fontSize: 16, fontStyle: "italic", marginBottom: 4 }}>
            Influence Trees
          </div>
          <div style={{ color: C.textMuted, fontSize: 12, lineHeight: 1.6 }}>
            Which people, books, and sources planted the ideas that grew into your core beliefs?
          </div>
        </div>

        <div>
          <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.14em", marginBottom: 8, textTransform: "uppercase" }}>Sort by</div>
          {[["impact", "Impact"], ["depth", "Concept depth"], ["recency", "Most recent"]].map(([k, l]) => (
            <button key={k} onClick={() => setSortBy(k)} style={{
              display: "block", width: "100%",
              padding: "8px 12px", marginBottom: 4,
              background: sortBy === k ? C.goldFaint : "none",
              border: `1px solid ${sortBy === k ? "rgba(180,140,80,0.4)" : "transparent"}`,
              borderRadius: 3,
              color: sortBy === k ? C.gold : C.textMuted,
              fontSize: 12, textAlign: "left",
              cursor: "pointer", fontFamily: "inherit",
              transition: "all 0.15s",
            }}>{l}</button>
          ))}
        </div>

        {/* Legend */}
        <div>
          <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.14em", marginBottom: 10, textTransform: "uppercase" }}>Type</div>
          {Object.entries(C.typeColors).map(([type, color]) => (
            <div key={type} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: `${color}66`, border: `1.5px solid ${color}` }} />
              <span style={{ color: C.textMuted, fontSize: 11, textTransform: "capitalize" }}>{type}</span>
            </div>
          ))}
        </div>

        {data && (
          <div style={{
            padding: "12px 14px",
            background: "rgba(180,140,80,0.04)",
            border: `1px solid ${C.border}`,
            borderRadius: 3,
          }}>
            <div style={{ color: C.gold, fontSize: 22, fontStyle: "italic" }}>{data.influences?.length}</div>
            <div style={{ color: C.textMuted, fontSize: 11, marginTop: 2 }}>Total influences</div>
            <div style={{ color: C.gold, fontSize: 22, fontStyle: "italic", marginTop: 10 }}>
              {data.influences?.reduce((s, i) => s + i.concepts.length, 0)}
            </div>
            <div style={{ color: C.textMuted, fontSize: 11, marginTop: 2 }}>Concepts catalyzed</div>
          </div>
        )}
      </div>

      {/* Graph */}
      <div style={{ flex: 1, position: "relative" }}>
        <svg ref={svgRef} style={{ width: "100%", height: "100%", display: "block" }} />

        {(!data?.influences?.length) && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <EmptyState icon="→"
              title="No influences mapped yet"
              subtitle="Mention books, people, and sources in your entries. They'll appear here as your graph grows." />
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <div style={{
          position: "absolute", right: 20, top: 20,
          width: 300, padding: 22,
          background: "rgba(12,11,9,0.97)",
          border: `1px solid ${C.border}`,
          borderRadius: 4,
          animation: "inf-fade 0.25s ease",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <div style={{ color: C.gold, fontSize: 16 }}>{selected.name || selected.label}</div>
              {selected.type && (
                <div style={{ color: C.typeColors[selected.type] || C.goldMuted, fontSize: 11, textTransform: "capitalize", marginTop: 2 }}>
                  {selected.type}
                </div>
              )}
            </div>
            <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: C.goldMuted, cursor: "pointer", fontSize: 18 }}>×</button>
          </div>

          {selected.impact_score != null && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.12em", marginBottom: 6, textTransform: "uppercase" }}>Impact score</div>
              <div style={{ width: "100%", height: 4, background: "rgba(180,140,80,0.12)", borderRadius: 2 }}>
                <div style={{ height: "100%", width: `${selected.impact_score * 100}%`, background: C.gold, borderRadius: 2 }} />
              </div>
              <div style={{ color: C.textMuted, fontSize: 11, marginTop: 4 }}>{Math.round(selected.impact_score * 100)}% influence weight</div>
            </div>
          )}

          {selected.concepts?.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.12em", marginBottom: 8, textTransform: "uppercase" }}>
                Catalyzed {selected.concepts.length} concept{selected.concepts.length !== 1 ? "s" : ""}
              </div>
              {selected.concepts.map(c => (
                <div key={c.id || c.label} style={{
                  padding: "6px 10px", marginBottom: 4,
                  background: "rgba(180,140,80,0.06)",
                  border: `1px solid ${C.border}`,
                  borderRadius: 3,
                  color: C.text, fontSize: 12,
                }}>{c.label}</div>
              ))}
            </div>
          )}

          {selected.first_mentioned && (
            <div style={{ color: C.textMuted, fontSize: 11 }}>
              First mentioned {new Date(selected.first_mentioned).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Mock ──────────────────────────────────────────────────────────────────────
const MOCK_DATA = {
  influences: [
    { id: "1", name: "Viktor Frankl",          type: "author",    impact_score: 0.92, first_mentioned: "2019-03-01",
      concepts: [{ id: "c1", label: "Meaning" }, { id: "c2", label: "Suffering" }, { id: "c3", label: "Freedom" }, { id: "c4", label: "Responsibility" }] },
    { id: "2", name: "Man's Search for Meaning", type: "book",    impact_score: 0.88, first_mentioned: "2019-03-01",
      concepts: [{ id: "c5", label: "Purpose" }, { id: "c6", label: "Resilience" }, { id: "c7", label: "Hope" }] },
    { id: "3", name: "Hannah Arendt",           type: "historical", impact_score: 0.75, first_mentioned: "2020-09-10",
      concepts: [{ id: "c8", label: "Justice" }, { id: "c9", label: "Action" }, { id: "c10", label: "Power" }] },
    { id: "4", name: "Paul Graham",             type: "author",    impact_score: 0.68, first_mentioned: "2021-01-15",
      concepts: [{ id: "c11", label: "Ambition" }, { id: "c12", label: "Work" }] },
    { id: "5", name: "Professor Chen",          type: "mentor",    impact_score: 0.82, first_mentioned: "2018-09-01",
      concepts: [{ id: "c13", label: "Rigor" }, { id: "c14", label: "Curiosity" }, { id: "c15", label: "Patience" }] },
    { id: "6", name: "The Courage to Be Disliked", type: "book",  impact_score: 0.71, first_mentioned: "2022-04-20",
      concepts: [{ id: "c16", label: "Belonging" }, { id: "c17", label: "Self-acceptance" }] },
    { id: "7", name: "Maria",                   type: "peer",      impact_score: 0.60, first_mentioned: "2020-06-01",
      concepts: [{ id: "c18", label: "Vulnerability" }, { id: "c19", label: "Trust" }] },
  ],
};
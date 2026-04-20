import { useState, useEffect, useCallback } from "react";
import { authFetch } from "../auth/Auth";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const C = {
  bg: "#0f0e0b", gold: "#c8a96e", goldFaint: "rgba(200,169,110,0.10)",
  goldMuted: "rgba(200,169,110,0.5)", text: "#e8dcc8",
  textMuted: "rgba(232,220,200,0.5)", border: "rgba(180,140,80,0.18)",
  surface: "rgba(22,20,15,0.98)",
  stable: "#4a8c4a", shifting: "#c8a96e", transforming: "#c0392b",
};

const css = `
  @keyframes dt-fade { from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);} }
  .dt-concept:hover { border-color: rgba(200,169,110,0.5) !important; }
  .dt-concept.active { border-color: #c8a96e !important; background: rgba(200,169,110,0.08) !important; }
`;

function inject() {
  if (!document.getElementById("dt-css")) {
    const s = document.createElement("style");
    s.id = "dt-css"; s.textContent = css;
    document.head.appendChild(s);
  }
}

// ── Mini sparkline using inline SVG ──────────────────────────────────────────
function Sparkline({ points, color, width = 80, height = 24 }) {
  if (!points || points.length < 2) return null;
  const vals = points.map(p => p.score || 0);
  const min  = Math.min(...vals);
  const max  = Math.max(...vals);
  const range = max - min || 1;
  const xs = points.map((_, i) => (i / (points.length - 1)) * width);
  const ys = vals.map(v => height - ((v - min) / range) * (height - 4) - 2);
  const d  = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x},${ys[i]}`).join(" ");
  return (
    <svg width={width} height={height} style={{ overflow: "visible" }}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.7} />
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r={2.5} fill={color} opacity={0.9} />
    </svg>
  );
}

// ── Full drift chart using SVG ────────────────────────────────────────────────
function DriftChart({ points, concept, narrative, direction, inflections }) {
  if (!points || points.length < 2) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: C.textMuted, fontSize: 13, fontStyle: "italic" }}>
        Not enough data to show drift for this concept yet.
      </div>
    );
  }

  const W = 600, H = 200, PAD = { top: 20, right: 20, bottom: 40, left: 40 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top  - PAD.bottom;

  const sorted = [...points].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const scores = sorted.map(p => p.score || 0);
  const min = Math.min(...scores, 0);
  const max = Math.max(...scores, 1);

  const xScale = i  => PAD.left + (i / (sorted.length - 1)) * cW;
  const yScale = v  => PAD.top  + cH - ((v - min) / (max - min || 1)) * cH;

  const dirColor = direction === "stable" ? C.stable
                 : direction === "transforming" ? C.transforming
                 : C.gold;

  const pathD = sorted
    .map((p, i) => `${i === 0 ? "M" : "L"}${xScale(i)},${yScale(p.score || 0)}`)
    .join(" ");

  // Area fill below line
  const areaD = `${pathD} L${xScale(sorted.length - 1)},${PAD.top + cH} L${xScale(0)},${PAD.top + cH} Z`;

  // X axis labels — every N points
  const labelEvery = Math.max(1, Math.floor(sorted.length / 6));
  const xLabels = sorted
    .map((p, i) => ({ i, label: (p.date || "").slice(0, 7), x: xScale(i) }))
    .filter((_, i) => i % labelEvery === 0 || i === sorted.length - 1);

  // Y axis ticks
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(v => ({
    y: yScale(min + v * (max - min)),
    label: Math.round((min + v * (max - min)) * 100),
  }));

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", overflow: "visible" }}>
        {/* Grid lines */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} y1={t.y} x2={W - PAD.right} y2={t.y}
              stroke="rgba(180,140,80,0.08)" strokeWidth={1} />
            <text x={PAD.left - 6} y={t.y + 4} textAnchor="end"
              fontSize={9} fill={C.textMuted} fontFamily="Helvetica, sans-serif">
              {t.label}
            </text>
          </g>
        ))}

        {/* Area */}
        <path d={areaD} fill={dirColor} fillOpacity={0.05} />

        {/* Line */}
        <path d={pathD} fill="none" stroke={dirColor} strokeWidth={2}
          strokeLinecap="round" strokeLinejoin="round" opacity={0.8} />

        {/* Inflection points */}
        {(inflections || []).map((inf, i) => {
          const idx = sorted.findIndex(p => (p.date || "").startsWith(inf.date?.slice(0, 7) || ""));
          if (idx < 0) return null;
          return (
            <g key={i}>
              <circle cx={xScale(idx)} cy={yScale(sorted[idx].score || 0)}
                r={4} fill={dirColor} opacity={0.9} />
              <line cx={xScale(idx)} x1={xScale(idx)} x2={xScale(idx)}
                y1={PAD.top} y2={PAD.top + cH}
                stroke={dirColor} strokeWidth={1} strokeDasharray="3,3" opacity={0.3} />
            </g>
          );
        })}

        {/* Data points */}
        {sorted.map((p, i) => (
          <circle key={i}
            cx={xScale(i)} cy={yScale(p.score || 0)} r={2.5}
            fill={dirColor} opacity={0.5} />
        ))}

        {/* X axis labels */}
        {xLabels.map(({ i, label, x }) => (
          <text key={i} x={x} y={H - 6} textAnchor="middle"
            fontSize={9} fill={C.textMuted} fontFamily="Helvetica, sans-serif">
            {label}
          </text>
        ))}

        {/* Concept label */}
        <text x={PAD.left + 4} y={PAD.top + 14}
          fontSize={12} fill={dirColor} fontFamily="'EB Garamond', Georgia, serif"
          fontStyle="italic" opacity={0.7}>
          {concept}
        </text>
      </svg>

      {/* Direction badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
        <span style={{
          padding: "2px 10px",
          background: `${dirColor}18`,
          border: `1px solid ${dirColor}55`,
          borderRadius: 10, fontSize: 10, color: dirColor,
          letterSpacing: "0.1em", textTransform: "uppercase",
        }}>{direction || "stable"}</span>
        {narrative && (
          <span style={{ color: C.textMuted, fontSize: 12, fontStyle: "italic", lineHeight: 1.5 }}>
            {narrative}
          </span>
        )}
      </div>

      {/* Inflection list */}
      {inflections?.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.12em", marginBottom: 6 }}>INFLECTION POINTS</div>
          {inflections.map((inf, i) => (
            <div key={i} style={{
              display: "flex", gap: 12, padding: "6px 0",
              borderBottom: `1px solid ${C.border}`, fontSize: 12,
            }}>
              <span style={{ color: C.goldMuted, width: 60, flexShrink: 0 }}>{inf.date}</span>
              <span style={{ color: C.textMuted, lineHeight: 1.5 }}>{inf.description}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Concept list item ─────────────────────────────────────────────────────────
function ConceptItem({ concept, isActive, onClick }) {
  const dirColor = concept.overall_direction === "stable"       ? C.stable
                 : concept.overall_direction === "transforming" ? C.transforming
                 : C.gold;
  return (
    <div
      className={`dt-concept${isActive ? " active" : ""}`}
      onClick={onClick}
      style={{
        padding: "10px 14px",
        borderBottom: `1px solid ${C.border}`,
        borderLeft: `3px solid ${isActive ? C.gold : "transparent"}`,
        cursor: "pointer", transition: "all 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ color: isActive ? C.gold : C.text, fontSize: 13 }}>{concept.label}</span>
        <Sparkline points={concept.points} color={dirColor} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          padding: "1px 7px", borderRadius: 8, fontSize: 9,
          color: dirColor, border: `1px solid ${dirColor}44`,
          textTransform: "uppercase", letterSpacing: "0.08em",
        }}>{concept.overall_direction || "stable"}</span>
        <span style={{ color: C.textMuted, fontSize: 10 }}>{concept.entry_count || 0} entries</span>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ConceptDriftTimeline({ user, onNavigate }) {
  inject();

  const [concepts,  setConcepts]  = useState([]);
  const [active,    setActive]    = useState(null);
  const [driftData, setDriftData] = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [driftLoading, setDriftLoading] = useState(false);

  // Load concept list + their drift metadata
  useEffect(() => {
    authFetch(`${API}/concepts?limit=50`)
      .then(r => r.json())
      .then(d => {
        const raw = d.concepts || [];
        // Build lightweight sparkline data from stability_score array if available
        const enriched = raw.map(c => ({
          ...c,
          points: c.drift_points || [
            { date: c.first_seen || "2022-01-01", score: 0.3 },
            { date: c.last_seen  || new Date().toISOString(), score: c.stability_score || 0.5 },
          ],
          overall_direction: c.drift_direction || "stable",
        }));
        setConcepts(enriched.length ? enriched : MOCK_CONCEPTS);
        if (enriched.length) setActive(enriched[0]);
        else setActive(MOCK_CONCEPTS[0]);
      })
      .catch(() => {
        setConcepts(MOCK_CONCEPTS);
        setActive(MOCK_CONCEPTS[0]);
      })
      .finally(() => setLoading(false));
  }, []);

  // Load full drift data when concept is selected
  const loadDrift = useCallback(async (concept) => {
    if (!concept) return;
    setDriftLoading(true);
    try {
      const res = await authFetch(`${API}/concepts/${encodeURIComponent(concept.label)}/drift`);
      if (res.ok) {
        const d = await res.json();
        setDriftData(d);
      } else {
        // Fall back to mock
        setDriftData(MOCK_DRIFT(concept));
      }
    } catch {
      setDriftData(MOCK_DRIFT(concept));
    } finally {
      setDriftLoading(false);
    }
  }, []);

  useEffect(() => { if (active) loadDrift(active); }, [active, loadDrift]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: C.goldMuted, fontSize: 14, fontFamily: "'EB Garamond',Georgia,serif" }}>
        Loading concept drift…
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100%", fontFamily: "'EB Garamond', Georgia, serif", color: C.text }}>

      {/* Left — concept list */}
      <div style={{ width: 260, flexShrink: 0, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", background: "rgba(14,13,10,0.5)" }}>
        <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ color: C.gold, fontSize: 13 }}>Concept Drift</div>
          <div style={{ color: C.textMuted, fontSize: 11, marginTop: 2 }}>How your thinking has shifted</div>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {concepts.map((c, i) => (
            <ConceptItem
              key={i}
              concept={c}
              isActive={active?.label === c.label}
              onClick={() => setActive(c)}
            />
          ))}
        </div>
      </div>

      {/* Right — drift chart */}
      <div style={{ flex: 1, overflowY: "auto", padding: "28px 36px" }}>
        {active ? (
          <div style={{ maxWidth: 720, animation: "dt-fade 0.3s ease" }}>
            <div style={{ marginBottom: 20 }}>
              <div style={{ color: C.goldMuted, fontSize: 10, letterSpacing: "0.14em", marginBottom: 4 }}>CONCEPT DRIFT</div>
              <div style={{ fontSize: 24, color: C.gold, fontStyle: "italic" }}>{active.label}</div>
              {active.entry_count > 0 && (
                <div style={{ color: C.textMuted, fontSize: 12, marginTop: 3 }}>
                  {active.entry_count} entries &nbsp;·&nbsp;
                  First seen: {active.first_seen?.slice(0, 10) || "unknown"}
                </div>
              )}
            </div>

            {driftLoading ? (
              <div style={{ color: C.textMuted, fontSize: 13, fontStyle: "italic", padding: "20px 0" }}>Analysing drift…</div>
            ) : driftData ? (
              <DriftChart
                points={driftData.points || active.points}
                concept={active.label}
                narrative={driftData.narrative}
                direction={driftData.overall_direction || active.overall_direction}
                inflections={driftData.inflection_points}
              />
            ) : null}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: C.textMuted, fontSize: 14, fontStyle: "italic" }}>
            Select a concept to see how it has shifted over time
          </div>
        )}
      </div>
    </div>
  );
}

// ── Mock data ─────────────────────────────────────────────────────────────────
const MOCK_CONCEPTS = [
  {
    label: "Freedom", entry_count: 12, first_seen: "2021-01-10", last_seen: "2024-11-20",
    stability_score: 0.52, overall_direction: "transforming",
    points: [
      {date:"2021-01",score:0.2},{date:"2021-06",score:0.25},{date:"2022-01",score:0.35},
      {date:"2022-06",score:0.55},{date:"2023-01",score:0.70},{date:"2023-06",score:0.65},
      {date:"2024-01",score:0.78},{date:"2024-06",score:0.82},
    ],
  },
  {
    label: "Discipline", entry_count: 9, first_seen: "2021-02-03", last_seen: "2024-10-14",
    stability_score: 0.71, overall_direction: "stable",
    points: [
      {date:"2021-02",score:0.65},{date:"2021-08",score:0.67},{date:"2022-02",score:0.70},
      {date:"2022-08",score:0.72},{date:"2023-02",score:0.71},{date:"2024-02",score:0.73},
    ],
  },
  {
    label: "Ambition", entry_count: 7, first_seen: "2021-04-20", last_seen: "2024-09-05",
    stability_score: 0.45, overall_direction: "shifting",
    points: [
      {date:"2021-04",score:0.8},{date:"2021-10",score:0.72},{date:"2022-04",score:0.60},
      {date:"2022-10",score:0.48},{date:"2023-04",score:0.38},{date:"2024-04",score:0.30},
    ],
  },
  {
    label: "Commitment", entry_count: 8, first_seen: "2021-03-15", last_seen: "2024-11-01",
    stability_score: 0.68, overall_direction: "stable",
    points: [
      {date:"2021-03",score:0.55},{date:"2021-09",score:0.60},{date:"2022-03",score:0.66},
      {date:"2022-09",score:0.68},{date:"2023-03",score:0.69},{date:"2024-03",score:0.70},
    ],
  },
  {
    label: "Risk", entry_count: 6, first_seen: "2022-07-22", last_seen: "2024-08-30",
    stability_score: 0.41, overall_direction: "shifting",
    points: [
      {date:"2022-07",score:0.30},{date:"2022-12",score:0.45},{date:"2023-06",score:0.55},
      {date:"2024-01",score:0.62},{date:"2024-08",score:0.70},
    ],
  },
];

function MOCK_DRIFT(concept) {
  return {
    concept: concept.label,
    points: concept.points,
    overall_direction: concept.overall_direction,
    narrative: concept.overall_direction === "transforming"
      ? `${concept.label} began as an escape route and has slowly become a framework for deliberate choice.`
      : concept.overall_direction === "shifting"
      ? `Your understanding of ${concept.label} has been moving steadily in one direction over the past two years.`
      : `Your framing of ${concept.label} has been remarkably consistent across your entries.`,
    inflection_points: concept.overall_direction !== "stable" ? [
      { date: concept.points?.[Math.floor(concept.points.length / 2)]?.date || "2022-06", description: "A period of questioning that changed how you named this." },
    ] : [],
  };
}
import { useState, useRef, useCallback } from "react";
import { authFetch } from "../auth/Auth";
import { SearchSkeleton, EmptyState } from "../components/ErrorBoundary";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const C = {
  gold: "#c8a96e",
  goldFaint: "rgba(200,169,110,0.1)",
  goldMuted: "rgba(200,169,110,0.5)",
  text: "#e8dcc8",
  textMuted: "rgba(232,220,200,0.5)",
  border: "rgba(180,140,80,0.18)",
  surface: "rgba(22,20,15,0.98)",
  highlight: "rgba(200,169,110,0.25)",
};

const css = `
  @keyframes s-fade { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
  .s-result:hover { background: rgba(180,140,80,0.06) !important; border-color: rgba(180,140,80,0.3) !important; }
  .s-tab:hover { color: rgba(200,169,110,0.8) !important; }
  mark { background: rgba(200,169,110,0.2); color: #e8dcc8; border-radius: 2px; padding: 0 2px; }
`;

function inject() {
  if (!document.getElementById("search-styles")) {
    const el = document.createElement("style");
    el.id = "search-styles"; el.textContent = css;
    document.head.appendChild(el);
  }
}

// ── Highlight matching text ───────────────────────────────────────────────────
function Highlight({ text, query }) {
  if (!query || !text) return <span>{text}</span>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return (
    <span>
      {parts.map((p, i) =>
        p.toLowerCase() === query.toLowerCase()
          ? <mark key={i}>{p}</mark>
          : <span key={i}>{p}</span>
      )}
    </span>
  );
}

// ── Result card ───────────────────────────────────────────────────────────────
function ResultCard({ entry, query, mode, onClick }) {
  return (
    <div className="s-result" onClick={() => onClick?.(entry)} style={{
      padding: "18px 22px",
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 4, marginBottom: 10,
      cursor: "pointer",
      transition: "all 0.2s",
      animation: "s-fade 0.3s ease",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ color: C.goldMuted, fontSize: 11, letterSpacing: "0.1em" }}>
            {new Date(entry.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </div>
          {entry.emotional_tone && (
            <span style={{
              padding: "2px 8px",
              background: "rgba(180,140,80,0.08)",
              border: `1px solid ${C.border}`,
              borderRadius: 10, fontSize: 10, color: C.goldMuted,
              fontStyle: "italic",
            }}>{entry.emotional_tone}</span>
          )}
        </div>
        {mode === "semantic" && entry.similarity_score != null && (
          <div style={{ color: C.goldMuted, fontSize: 11 }}>
            {Math.round(entry.similarity_score * 100)}% match
          </div>
        )}
      </div>

      <div style={{ color: C.text, fontSize: 14, lineHeight: 1.75, marginBottom: 12 }}>
        {mode === "fulltext"
          ? <Highlight text={entry.excerpt || entry.content_preview} query={query} />
          : <span style={{ fontStyle: "italic" }}>"{entry.excerpt || entry.content_preview}"</span>
        }
      </div>

      {entry.concepts?.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {entry.concepts.map(c => (
            <span key={c} style={{
              padding: "2px 9px",
              background: C.goldFaint,
              border: `1px solid ${C.border}`,
              borderRadius: 10, fontSize: 11, color: C.gold,
            }}>
              {mode === "concept" ? <strong>{c}</strong> : c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Search ────────────────────────────────────────────────────────────────────
export default function Search() {
  inject();
  const [query,   setQuery]   = useState("");
  const [mode,    setMode]    = useState("fulltext"); // fulltext | semantic | concept
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState(null);
  const debounceRef = useRef(null);

  const search = useCallback(async (q, m) => {
    if (!q.trim()) { setResults([]); setSearched(false); return; }
    setLoading(true); setSearched(true);
    try {
      const res = await authFetch(`${API}/search?q=${encodeURIComponent(q)}&mode=${m}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setResults(data.results || []);
    } catch {
      // Use mock for development
      setResults(mockSearch(q, m));
    } finally {
      setLoading(false);
    }
  }, []);

  function handleInput(val) {
    setQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val, mode), 350);
  }

  function handleModeChange(m) {
    setMode(m);
    if (query.trim()) search(query, m);
  }

  return (
    <div style={{
      height: "100%", display: "flex", flexDirection: "column",
      fontFamily: "'EB Garamond', Georgia, serif", color: C.text,
    }}>
      {/* Search bar */}
      <div style={{
        padding: "24px 32px 0",
        borderBottom: `1px solid ${C.border}`,
        background: "rgba(15,14,11,0.8)",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{ position: "relative", marginBottom: 16 }}>
          <span style={{
            position: "absolute", left: 16, top: "50%",
            transform: "translateY(-50%)",
            color: C.goldMuted, fontSize: 16, pointerEvents: "none",
          }}>⌕</span>
          <input
            value={query}
            onChange={e => handleInput(e.target.value)}
            placeholder={
              mode === "fulltext" ? "Search your entries by keyword..." :
              mode === "semantic"  ? "Describe an idea you wrote about..." :
              "Search entries by concept..."
            }
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "14px 16px 14px 44px",
              background: "rgba(255,255,255,0.03)",
              border: `1px solid ${C.border}`,
              borderRadius: 4,
              color: C.text, fontSize: 16,
              fontFamily: "'EB Garamond', Georgia, serif",
              outline: "none",
              transition: "border-color 0.2s",
            }}
            onFocus={e  => e.target.style.borderColor = "rgba(180,140,80,0.45)"}
            onBlur={e   => e.target.style.borderColor = C.border}
          />
        </div>

        {/* Mode tabs */}
        <div style={{ display: "flex", gap: 0 }}>
          {[
            { id: "fulltext", label: "Keyword",  desc: "exact words" },
            { id: "semantic", label: "Semantic",  desc: "by meaning"  },
            { id: "concept",  label: "Concept",   desc: "by idea"     },
          ].map(tab => (
            <button key={tab.id} className="s-tab" onClick={() => handleModeChange(tab.id)} style={{
              padding: "10px 20px",
              background: "none", border: "none",
              borderBottom: mode === tab.id ? `2px solid ${C.gold}` : "2px solid transparent",
              color: mode === tab.id ? C.gold : C.goldMuted,
              fontSize: 12, letterSpacing: "0.12em",
              textTransform: "uppercase",
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "color 0.15s",
              marginBottom: -1,
            }}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 32px" }}>
        {loading ? (
          <SearchSkeleton />
        ) : !searched ? (
          <EmptyState icon="⌕" title="Search your inner record"
            subtitle="Find entries by keyword, meaning, or concept. Your full corpus is indexed." />
        ) : results.length === 0 ? (
          <EmptyState icon="◌" title="No results found"
            subtitle={`No entries match "${query}" in ${mode} mode. Try different words or switch modes.`} />
        ) : (
          <>
            <div style={{ color: C.goldMuted, fontSize: 12, letterSpacing: "0.1em", marginBottom: 16 }}>
              {results.length} result{results.length !== 1 ? "s" : ""} for "{query}"
            </div>
            {results.map((r, i) => (
              <ResultCard key={r.id || i} entry={r} query={query} mode={mode}
                onClick={e => setSelected(e)} />
            ))}
          </>
        )}
      </div>

      {/* Entry detail drawer */}
      {selected && (
        <div style={{
          position: "fixed", right: 0, top: 0, bottom: 0, width: 480,
          background: "rgba(12,11,9,0.98)",
          borderLeft: `1px solid ${C.border}`,
          padding: "28px 28px",
          overflowY: "auto",
          zIndex: 100,
          animation: "s-fade 0.2s ease",
          fontFamily: "'EB Garamond', Georgia, serif",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
            <div style={{ color: C.goldMuted, fontSize: 11, letterSpacing: "0.12em" }}>
              {new Date(selected.created_at).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
            </div>
            <button onClick={() => setSelected(null)} style={{
              background: "none", border: "none",
              color: C.goldMuted, fontSize: 20, cursor: "pointer",
            }}>×</button>
          </div>
          <div style={{ color: C.text, fontSize: 15, lineHeight: 1.85, marginBottom: 20, fontStyle: "italic" }}>
            "{selected.content || selected.excerpt}"
          </div>
          {selected.concepts?.length > 0 && (
            <div>
              <div style={{ color: C.goldMuted, fontSize: 11, letterSpacing: "0.12em", marginBottom: 8, textTransform: "uppercase" }}>Concepts</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {selected.concepts.map(c => (
                  <span key={c} style={{
                    padding: "4px 12px",
                    background: C.goldFaint, border: `1px solid ${C.border}`,
                    borderRadius: 12, fontSize: 12, color: C.gold,
                  }}>{c}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Mock search results ───────────────────────────────────────────────────────
function mockSearch(q, mode) {
  const entries = [
    { id: "1", created_at: "2024-03-15", emotional_tone: "searching",  concepts: ["Freedom", "Belonging"], excerpt: "I keep wondering if freedom is something you move toward or away from. The word carries so much weight when I write it now." },
    { id: "2", created_at: "2024-01-22", emotional_tone: "resolved",   concepts: ["Ambition", "Success"], excerpt: "Success used to mean being seen. Now I'm not sure it means anything I can point to." },
    { id: "3", created_at: "2023-11-08", emotional_tone: "ambivalent", concepts: ["Solitude", "Connection"], excerpt: "There is a loneliness that comes from choosing to be alone, and a different loneliness that arrives uninvited. I mix them up constantly." },
    { id: "4", created_at: "2023-07-14", emotional_tone: "certain",    concepts: ["Discipline", "Care"], excerpt: "The most loving thing I can do for myself is show up even when I don't feel like it. I understand this abstractly and resist it practically." },
  ];
  return entries.filter(e =>
    e.excerpt.toLowerCase().includes(q.toLowerCase()) ||
    e.concepts.some(c => c.toLowerCase().includes(q.toLowerCase()))
  ).length > 0
    ? entries.filter(e =>
        e.excerpt.toLowerCase().includes(q.toLowerCase()) ||
        e.concepts.some(c => c.toLowerCase().includes(q.toLowerCase()))
      )
    : entries; // for demo, return all if nothing matches
}
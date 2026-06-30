import { useState, useEffect, useRef } from "react";

// ── Fonts injected via Google Fonts ──────────────────────────────────────────
const FONTS = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400;1,500&family=Lora:ital,wght@0,400;0,500;1,400&display=swap');
`;

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  bg:         "#0d0c09",
  surface:    "rgba(18,16,12,0.97)",
  gold:       "#c8a96e",
  goldLight:  "#d9bc8a",
  goldFaint:  "rgba(200,169,110,0.09)",
  goldMuted:  "rgba(200,169,110,0.45)",
  cream:      "#e8dcc8",
  creamMuted: "rgba(232,220,200,0.5)",
  creamFaint: "rgba(232,220,200,0.15)",
  border:     "rgba(180,140,80,0.18)",
  borderHov:  "rgba(180,140,80,0.38)",
  red:        "#d07070",
  teal:       "#6aacb8",
  serif:      "'Cormorant Garamond', Georgia, serif",
  body:       "'Lora', Georgia, serif",
};

// ── Global styles ─────────────────────────────────────────────────────────────
const GLOBAL_CSS = `
  ${FONTS}
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { scroll-behavior: smooth; }
  body { background: ${T.bg}; color: ${T.cream}; font-family: ${T.body}; }

  @keyframes lp-float {
    0%, 100% { transform: translateY(0px); }
    50%       { transform: translateY(-12px); }
  }
  @keyframes lp-pulse-ring {
    0%   { transform: scale(0.95); opacity: 0.7; }
    100% { transform: scale(1.6);  opacity: 0; }
  }
  @keyframes lp-drift {
    0%   { transform: translate(0,0) scale(1); }
    33%  { transform: translate(8px,-12px) scale(1.04); }
    66%  { transform: translate(-6px,6px) scale(0.97); }
    100% { transform: translate(0,0) scale(1); }
  }
  @keyframes lp-fade-up {
    from { opacity: 0; transform: translateY(24px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes lp-fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes lp-line-grow {
    from { stroke-dashoffset: 400; }
    to   { stroke-dashoffset: 0; }
  }
  @keyframes lp-node-pop {
    0%   { transform: scale(0); opacity: 0; }
    70%  { transform: scale(1.15); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes lp-shimmer {
    from { background-position: -200% 0; }
    to   { background-position: 200% 0; }
  }
  @keyframes lp-spin-slow {
    to { transform: rotate(360deg); }
  }
  @keyframes lp-cursor-blink {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0; }
  }

  .lp-nav-link { transition: color 0.2s; }
  .lp-nav-link:hover { color: ${T.gold} !important; }
  .lp-btn-primary:hover {
    background: rgba(200,169,110,0.22) !important;
    border-color: rgba(200,169,110,0.6) !important;
    transform: translateY(-1px);
  }
  .lp-btn-ghost:hover {
    color: ${T.gold} !important;
    border-color: ${T.borderHov} !important;
  }
  .lp-feature-card:hover {
    border-color: rgba(180,140,80,0.32) !important;
    background: rgba(22,20,14,0.98) !important;
  }
  .lp-pricing-card:hover {
    border-color: rgba(180,140,80,0.38) !important;
    transform: translateY(-3px);
  }
  .lp-pricing-card { transition: all 0.25s; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(180,140,80,0.2); border-radius: 2px; }
`;

function injectGlobal() {
  if (typeof document !== "undefined" && !document.getElementById("lp-global")) {
    const s = document.createElement("style");
    s.id = "lp-global";
    s.textContent = GLOBAL_CSS;
    document.head.appendChild(s);
  }
}

// ── Animated graph hero ────────────────────────────────────────────────────────
// Pure SVG — no D3 dependency, fully animated with CSS
function HeroGraph() {
  const nodes = [
    { id: "freedom",    x: 50,  y: 38, r: 18, label: "Freedom",    delay: 0.2,  dur: 8  },
    { id: "belonging",  x: 72,  y: 55, r: 14, label: "Belonging",  delay: 0.5,  dur: 10 },
    { id: "meaning",    x: 35,  y: 60, r: 20, label: "Meaning",    delay: 0.1,  dur: 9  },
    { id: "ambition",   x: 62,  y: 25, r: 13, label: "Ambition",   delay: 0.7,  dur: 11 },
    { id: "solitude",   x: 22,  y: 42, r: 11, label: "Solitude",   delay: 0.4,  dur: 7  },
    { id: "identity",   x: 80,  y: 38, r: 16, label: "Identity",   delay: 0.3,  dur: 12 },
    { id: "justice",    x: 46,  y: 78, r: 12, label: "Justice",    delay: 0.6,  dur: 8  },
    { id: "discipline", x: 15,  y: 65, r: 10, label: "Discipline", delay: 0.8,  dur: 9  },
    { id: "frankl",     x: 85,  y: 65, r: 9,  label: "V. Frankl",  delay: 0.9,  dur: 10, type: "person" },
    { id: "success",    x: 58,  y: 72, r: 11, label: "Success",    delay: 0.5,  dur: 11 },
  ];

  const edges = [
    { x1: 50, y1: 38, x2: 72, y2: 55, type: "contradicts", delay: 0.8 },
    { x1: 50, y1: 38, x2: 35, y2: 60, type: "reinforces",  delay: 1.0 },
    { x1: 35, y1: 60, x2: 58, y2: 72, type: "evolved",     delay: 1.2 },
    { x1: 62, y1: 25, x2: 50, y2: 38, type: "contradicts", delay: 0.9 },
    { x1: 22, y1: 42, x2: 35, y2: 60, type: "reinforces",  delay: 1.1 },
    { x1: 80, y1: 38, x2: 72, y2: 55, type: "reinforces",  delay: 1.3 },
    { x1: 85, y1: 65, x2: 35, y2: 60, type: "introduced",  delay: 1.4 },
    { x1: 46, y1: 78, x2: 35, y2: 60, type: "reinforces",  delay: 1.1 },
    { x1: 15, y1: 65, x2: 22, y2: 42, type: "evolved",     delay: 1.5 },
    { x1: 58, y1: 72, x2: 80, y2: 38, type: "contradicts", delay: 1.6 },
  ];

  const edgeColors = {
    contradicts: "rgba(208,112,112,0.35)",
    reinforces:  "rgba(120,180,120,0.3)",
    evolved:     "rgba(200,169,110,0.45)",
    introduced:  "rgba(106,172,184,0.4)",
  };

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}
    >
      <defs>
        <radialGradient id="hero-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="rgba(200,169,110,0.08)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <filter id="node-glow">
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Background glow */}
      <ellipse cx="50" cy="52" rx="45" ry="42" fill="url(#hero-glow)" />

      {/* Edges */}
      {edges.map((e, i) => (
        <line key={i}
          x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
          stroke={edgeColors[e.type]}
          strokeWidth={e.type === "contradicts" ? 0.4 : 0.3}
          strokeDasharray={e.type === "evolved" ? "1.5,1" : e.type === "contradicts" ? "none" : "none"}
          style={{
            animation: `lp-fade-in 0.6s ease ${e.delay}s both`,
          }}
        />
      ))}

      {/* Pulse rings on core nodes */}
      {["meaning", "freedom", "identity"].map(id => {
        const n = nodes.find(nd => nd.id === id);
        return (
          <circle key={`ring-${id}`}
            cx={n.x} cy={n.y} r={n.r + 3}
            fill="none"
            stroke="rgba(200,169,110,0.2)"
            strokeWidth="0.5"
            style={{
              transformOrigin: `${n.x}px ${n.y}px`,
              animation: `lp-pulse-ring 3s ease-out ${n.delay + 1}s infinite`,
            }}
          />
        );
      })}

      {/* Nodes */}
      {nodes.map(n => (
        <g key={n.id} style={{
          transformOrigin: `${n.x}px ${n.y}px`,
          animation: `lp-node-pop 0.5s cubic-bezier(0.34,1.56,0.64,1) ${n.delay}s both,
                      lp-drift ${n.dur}s ease-in-out ${n.delay + 0.5}s infinite`,
        }}>
          {/* Node glow */}
          <circle cx={n.x} cy={n.y} r={n.r + 4}
            fill={n.type === "person" ? "rgba(106,172,184,0.06)" : "rgba(200,169,110,0.06)"}
          />
          {/* Node circle */}
          <circle cx={n.x} cy={n.y} r={n.r * 0.55}
            fill={n.type === "person" ? "rgba(106,172,184,0.15)" : "rgba(200,169,110,0.12)"}
            stroke={n.type === "person" ? "rgba(106,172,184,0.6)" : "rgba(200,169,110,0.55)"}
            strokeWidth="0.4"
          />
          {/* Label */}
          <text
            x={n.x} y={n.y + n.r * 0.18}
            textAnchor="middle"
            fill={n.type === "person" ? "rgba(106,172,184,0.85)" : "rgba(200,169,110,0.85)"}
            fontSize={n.r * 0.3}
            fontFamily="'Cormorant Garamond', Georgia, serif"
            fontStyle="italic"
          >
            {n.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ── Section: Feature card ─────────────────────────────────────────────────────
function FeatureCard({ icon, title, body, visual, accent, delay = 0 }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { threshold: 0.15 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={ref} className="lp-feature-card" style={{
      padding: "32px 30px",
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: 4,
      transition: "all 0.25s",
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0)" : "translateY(20px)",
      transitionDelay: `${delay}ms`,
      transitionProperty: "opacity, transform, border-color, background",
      display: "flex", flexDirection: "column", gap: 20,
    }}>
      {/* Visual mock */}
      <div style={{
        height: 180,
        background: "rgba(10,9,7,0.8)",
        border: `1px solid ${T.border}`,
        borderRadius: 3,
        overflow: "hidden",
        position: "relative",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {visual}
        <div style={{
          position: "absolute", inset: 0,
          background: `radial-gradient(ellipse at center, ${accent}08 0%, transparent 70%)`,
          pointerEvents: "none",
        }} />
      </div>

      {/* Text */}
      <div>
        <div style={{
          color: accent, fontSize: 22, marginBottom: 10,
          fontFamily: T.serif, fontStyle: "italic",
        }}>
          {icon} {title}
        </div>
        <div style={{
          color: T.creamMuted, fontSize: 15, lineHeight: 1.75,
          fontFamily: T.body,
        }}>
          {body}
        </div>
      </div>
    </div>
  );
}

// ── Visual mocks for feature cards ────────────────────────────────────────────
function ConceptEvolutionMock() {
  const rows = [
    { year: "2018", label: "freedom", def: "absence of obligation", w: "45%" },
    { year: "2021", label: "freedom", def: "capacity for chosen constraint", w: "68%" },
    { year: "2024", label: "freedom", def: "presence of purpose", w: "88%" },
  ];
  return (
    <div style={{ padding: "20px 22px", width: "100%" }}>
      <div style={{ color: T.goldMuted, fontSize: 10, letterSpacing: "0.14em", marginBottom: 14, textTransform: "uppercase" }}>
        Concept: Freedom · stability 38%
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
            <span style={{ color: T.gold, fontSize: 11, fontFamily: T.serif, fontStyle: "italic" }}>{r.year}</span>
            <span style={{ color: T.creamMuted, fontSize: 10 }}>{r.def}</span>
          </div>
          <div style={{ height: 3, background: "rgba(180,140,80,0.1)", borderRadius: 2 }}>
            <div style={{
              height: "100%", width: r.w, borderRadius: 2,
              background: `linear-gradient(to right, ${T.gold}, rgba(200,169,110,0.5))`,
              transition: "width 1.2s ease",
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function InfluenceMock() {
  return (
    <svg viewBox="0 0 200 130" style={{ width: "100%", height: "100%" }}>
      {/* Center: You */}
      <circle cx="100" cy="65" r="12" fill="rgba(200,169,110,0.15)" stroke="rgba(200,169,110,0.5)" strokeWidth="1" />
      <text x="100" y="69" textAnchor="middle" fill={T.gold} fontSize="7" fontFamily="'Cormorant Garamond',serif" fontStyle="italic">You</text>

      {/* Influences */}
      {[
        { x: 40,  y: 30,  label: "Frankl",   concepts: 4, color: T.teal  },
        { x: 160, y: 30,  label: "Arendt",   concepts: 3, color: T.gold  },
        { x: 20,  y: 85,  label: "Mentor",   concepts: 5, color: "#c8908a" },
        { x: 170, y: 90,  label: "Camus",    concepts: 2, color: T.gold  },
        { x: 100, y: 115, label: "Partner",  concepts: 3, color: "#90c890" },
      ].map((inf, i) => (
        <g key={i}>
          <line x1="100" y1="65" x2={inf.x} y2={inf.y}
            stroke={`${inf.color}50`} strokeWidth="0.6"
            strokeDasharray={i % 2 === 0 ? "none" : "3,2"}
          />
          <circle cx={inf.x} cy={inf.y} r="8" fill={`${inf.color}18`} stroke={`${inf.color}70`} strokeWidth="0.8" />
          <text x={inf.x} y={inf.y + 3} textAnchor="middle" fill={inf.color} fontSize="5.5" fontFamily="'Cormorant Garamond',serif" fontStyle="italic">{inf.label}</text>
          <text x={inf.x} y={inf.y + 18} textAnchor="middle" fill={`${inf.color}80`} fontSize="4.5" fontFamily="'Cormorant Garamond',serif">{inf.concepts} concepts</text>
        </g>
      ))}
    </svg>
  );
}

function ContradictionMock() {
  const pairs = [
    { a: "Freedom",   b: "Belonging",   score: 0.85, color: "#e07070" },
    { a: "Ambition",  b: "Contentment", score: 0.71, color: T.gold    },
    { a: "Solitude",  b: "Connection",  score: 0.48, color: "#90c890" },
  ];
  return (
    <div style={{ padding: "18px 22px", width: "100%" }}>
      {pairs.map((p, i) => (
        <div key={i} style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: T.gold, fontSize: 12, fontFamily: T.serif, fontStyle: "italic", flex: 1 }}>{p.a}</span>
          <div style={{ width: 60, height: 3, background: "rgba(180,140,80,0.1)", borderRadius: 2 }}>
            <div style={{
              height: "100%", width: `${p.score * 100}%`,
              background: p.color, borderRadius: 2, opacity: 0.85,
            }} />
          </div>
          <span style={{ color: T.gold, fontSize: 12, fontFamily: T.serif, fontStyle: "italic", flex: 1, textAlign: "right" }}>{p.b}</span>
        </div>
      ))}
      <div style={{ color: T.goldMuted, fontSize: 10, letterSpacing: "0.1em", marginTop: 6 }}>
        3 unresolved tensions · 1 resolved this month
      </div>
    </div>
  );
}

function BiographyMock() {
  const text = `Between 2019 and 2022, your thinking underwent a fundamental restructuring. The concept of `;
  const highlight = `Freedom — once framed as escape — `;
  const rest = `was quietly redefined as something you had to choose rather than flee toward. Viktor Frankl arrived at precisely the moment this was possible.`;

  return (
    <div style={{ padding: "18px 22px", width: "100%" }}>
      <div style={{ color: T.goldMuted, fontSize: 9, letterSpacing: "0.14em", marginBottom: 10, textTransform: "uppercase" }}>
        AI-generated · 2019–2022 period
      </div>
      <div style={{ color: T.creamMuted, fontSize: 12, lineHeight: 1.8, fontFamily: T.serif, fontStyle: "italic" }}>
        {text}
        <span style={{ color: T.gold, borderBottom: "1px solid rgba(200,169,110,0.3)" }}>{highlight}</span>
        {rest}
        <span style={{ animation: "lp-cursor-blink 1s step-end infinite", marginLeft: 1 }}>|</span>
      </div>
    </div>
  );
}

// ── Section fade-in wrapper ───────────────────────────────────────────────────
function FadeIn({ children, delay = 0, threshold = 0.1 }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { threshold });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={ref} style={{
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0)" : "translateY(20px)",
      transition: `opacity 0.6s ease ${delay}ms, transform 0.6s ease ${delay}ms`,
    }}>
      {children}
    </div>
  );
}

// ── Pricing card ──────────────────────────────────────────────────────────────
function PricingCard({ tier, price, sub, features, cta, onCta, highlighted = false, delay = 0 }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { threshold: 0.1 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={ref} className="lp-pricing-card" style={{
      padding: "32px 28px",
      background: highlighted ? "rgba(200,169,110,0.06)" : T.surface,
      border: `1px solid ${highlighted ? "rgba(200,169,110,0.4)" : T.border}`,
      borderRadius: 4,
      display: "flex", flexDirection: "column", gap: 0,
      opacity: visible ? 1 : 0,
      transform: visible ? `translateY(${highlighted ? -8 : 0}px)` : "translateY(20px)",
      transitionDelay: `${delay}ms`,
      transitionProperty: "opacity, transform, border-color",
      position: "relative",
    }}>
      {highlighted && (
        <div style={{
          position: "absolute", top: -1, left: "50%", transform: "translateX(-50%)",
          padding: "3px 14px",
          background: T.gold,
          borderRadius: "0 0 4px 4px",
          color: T.bg,
          fontSize: 10, letterSpacing: "0.12em", fontFamily: T.body,
          textTransform: "uppercase",
        }}>Most popular</div>
      )}

      <div style={{ color: T.goldMuted, fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 16 }}>{tier}</div>
      <div style={{ color: T.gold, fontSize: 38, fontFamily: T.serif, fontStyle: "italic", lineHeight: 1, marginBottom: 4 }}>{price}</div>
      <div style={{ color: T.creamMuted, fontSize: 13, marginBottom: 28 }}>{sub}</div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
        {features.map((f, i) => (
          <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span style={{ color: T.gold, fontSize: 12, marginTop: 1, flexShrink: 0 }}>✦</span>
            <span style={{ color: T.cream, fontSize: 14, lineHeight: 1.5, fontFamily: T.body }}>{f}</span>
          </div>
        ))}
      </div>

      <button onClick={onCta} style={{
        padding: "13px",
        background: highlighted ? "rgba(200,169,110,0.18)" : "none",
        border: `1px solid ${highlighted ? "rgba(200,169,110,0.5)" : T.border}`,
        borderRadius: 3,
        color: T.gold,
        fontSize: 13, letterSpacing: "0.12em", textTransform: "uppercase",
        cursor: "pointer", fontFamily: T.body,
        transition: "all 0.2s",
      }}>
        {cta}
      </button>
    </div>
  );
}

// ── Testimonial ───────────────────────────────────────────────────────────────
function Testimonial({ quote, name, role, delay = 0 }) {
  return (
    <FadeIn delay={delay}>
      <div style={{
        padding: "28px 30px",
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 4,
      }}>
        <div style={{
          color: T.cream, fontSize: 16, lineHeight: 1.8,
          fontFamily: T.serif, fontStyle: "italic", marginBottom: 18,
        }}>
          "{quote}"
        </div>
        <div style={{ color: T.gold, fontSize: 13, fontFamily: T.body }}>{name}</div>
        <div style={{ color: T.creamMuted, fontSize: 12, marginTop: 2 }}>{role}</div>
      </div>
    </FadeIn>
  );
}

// ── Main landing page ─────────────────────────────────────────────────────────
export default function LandingPage({ onSignIn, onGetStarted }) {
  injectGlobal();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const section = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: T.body }}>

      {/* ── Grain overlay ──────────────────────────────────────────────────── */}
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E")`,
        opacity: 0.7,
      }} />

      {/* ── Navbar ─────────────────────────────────────────────────────────── */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        padding: "0 48px",
        height: 64,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: scrolled ? "rgba(13,12,9,0.95)" : "transparent",
        borderBottom: scrolled ? `1px solid ${T.border}` : "1px solid transparent",
        backdropFilter: scrolled ? "blur(12px)" : "none",
        transition: "all 0.3s",
      }}>
        <div style={{ color: T.gold, fontFamily: T.serif, fontSize: 18, fontStyle: "italic", letterSpacing: "0.04em" }}>
          Thought Biography
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          {[["How it works", "how-it-works"], ["Features", "features"], ["Pricing", "pricing"]].map(([l, id]) => (
            <button key={id} className="lp-nav-link" onClick={() => section(id)} style={{
              background: "none", border: "none",
              color: T.creamMuted, fontSize: 14,
              cursor: "pointer", fontFamily: T.body,
              letterSpacing: "0.04em",
            }}>{l}</button>
          ))}
          <button className="lp-btn-ghost" onClick={onSignIn} style={{
            padding: "8px 20px",
            background: "none",
            border: `1px solid ${T.border}`,
            borderRadius: 3,
            color: T.cream, fontSize: 13,
            cursor: "pointer", fontFamily: T.body,
            letterSpacing: "0.06em",
            transition: "all 0.2s",
          }}>Sign in</button>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section style={{
        minHeight: "100vh",
        display: "flex", alignItems: "center",
        padding: "120px 48px 80px",
        position: "relative", overflow: "hidden",
      }}>
        {/* Graph background */}
        <div style={{
          position: "absolute", right: "-5%", top: "10%",
          width: "54%", height: "80%",
          opacity: 0.65,
        }}>
          <HeroGraph />
        </div>

        {/* Left text */}
        <div style={{ maxWidth: 580, position: "relative", zIndex: 1 }}>
          <div style={{
            color: T.goldMuted, fontSize: 11, letterSpacing: "0.22em",
            textTransform: "uppercase", marginBottom: 24,
            animation: "lp-fade-up 0.6s ease 0.1s both",
          }}>
            Personal knowledge graph
          </div>

          {/* Main header — Julian says: must be fully descriptive */}
          <h1 style={{
            fontFamily: T.serif, fontWeight: 300,
            fontSize: "clamp(36px, 4.5vw, 60px)",
            lineHeight: 1.18, marginBottom: 24,
            color: T.cream,
            animation: "lp-fade-up 0.6s ease 0.2s both",
          }}>
            A journal that builds a living map of{" "}
            <em style={{ color: T.gold, fontStyle: "italic" }}>how your mind evolves</em>
            {" "}over time.
          </h1>

          {/* Subheader — Julian says: expand on what makes it special */}
          <p style={{
            color: T.creamMuted, fontSize: 17, lineHeight: 1.8,
            maxWidth: 500, marginBottom: 40, fontFamily: T.body,
            animation: "lp-fade-up 0.6s ease 0.3s both",
          }}>
            Write entries. Thought Biography extracts your recurring ideas, tracks how their meaning changes across years, and shows you which books and people actually shaped how you think.
          </p>

          {/* CTAs */}
          <div style={{
            display: "flex", gap: 14, alignItems: "center",
            animation: "lp-fade-up 0.6s ease 0.4s both",
          }}>
            <button className="lp-btn-primary" onClick={() => onGetStarted("free")} style={{
              padding: "15px 34px",
              background: "rgba(200,169,110,0.14)",
              border: `1px solid rgba(200,169,110,0.45)`,
              borderRadius: 3,
              color: T.gold,
              fontSize: 14, letterSpacing: "0.1em", textTransform: "uppercase",
              cursor: "pointer", fontFamily: T.body,
              transition: "all 0.2s",
            }}>
              Begin your record — free
            </button>
            <button className="lp-btn-ghost" onClick={() => section("how-it-works")} style={{
              padding: "15px 24px",
              background: "none",
              border: `1px solid ${T.border}`,
              borderRadius: 3,
              color: T.creamMuted,
              fontSize: 14, letterSpacing: "0.06em",
              cursor: "pointer", fontFamily: T.body,
              transition: "all 0.2s",
            }}>
              See how it works
            </button>
          </div>

          <div style={{
            marginTop: 24, color: T.creamMuted, fontSize: 12,
            animation: "lp-fade-up 0.6s ease 0.5s both",
          }}>
            Free for your first 30 entries. No credit card.
          </div>
        </div>
      </section>

      {/* ── Problem statement ──────────────────────────────────────────────── */}
      <section style={{
        padding: "100px 48px",
        borderTop: `1px solid ${T.border}`,
        maxWidth: 960, margin: "0 auto",
      }}>
        <FadeIn>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr",
            gap: 64, alignItems: "center",
          }}>
            <div>
              <div style={{ color: T.goldMuted, fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 20 }}>
                The problem
              </div>
              <h2 style={{
                fontFamily: T.serif, fontWeight: 300,
                fontSize: "clamp(28px, 3vw, 40px)", lineHeight: 1.25,
                color: T.cream, marginBottom: 24,
              }}>
                You've been writing for years. You still can't see{" "}
                <em style={{ color: T.gold }}>how you've changed.</em>
              </h2>
              <p style={{ color: T.creamMuted, fontSize: 16, lineHeight: 1.85, fontFamily: T.body }}>
                A journal accumulates. It doesn't illuminate. You have years of entries that capture isolated moments — but no way to see across them. You know intuitively that your thinking has evolved, but you can't trace the arc. You can't see which ideas you keep returning to, which ones have quietly transformed, or which book you read in 2019 that changed everything without you noticing.
              </p>
            </div>
            <div style={{
              padding: "28px 24px",
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: 4,
            }}>
              <div style={{ color: T.goldMuted, fontSize: 11, letterSpacing: "0.14em", marginBottom: 16, textTransform: "uppercase" }}>
                What a regular journal gives you
              </div>
              {[
                ["March 15, 2019", "Wrote about freedom and constraint.", "searching"],
                ["August 3, 2021",  "Returned to freedom again.",          "ambivalent"],
                ["January 9, 2023", "Freedom came up in a different way.", "resolved"],
                ["November 2, 2024", "Still circling this idea...",        "searching"],
              ].map(([date, text, tone], i) => (
                <div key={i} style={{
                  padding: "10px 12px", marginBottom: 8,
                  background: "rgba(10,9,7,0.6)",
                  border: `1px solid rgba(180,140,80,0.1)`,
                  borderRadius: 2,
                  display: "flex", gap: 12, alignItems: "flex-start",
                }}>
                  <div style={{ color: T.goldMuted, fontSize: 10, whiteSpace: "nowrap", marginTop: 1 }}>{date}</div>
                  <div style={{ color: T.creamMuted, fontSize: 13 }}>{text}</div>
                </div>
              ))}
              <div style={{
                marginTop: 16, padding: "10px 12px",
                background: "rgba(180,60,60,0.06)", border: "1px solid rgba(180,60,60,0.2)",
                borderRadius: 2,
                color: "rgba(224,112,112,0.7)", fontSize: 12, fontStyle: "italic",
              }}>
                Four entries across six years. No visible thread. No map.
              </div>
            </div>
          </div>
        </FadeIn>
      </section>

      {/* ── Features ───────────────────────────────────────────────────────── */}
      <section id="features" style={{ padding: "100px 48px", borderTop: `1px solid ${T.border}` }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <FadeIn>
            <div style={{ textAlign: "center", marginBottom: 64 }}>
              <div style={{ color: T.goldMuted, fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 16 }}>
                What you get
              </div>
              <h2 style={{
                fontFamily: T.serif, fontWeight: 300,
                fontSize: "clamp(28px, 3vw, 44px)", color: T.cream,
              }}>
                Four ways your thinking becomes <em style={{ color: T.gold }}>visible</em>
              </h2>
            </div>
          </FadeIn>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <FeatureCard
              icon="~" accent={T.gold} delay={0}
              title="Concept drift — see how your ideas change"
              body="Every time you write about Freedom, Success, or Belonging, the system tracks how your implicit definition shifts. When the meaning drifts significantly, you're alerted. The word stays the same. The idea evolves."
              visual={<ConceptEvolutionMock />}
            />
            <FeatureCard
              icon="→" accent={T.teal} delay={80}
              title="Influence trees — know what actually changed you"
              body="Which books have catalyzed the most downstream shifts in how you think? Which people? The influence tree maps who introduced which ideas, and how many of your current beliefs trace back to a single conversation."
              visual={<InfluenceMock />}
            />
            <FeatureCard
              icon="⟷" accent={T.red} delay={160}
              title="Contradiction detection — find where you're unresolved"
              body="The system identifies when two beliefs you hold are in genuine tension. Not to judge — to surface. Some contradictions dissolve when you look at them. Others are worth sitting with for years."
              visual={<ContradictionMock />}
            />
            <FeatureCard
              icon="≡" accent={T.gold} delay={240}
              title="The biography document — your intellectual memoir"
              body="Once your graph has depth, AI reads the full arc and writes a literary account of how your thinking has evolved. Not a summary — a story. Between 2019 and 2022 you were preoccupied with the tension between ambition and belonging..."
              visual={<BiographyMock />}
            />
          </div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────────────── */}
      <section id="how-it-works" style={{
        padding: "100px 48px",
        borderTop: `1px solid ${T.border}`,
        background: "rgba(15,13,9,0.6)",
      }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <FadeIn>
            <div style={{ textAlign: "center", marginBottom: 72 }}>
              <div style={{ color: T.goldMuted, fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 16 }}>
                How it works
              </div>
              <h2 style={{
                fontFamily: T.serif, fontWeight: 300,
                fontSize: "clamp(26px, 3vw, 40px)", color: T.cream,
              }}>
                Three steps. Then it runs itself.
              </h2>
            </div>
          </FadeIn>

          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {[
              {
                num: "01",
                title: "Write, speak, or paste",
                body: "Journal entries, voice memos, or imported text. Write as you normally would — you don't have to tag anything or use special formats. The intelligence is in the processing, not the input.",
                delay: 0,
              },
              {
                num: "02",
                title: "AI reads every entry and builds your graph",
                body: "Each entry is processed through several layers: concept extraction, emotional mapping, relationship detection, significance scoring. New nodes appear. Old nodes update. Concepts accumulate relationships over time.",
                delay: 100,
              },
              {
                num: "03",
                title: "Your map gets richer with every entry",
                body: "The first thirty entries sketch the outline. The next hundred fill in the depth. After a year, the graph has enough data to show you things about your own thinking that you couldn't have articulated yourself.",
                delay: 200,
              },
            ].map((step, i) => (
              <FadeIn key={i} delay={step.delay}>
                <div style={{
                  display: "grid", gridTemplateColumns: "80px 1fr",
                  gap: 32, padding: "40px 0",
                  borderBottom: i < 2 ? `1px solid ${T.border}` : "none",
                }}>
                  <div style={{
                    color: "rgba(200,169,110,0.15)",
                    fontFamily: T.serif, fontSize: 52,
                    fontStyle: "italic", fontWeight: 300,
                    lineHeight: 1, paddingTop: 4,
                  }}>
                    {step.num}
                  </div>
                  <div>
                    <div style={{
                      color: T.gold, fontFamily: T.serif, fontStyle: "italic",
                      fontSize: 22, marginBottom: 12,
                    }}>{step.title}</div>
                    <div style={{
                      color: T.creamMuted, fontSize: 16, lineHeight: 1.8,
                      fontFamily: T.body, maxWidth: 580,
                    }}>{step.body}</div>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── Social proof ───────────────────────────────────────────────────── */}
      <section style={{ padding: "100px 48px", borderTop: `1px solid ${T.border}` }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <FadeIn>
            <div style={{ color: T.goldMuted, fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", textAlign: "center", marginBottom: 48 }}>
              What people say
            </div>
          </FadeIn>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
            <Testimonial
              quote="I've kept a journal for twelve years. This is the first tool that made those years feel coherent rather than just accumulated."
              name="Maya Chen"
              role="Philosopher, UC Berkeley"
              delay={0}
            />
            <Testimonial
              quote="I use it with clients. Being able to see someone's contradiction map before a session changes everything about what I decide to address."
              name="Dr. Andreas Wolf"
              role="Executive coach, Berlin"
              delay={80}
            />
            <Testimonial
              quote="The biography document made me cry. I didn't know how much I'd changed until I saw it written out as a single arc."
              name="Priya Nair"
              role="Writer & researcher"
              delay={160}
            />
          </div>
        </div>
      </section>

      {/* ── Privacy objection ──────────────────────────────────────────────── */}
      <section style={{
        padding: "80px 48px",
        borderTop: `1px solid ${T.border}`,
        background: "rgba(13,12,9,0.8)",
      }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <FadeIn>
            <div style={{
              padding: "48px 48px",
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: 4,
              display: "grid", gridTemplateColumns: "1fr 2fr", gap: 48,
              alignItems: "center",
            }}>
              <div>
                <div style={{
                  width: 64, height: 64,
                  border: `1px solid ${T.border}`,
                  borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 28, color: T.gold, marginBottom: 20,
                }}>⊕</div>
                <div style={{ color: T.gold, fontFamily: T.serif, fontStyle: "italic", fontSize: 22 }}>
                  Your thoughts stay yours.
                </div>
              </div>
              <div>
                <p style={{ color: T.creamMuted, fontSize: 16, lineHeight: 1.8, marginBottom: 16, fontFamily: T.body }}>
                  A thought biography contains your most intimate intellectual life. We designed the privacy model with that weight in mind.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {[
                    "Your entries are encrypted with a key derived from your password — we cannot read them, even if we wanted to.",
                    "You can export your complete graph at any time, in formats compatible with other tools.",
                    "Some entries can be marked permanently unindexed — readable by you, invisible to the graph.",
                  ].map((item, i) => (
                    <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                      <span style={{ color: T.gold, fontSize: 11, marginTop: 3, flexShrink: 0 }}>✦</span>
                      <span style={{ color: T.cream, fontSize: 14, lineHeight: 1.6, fontFamily: T.body }}>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── Pricing ────────────────────────────────────────────────────────── */}
      <section id="pricing" style={{ padding: "100px 48px", borderTop: `1px solid ${T.border}` }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <FadeIn>
            <div style={{ textAlign: "center", marginBottom: 64 }}>
              <div style={{ color: T.goldMuted, fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 16 }}>
                Pricing
              </div>
              <h2 style={{
                fontFamily: T.serif, fontWeight: 300,
                fontSize: "clamp(26px, 3vw, 40px)", color: T.cream,
              }}>
                Start free. Pay when your graph has depth.
              </h2>
            </div>
          </FadeIn>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, alignItems: "start" }}>
            <PricingCard
              tier="Free"
              price="$0"
              sub="forever"
              delay={0}
              features={[
                "30 journal entries",
                "Core concept graph",
                "Basic contradiction detection",
                "5 queries per day",
              ]}
              cta="Begin for free"
              onCta={() => onGetStarted("free")}
            />
            <PricingCard
              tier="Personal"
              price="$15.99"
              sub="per month"
              highlighted
              delay={80}
              features={[
                "Unlimited entries",
                "Full concept drift tracking",
                "Influence trees visualization",
                "Time travel playback",
                "AI biography generation",
                "Semantic search",
                "Full data export",
              ]}
              cta="Start 14-day free trial"
              onCta={() => onGetStarted("personal")}
            />
            <PricingCard
              tier="Professional"
              price="$49.99"
              sub="per month"
              delay={160}
              features={[
                "Everything in Personal",
                "Share graph with therapist or coach",
                "Annotation layer for shared views",
                "Up to 5 share links",
                "Priority support",
              ]}
              cta="Start free trial"
              onCta={() => onGetStarted("professional")}
            />
          </div>
        </div>
      </section>

      {/* ── Final CTA ──────────────────────────────────────────────────────── */}
      <section style={{
        padding: "120px 48px",
        borderTop: `1px solid ${T.border}`,
        textAlign: "center",
        position: "relative", overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", width: 600, height: 600,
          background: "radial-gradient(circle, rgba(200,169,110,0.05) 0%, transparent 70%)",
          top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          pointerEvents: "none",
        }} />
        <FadeIn>
          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={{ color: T.goldMuted, fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 24 }}>
              Your record starts now
            </div>
            <h2 style={{
              fontFamily: T.serif, fontWeight: 300,
              fontSize: "clamp(32px, 4vw, 54px)", lineHeight: 1.2,
              color: T.cream, maxWidth: 640, margin: "0 auto 24px",
            }}>
              You've been thinking for decades.{" "}
              <em style={{ color: T.gold }}>Start being able to see it.</em>
            </h2>
            <p style={{
              color: T.creamMuted, fontSize: 17, lineHeight: 1.7, marginBottom: 40,
              maxWidth: 500, margin: "0 auto 40px", fontFamily: T.body,
            }}>
              Free for your first 30 entries. No credit card. Your data is encrypted and yours to keep.
            </p>
            <button className="lp-btn-primary" onClick={() => onGetStarted("free")} style={{
              padding: "17px 44px",
              background: "rgba(200,169,110,0.14)",
              border: `1px solid rgba(200,169,110,0.45)`,
              borderRadius: 3,
              color: T.gold,
              fontSize: 15, letterSpacing: "0.1em", textTransform: "uppercase",
              cursor: "pointer", fontFamily: T.body,
              transition: "all 0.2s",
            }}>
              Begin your record
            </button>
          </div>
        </FadeIn>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer style={{
        padding: "36px 48px",
        borderTop: `1px solid ${T.border}`,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div style={{ color: T.gold, fontFamily: T.serif, fontStyle: "italic", fontSize: 16 }}>
          Thought Biography
        </div>
        <div style={{ display: "flex", gap: 28 }}>
          {["Privacy", "Terms", "Contact"].map(l => (
            <button key={l} className="lp-nav-link" style={{
              background: "none", border: "none",
              color: T.creamMuted, fontSize: 13,
              cursor: "pointer", fontFamily: T.body,
            }}>{l}</button>
          ))}
        </div>
        <div style={{ color: T.creamMuted, fontSize: 12 }}>
          © {new Date().getFullYear()} Thought Biography
        </div>
      </footer>
    </div>
  );
}

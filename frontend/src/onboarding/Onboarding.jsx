import { useState, useEffect, useRef } from "react";
import { authFetch } from "../auth/Auth";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const T = {
  bg:        "#0d0c09",
  surface:   "rgba(18,16,12,0.97)",
  gold:      "#c8a96e",
  goldFaint: "rgba(200,169,110,0.1)",
  goldMuted: "rgba(200,169,110,0.45)",
  cream:     "#e8dcc8",
  creamMuted:"rgba(232,220,200,0.5)",
  border:    "rgba(180,140,80,0.18)",
  serif:     "'Cormorant Garamond', 'EB Garamond', Georgia, serif",
  body:      "'Lora', 'EB Garamond', Georgia, serif",
};

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Lora:ital,wght@0,400;1,400&display=swap');
  @keyframes ob-fade-up { from { opacity:0; transform:translateY(18px); } to { opacity:1; transform:translateY(0); } }
  @keyframes ob-fade-in { from { opacity:0; } to { opacity:1; } }
  @keyframes ob-spin    { to { transform: rotate(360deg); } }
  @keyframes ob-pop     { 0%{transform:scale(0);opacity:0;} 70%{transform:scale(1.1);opacity:1;} 100%{transform:scale(1);opacity:1;} }
  @keyframes ob-pulse   { 0%,100%{opacity:0.4;} 50%{opacity:1;} }
  @keyframes ob-line    { from{stroke-dashoffset:200;} to{stroke-dashoffset:0;} }
  @keyframes ob-node-glow { 0%,100%{box-shadow:0 0 0 rgba(200,169,110,0);} 50%{box-shadow:0 0 20px rgba(200,169,110,0.2);} }
  @keyframes ob-check   { 0%{stroke-dashoffset:30;} 100%{stroke-dashoffset:0;} }
  @keyframes ob-drift   { 0%,100%{transform:translate(0,0);} 33%{transform:translate(4px,-6px);} 66%{transform:translate(-4px,4px);} }
  .ob-btn:hover { background: rgba(200,169,110,0.2) !important; border-color: rgba(200,169,110,0.55) !important; transform: translateY(-1px); }
  .ob-btn { transition: all 0.2s; }
  .ob-textarea:focus { border-color: rgba(180,140,80,0.4) !important; outline: none; }
`;

function injectCSS() {
  if (typeof document !== "undefined" && !document.getElementById("ob-styles")) {
    const el = document.createElement("style");
    el.id = "ob-styles"; el.textContent = CSS;
    document.head.appendChild(el);
  }
}

// ── Step indicator ─────────────────────────────────────────────────────────────
function StepDots({ current, total }) {
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 48 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{
          width: i === current ? 24 : 8, height: 8,
          borderRadius: 4,
          background: i === current ? T.gold : i < current ? "rgba(200,169,110,0.4)" : "rgba(180,140,80,0.12)",
          transition: "all 0.35s ease",
        }} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Welcome
// ─────────────────────────────────────────────────────────────────────────────
function StepWelcome({ user, onNext }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { setTimeout(() => setVisible(true), 60); }, []);

  const name = user?.display_name?.split(" ")[0] || "there";

  return (
    <div style={{ textAlign: "center", maxWidth: 560, margin: "0 auto" }}>
      <div style={{
        width: 72, height: 72,
        border: `1px solid rgba(200,169,110,0.35)`,
        borderRadius: "50%",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 28, color: T.gold,
        margin: "0 auto 32px",
        opacity: visible ? 1 : 0,
        transform: visible ? "scale(1)" : "scale(0.8)",
        transition: "all 0.5s cubic-bezier(0.34,1.56,0.64,1)",
        animation: visible ? "ob-node-glow 3s ease-in-out 0.5s infinite" : "none",
      }}>◎</div>

      <h1 style={{
        fontFamily: T.serif, fontWeight: 300,
        fontSize: "clamp(28px, 3.5vw, 42px)",
        color: T.cream, lineHeight: 1.25,
        marginBottom: 20,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(16px)",
        transition: "all 0.5s ease 0.1s",
      }}>
        Welcome, <em style={{ color: T.gold, fontStyle: "italic" }}>{name}.</em>
      </h1>

      <p style={{
        color: T.creamMuted, fontSize: 17, lineHeight: 1.8,
        fontFamily: T.body, marginBottom: 16,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(16px)",
        transition: "all 0.5s ease 0.2s",
      }}>
        Your thought biography starts now. Over time, this system will learn how you think — which ideas you return to, how your beliefs evolve, and what has shaped you most.
      </p>

      <p style={{
        color: T.creamMuted, fontSize: 17, lineHeight: 1.8,
        fontFamily: T.body, marginBottom: 48,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(16px)",
        transition: "all 0.5s ease 0.3s",
      }}>
        But it begins with a single entry. Let's write one now.
      </p>

      <button className="ob-btn" onClick={onNext} style={{
        padding: "15px 40px",
        background: T.goldFaint,
        border: `1px solid rgba(200,169,110,0.4)`,
        borderRadius: 3,
        color: T.gold,
        fontSize: 14, letterSpacing: "0.1em", textTransform: "uppercase",
        cursor: "pointer", fontFamily: T.body,
        opacity: visible ? 1 : 0,
        transition: "opacity 0.5s ease 0.4s, all 0.2s",
      }}>
        Begin writing →
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: First entry
// ─────────────────────────────────────────────────────────────────────────────
const PROMPTS = [
  "What idea have you been returning to lately that you haven't fully named yet?",
  "What do you believe now that you wouldn't have believed five years ago, and why?",
  "Which person has influenced how you think most, and what specifically did they change?",
  "What tension are you currently sitting with — two things you believe that seem to contradict each other?",
  "What does success mean to you right now, at this exact moment?",
];

function StepWriteEntry({ onNext }) {
  const [text, setText] = useState("");
  const [promptIdx, setPromptIdx] = useState(0);
  const [promptVisible, setPromptVisible] = useState(true);
  const MIN_WORDS = 40;
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const ready = wordCount >= MIN_WORDS;

  function cyclePrompt() {
    setPromptVisible(false);
    setTimeout(() => {
      setPromptIdx(i => (i + 1) % PROMPTS.length);
      setPromptVisible(true);
    }, 300);
  }

  return (
    <div style={{
      maxWidth: 680, margin: "0 auto",
      animation: "ob-fade-up 0.5s ease both",
    }}>
      <div style={{ marginBottom: 28 }}>
        <h2 style={{
          fontFamily: T.serif, fontWeight: 300, fontSize: 28,
          color: T.cream, marginBottom: 8,
        }}>
          Write your first entry
        </h2>
        <p style={{ color: T.creamMuted, fontSize: 15, lineHeight: 1.7, fontFamily: T.body }}>
          Write at least {MIN_WORDS} words. Be honest rather than impressive — the system is reading for ideas, not style.
        </p>
      </div>

      {/* Prompt */}
      <div style={{
        padding: "16px 20px", marginBottom: 20,
        background: "rgba(200,169,110,0.05)",
        border: `1px solid ${T.border}`,
        borderLeft: `3px solid rgba(200,169,110,0.4)`,
        borderRadius: 3,
        display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16,
      }}>
        <div style={{
          color: T.creamMuted, fontSize: 15, fontFamily: T.serif, fontStyle: "italic", lineHeight: 1.6,
          opacity: promptVisible ? 1 : 0,
          transition: "opacity 0.3s",
        }}>
          {PROMPTS[promptIdx]}
        </div>
        <button onClick={cyclePrompt} style={{
          background: "none", border: "none",
          color: T.goldMuted, fontSize: 18, cursor: "pointer",
          flexShrink: 0, padding: "0 4px",
          transition: "color 0.2s",
        }} title="Try a different prompt">↻</button>
      </div>

      {/* Textarea */}
      <textarea
        className="ob-textarea"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Write here. Take your time."
        rows={10}
        style={{
          width: "100%", boxSizing: "border-box",
          padding: "20px 22px",
          background: "rgba(15,14,11,0.9)",
          border: `1px solid ${T.border}`,
          borderRadius: 3,
          color: T.cream,
          fontSize: 16, lineHeight: 1.85,
          fontFamily: T.serif, fontStyle: "italic",
          resize: "vertical",
          transition: "border-color 0.2s",
        }}
      />

      {/* Footer */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginTop: 16,
      }}>
        <div style={{ color: T.creamMuted, fontSize: 13 }}>
          <span style={{ color: ready ? "#8aba8a" : T.goldMuted, transition: "color 0.3s" }}>
            {wordCount} word{wordCount !== 1 ? "s" : ""}
          </span>
          <span style={{ marginLeft: 6 }}>
            {ready ? "✓ ready to process" : `· ${MIN_WORDS - wordCount} more to go`}
          </span>
        </div>
        <button className="ob-btn" onClick={() => onNext(text)} disabled={!ready} style={{
          padding: "12px 28px",
          background: ready ? T.goldFaint : "rgba(180,140,80,0.04)",
          border: `1px solid ${ready ? "rgba(200,169,110,0.4)" : "rgba(180,140,80,0.12)"}`,
          borderRadius: 3,
          color: ready ? T.gold : T.goldMuted,
          fontSize: 13, letterSpacing: "0.1em",
          cursor: ready ? "pointer" : "not-allowed",
          fontFamily: T.body,
        }}>
          Process entry →
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: Processing animation
// ─────────────────────────────────────────────────────────────────────────────
const PIPELINE_STEPS = [
  { id: "reading",       label: "Reading your entry",                duration: 1200 },
  { id: "extracting",    label: "Extracting concepts and themes",    duration: 1800 },
  { id: "emotional",     label: "Mapping emotional tone",            duration: 900  },
  { id: "relationships", label: "Detecting concept relationships",   duration: 1600 },
  { id: "significance",  label: "Scoring significance",              duration: 700  },
  { id: "writing",       label: "Writing to your graph",             duration: 1000 },
];

function StepProcessing({ text, onNext }) {
  const [completedSteps, setCompletedSteps] = useState([]);
  const [currentStep,    setCurrentStep]    = useState(0);
  const [result,         setResult]         = useState(null);
  const [done,           setDone]           = useState(false);

  // Run real API call + animate pipeline in parallel
  useEffect(() => {
    // Start API call
    authFetch(`${API}/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text, source: "onboarding" }),
    }).then(r => r.json()).then(d => {
      setResult(d);
    }).catch(() => {
      // Mock result for development
      setResult({
        significance_score: 0.78,
        emotional_tone: "searching",
        concepts: [
          { label: "Freedom",     weight: 0.9 },
          { label: "Ambition",    weight: 0.75 },
          { label: "Uncertainty", weight: 0.65 },
          { label: "Identity",    weight: 0.7 },
        ],
        open_question: "What would it look like to be truly free of the expectations I've inherited?",
      });
    });

    // Animate pipeline steps sequentially
    let total = 0;
    PIPELINE_STEPS.forEach((step, i) => {
      setTimeout(() => {
        setCurrentStep(i);
      }, total);
      total += step.duration;
      setTimeout(() => {
        setCompletedSteps(cs => [...cs, step.id]);
        if (i === PIPELINE_STEPS.length - 1) {
          setTimeout(() => setDone(true), 600);
        }
      }, total - 100);
    });
  }, []);

  useEffect(() => {
    if (done && result) {
      setTimeout(() => onNext(result), 800);
    }
  }, [done, result]);

  return (
    <div style={{
      maxWidth: 520, margin: "0 auto",
      animation: "ob-fade-up 0.5s ease both",
    }}>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <h2 style={{
          fontFamily: T.serif, fontWeight: 300, fontSize: 28,
          color: T.cream, marginBottom: 10,
        }}>
          Building your first graph entry
        </h2>
        <p style={{ color: T.creamMuted, fontSize: 15, fontFamily: T.body }}>
          This is what happens every time you write.
        </p>
      </div>

      {/* Pipeline steps */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 40 }}>
        {PIPELINE_STEPS.map((step, i) => {
          const complete = completedSteps.includes(step.id);
          const active   = currentStep === i && !complete;
          return (
            <div key={step.id} style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: "14px 18px",
              background: complete ? "rgba(120,180,120,0.07)" : active ? T.goldFaint : "rgba(180,140,80,0.02)",
              border: `1px solid ${complete ? "rgba(120,180,120,0.2)" : active ? "rgba(180,140,80,0.3)" : T.border}`,
              borderRadius: 3,
              transition: "all 0.4s ease",
              opacity: i > currentStep + 1 ? 0.3 : 1,
            }}>
              {/* Icon */}
              <div style={{ width: 22, height: 22, flexShrink: 0, position: "relative" }}>
                {complete ? (
                  <svg viewBox="0 0 22 22" width="22" height="22">
                    <circle cx="11" cy="11" r="10" fill="rgba(120,180,120,0.2)" stroke="rgba(120,180,120,0.6)" strokeWidth="1" />
                    <polyline points="6,11 9.5,14.5 16,8"
                      fill="none" stroke="#8aba8a" strokeWidth="1.5"
                      strokeDasharray="30"
                      style={{ animation: "ob-check 0.3s ease forwards" }}
                    />
                  </svg>
                ) : active ? (
                  <div style={{
                    width: 22, height: 22,
                    border: `2px solid rgba(200,169,110,0.25)`,
                    borderTopColor: T.gold,
                    borderRadius: "50%",
                    animation: "ob-spin 0.7s linear infinite",
                  }} />
                ) : (
                  <div style={{
                    width: 22, height: 22,
                    border: `1px solid rgba(180,140,80,0.2)`,
                    borderRadius: "50%",
                  }} />
                )}
              </div>

              {/* Label */}
              <span style={{
                color: complete ? "#8aba8a" : active ? T.gold : T.creamMuted,
                fontSize: 14, fontFamily: T.body,
                transition: "color 0.3s",
              }}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Done message */}
      <div style={{
        textAlign: "center",
        opacity: done ? 1 : 0,
        transform: done ? "translateY(0)" : "translateY(8px)",
        transition: "all 0.4s ease",
      }}>
        <div style={{ color: "#8aba8a", fontSize: 14, fontFamily: T.body }}>
          ✓ Your first graph entry is ready
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4: Graph reveal
// ─────────────────────────────────────────────────────────────────────────────
function MiniGraph({ concepts }) {
  if (!concepts?.length) return null;

  const positions = [
    { x: 50, y: 50 },
    { x: 75, y: 28 },
    { x: 80, y: 72 },
    { x: 22, y: 35 },
    { x: 28, y: 70 },
  ];

  return (
    <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%" }}>
      <defs>
        <radialGradient id="ob-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(200,169,110,0.1)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>
      <ellipse cx="50" cy="50" rx="45" ry="40" fill="url(#ob-glow)" />

      {/* Edges */}
      {concepts.slice(1).map((_, i) => {
        const from = positions[0];
        const to   = positions[i + 1] || positions[1];
        return (
          <line key={i}
            x1={from.x} y1={from.y}
            x2={to.x}   y2={to.y}
            stroke="rgba(200,169,110,0.4)" strokeWidth="0.5"
            strokeDasharray="200" strokeDashoffset="200"
            style={{ animation: `ob-line 0.8s ease ${0.3 + i * 0.15}s forwards` }}
          />
        );
      })}

      {/* Nodes */}
      {concepts.slice(0, 5).map((c, i) => {
        const pos = positions[i];
        const isCore = i === 0;
        return (
          <g key={i} style={{
            transformOrigin: `${pos.x}px ${pos.y}px`,
            animation: `ob-pop 0.5s cubic-bezier(0.34,1.56,0.64,1) ${i * 0.12}s both,
                        ob-drift ${7 + i}s ease-in-out ${0.5 + i * 0.2}s infinite`,
          }}>
            <circle cx={pos.x} cy={pos.y} r={isCore ? 8 : 6}
              fill="rgba(200,169,110,0.12)"
              stroke={`rgba(200,169,110,${isCore ? 0.7 : 0.5})`}
              strokeWidth="0.5"
            />
            <text x={pos.x} y={pos.y + 3} textAnchor="middle"
              fill={`rgba(200,169,110,${isCore ? 0.9 : 0.7})`}
              fontSize={isCore ? 4 : 3.5}
              fontFamily="'Cormorant Garamond',Georgia,serif"
              fontStyle="italic"
            >
              {c.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function StepReveal({ result, onDone }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { setTimeout(() => setVisible(true), 100); }, []);

  const concepts = result?.concepts || [
    { label: "Freedom" }, { label: "Ambition" }, { label: "Identity" }, { label: "Uncertainty" },
  ];

  return (
    <div style={{
      maxWidth: 640, margin: "0 auto",
      animation: "ob-fade-up 0.5s ease both",
    }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <h2 style={{
          fontFamily: T.serif, fontWeight: 300, fontSize: 30,
          color: T.cream, marginBottom: 12,
        }}>
          Your graph has <em style={{ color: T.gold, fontStyle: "italic" }}>begun.</em>
        </h2>
        <p style={{ color: T.creamMuted, fontSize: 15, fontFamily: T.body, lineHeight: 1.7 }}>
          From one entry, {concepts.length} concepts have been mapped. Each entry you write will add depth to these nodes and reveal new connections.
        </p>
      </div>

      {/* Graph preview */}
      <div style={{
        height: 260, marginBottom: 32,
        border: `1px solid ${T.border}`,
        borderRadius: 4,
        background: "rgba(12,11,8,0.9)",
        position: "relative", overflow: "hidden",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.5s ease",
      }}>
        <MiniGraph concepts={concepts} />
        <div style={{
          position: "absolute", bottom: 12, left: 0, right: 0,
          textAlign: "center",
          color: T.goldMuted, fontSize: 11, letterSpacing: "0.1em",
        }}>
          Your graph · 1 entry · {concepts.length} concepts
        </div>
      </div>

      {/* Extracted concepts */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ color: T.goldMuted, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 14 }}>
          Concepts extracted from your entry
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {concepts.map((c, i) => (
            <div key={i} style={{
              padding: "7px 16px",
              background: T.goldFaint,
              border: `1px solid ${T.border}`,
              borderRadius: 12,
              color: T.gold, fontSize: 13,
              fontFamily: T.serif, fontStyle: "italic",
              animation: `ob-pop 0.4s cubic-bezier(0.34,1.56,0.64,1) ${i * 0.1}s both`,
            }}>
              {c.label}
            </div>
          ))}
        </div>
      </div>

      {/* Open question */}
      {result?.open_question && (
        <div style={{
          padding: "16px 20px", marginBottom: 28,
          background: "rgba(200,169,110,0.04)",
          border: `1px solid ${T.border}`,
          borderLeft: `3px solid rgba(200,169,110,0.4)`,
          borderRadius: 3,
          animation: "ob-fade-in 0.6s ease 0.4s both",
        }}>
          <div style={{ color: T.goldMuted, fontSize: 10, letterSpacing: "0.14em", marginBottom: 8, textTransform: "uppercase" }}>
            Open question surfaced
          </div>
          <div style={{ color: T.creamMuted, fontSize: 15, fontFamily: T.serif, fontStyle: "italic", lineHeight: 1.7 }}>
            "{result.open_question}"
          </div>
        </div>
      )}

      {/* What's ahead */}
      <div style={{
        padding: "20px 22px", marginBottom: 32,
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 3,
        animation: "ob-fade-in 0.6s ease 0.5s both",
      }}>
        <div style={{ color: T.gold, fontFamily: T.serif, fontStyle: "italic", fontSize: 15, marginBottom: 14 }}>
          What happens as you keep writing
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            { milestone: "10 entries",  unlock: "Your first contradiction surfaces" },
            { milestone: "30 entries",  unlock: "Concept drift becomes visible" },
            { milestone: "50 entries",  unlock: "Influence tree takes shape" },
            { milestone: "100+ entries",unlock: "Biography document becomes meaningful" },
          ].map((m, i) => (
            <div key={i} style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <div style={{
                padding: "3px 10px",
                background: "rgba(180,140,80,0.08)",
                border: `1px solid ${T.border}`,
                borderRadius: 10, fontSize: 11, color: T.goldMuted,
                whiteSpace: "nowrap", flexShrink: 0,
              }}>{m.milestone}</div>
              <div style={{ color: T.creamMuted, fontSize: 13, fontFamily: T.body }}>{m.unlock}</div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div style={{
        display: "flex", justifyContent: "center",
        animation: "ob-fade-in 0.6s ease 0.6s both",
      }}>
        <button className="ob-btn" onClick={onDone} style={{
          padding: "15px 44px",
          background: T.goldFaint,
          border: `1px solid rgba(200,169,110,0.4)`,
          borderRadius: 3,
          color: T.gold,
          fontSize: 14, letterSpacing: "0.1em", textTransform: "uppercase",
          cursor: "pointer", fontFamily: T.body,
        }}>
          Enter your thought biography →
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Onboarding orchestrator
// ─────────────────────────────────────────────────────────────────────────────
export default function Onboarding({ user, onComplete }) {
  injectCSS();
  const [step,   setStep]   = useState(0);
  const [entry,  setEntry]  = useState("");
  const [result, setResult] = useState(null);

  const TOTAL_STEPS = 4;

  function handleEntryNext(text) {
    setEntry(text);
    setStep(2);
  }

  function handleProcessingNext(r) {
    setResult(r);
    setStep(3);
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: T.bg,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: "80px 24px 48px",
      fontFamily: T.body,
      position: "relative",
    }}>
      {/* Grain */}
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none",
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E")`,
      }} />

      {/* Logo */}
      <div style={{
        position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)",
        color: T.gold, fontFamily: "'Cormorant Garamond',Georgia,serif",
        fontStyle: "italic", fontSize: 18, letterSpacing: "0.04em",
      }}>
        Thought Biography
      </div>

      <div style={{ width: "100%", maxWidth: 720, position: "relative", zIndex: 1 }}>
        <StepDots current={step} total={TOTAL_STEPS} />

        {step === 0 && <StepWelcome   user={user}    onNext={() => setStep(1)} />}
        {step === 1 && <StepWriteEntry                onNext={handleEntryNext} />}
        {step === 2 && <StepProcessing text={entry}  onNext={handleProcessingNext} />}
        {step === 3 && <StepReveal    result={result} onDone={onComplete} />}
      </div>

      {/* Skip link for returning users */}
      {step < 2 && (
        <button onClick={onComplete} style={{
          position: "fixed", bottom: 24,
          background: "none", border: "none",
          color: "rgba(200,169,110,0.25)", fontSize: 12,
          cursor: "pointer", fontFamily: T.body,
          letterSpacing: "0.08em",
          transition: "color 0.2s",
        }}
        onMouseEnter={e => e.target.style.color = T.goldMuted}
        onMouseLeave={e => e.target.style.color = "rgba(200,169,110,0.25)"}
        >
          Skip onboarding →
        </button>
      )}
    </div>
  );
}
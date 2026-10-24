import { useState, useEffect, useRef } from "react";
import { AuthStorage, authFetch } from "../auth/Auth";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const C = {
  bg:        "#0f0e0b",
  gold:      "#c8a96e",
  goldFaint: "rgba(200,169,110,0.08)",
  goldMid:   "rgba(200,169,110,0.35)",
  text:      "#e8dcc8",
  textMuted: "rgba(232,220,200,0.45)",
  border:    "rgba(200,169,110,0.15)",
  error:     "#e07070",
  success:   "rgba(200,169,110,0.7)",
};

export default function CapturePage({ onOpenApp }) {
  const [text,      setText]    = useState("");
  const [status,   setStatus]   = useState("idle"); // idle | saving | saved | error | offline
  const [charCount, setCharCount] = useState(0);
  const [isOnline,  setIsOnline]  = useState(navigator.onLine);
  const textareaRef = useRef(null);

  // Focus textarea immediately on mount — zero friction
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Track online/offline
  useEffect(() => {
    const on  = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online",  on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // Keyboard shortcut: Cmd/Ctrl + Enter to save
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  function handleChange(e) {
    setText(e.target.value);
    setCharCount(e.target.value.length);
    if (status !== "idle") setStatus("idle");
  }

  async function handleSave() {
    if (!text.trim() || status === "saving") return;

    // If offline, queue to IndexedDB and show confirmation
    if (!isOnline) {
      await queueOffline(text.trim());
      setStatus("offline");
      setTimeout(() => { setText(""); setCharCount(0); setStatus("idle"); }, 1800);
      return;
    }

    setStatus("saving");
    try {
      const res = await authFetch(`${API}/entries`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ content: text.trim(), source: "capture" }),
      });

      if (!res.ok) throw new Error(`${res.status}`);

      setStatus("saved");
      setTimeout(() => { setText(""); setCharCount(0); setStatus("idle"); textareaRef.current?.focus(); }, 1200);
    } catch (err) {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2500);
    }
  }

  const canSave = text.trim().length > 0 && status !== "saving";

  const statusLabel = {
    idle:    charCount > 0 ? `${charCount} chars` : "",
    saving:  "Saving…",
    saved:   "Saved ✓",
    error:   "Failed — tap to retry",
    offline: "Queued — will save when back online",
  }[status];

  const statusColor = {
    idle:    C.textMuted,
    saving:  C.textMuted,
    saved:   C.success,
    error:   C.error,
    offline: C.gold,
  }[status];

  return (
    <div style={{
      minHeight:      "100dvh",
      background:     C.bg,
      display:        "flex",
      flexDirection:  "column",
      padding:        "env(safe-area-inset-top, 0px) env(safe-area-inset-right, 16px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 16px)",
      boxSizing:      "border-box",
    }}>

      {/* Top bar — minimal */}
      <div style={{
        display:        "flex",
        alignItems:     "center",
        justifyContent: "space-between",
        padding:        "16px 4px 12px",
        flexShrink:     0,
      }}>
        <span style={{
          fontFamily:  "Georgia, serif",
          fontStyle:   "italic",
          fontSize:    15,
          color:       C.goldMid,
          letterSpacing: "0.02em",
        }}>
          Thought Biography
        </span>

        {onOpenApp && (
          <button
            onClick={onOpenApp}
            style={{
              background:  "none",
              border:      "none",
              color:       C.textMuted,
              fontSize:    13,
              cursor:      "pointer",
              padding:     "4px 0",
              fontFamily:  "Georgia, serif",
              fontStyle:   "italic",
            }}
          >
            Open app →
          </button>
        )}
      </div>

      {/* Textarea — takes all remaining space */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        placeholder="What are you thinking?"
        style={{
          flex:        1,
          width:       "100%",
          background:  "transparent",
          border:      "none",
          outline:     "none",
          resize:      "none",
          color:       C.text,
          fontFamily:  "Georgia, 'Times New Roman', serif",
          fontSize:    "clamp(17px, 4.5vw, 21px)",
          lineHeight:  1.75,
          padding:     "8px 4px 24px",
          boxSizing:   "border-box",
          caretColor:  C.gold,
          WebkitAppearance: "none",
        }}
        spellCheck
        autoCorrect="on"
        autoCapitalize="sentences"
      />

      {/* Bottom bar — status + save button */}
      <div style={{
        display:        "flex",
        alignItems:     "center",
        justifyContent: "space-between",
        padding:        "12px 4px calc(16px + env(safe-area-inset-bottom, 0px))",
        flexShrink:     0,
        borderTop:      `1px solid ${C.border}`,
      }}>

        <span style={{
          fontSize:    13,
          color:       statusColor,
          fontFamily:  "Georgia, serif",
          fontStyle:   "italic",
          transition:  "color 0.2s",
        }}>
          {statusLabel}
        </span>

        <button
          onClick={handleSave}
          disabled={!canSave}
          style={{
            background:    canSave ? C.gold : "transparent",
            color:         canSave ? C.bg   : C.textMuted,
            border:        `1px solid ${canSave ? C.gold : C.border}`,
            borderRadius:  6,
            padding:       "10px 24px",
            fontSize:      15,
            fontFamily:    "Georgia, serif",
            cursor:        canSave ? "pointer" : "default",
            transition:    "all 0.15s",
            fontWeight:    canSave ? 500 : 400,
            letterSpacing: "0.01em",
            minWidth:      88,
            opacity:       status === "saving" ? 0.6 : 1,
          }}
        >
          {status === "saving" ? "Saving…" : "Save"}
        </button>
      </div>

      {/* Offline indicator strip */}
      {!isOnline && (
        <div style={{
          position:   "fixed",
          top:        0,
          left:       0,
          right:      0,
          background: "rgba(200,169,110,0.12)",
          borderBottom: `1px solid ${C.border}`,
          color:      C.gold,
          fontSize:   12,
          textAlign:  "center",
          padding:    "6px",
          fontFamily: "Georgia, serif",
          fontStyle:  "italic",
          zIndex:     100,
        }}>
          Offline — entries will sync when you reconnect
        </div>
      )}
    </div>
  );
}

// ── Offline queue via IndexedDB ───────────────────────────────────────────────
async function queueOffline(content) {
  try {
    const db = await openOfflineDB();
    const tx = db.transaction("pending_entries", "readwrite");
    tx.objectStore("pending_entries").add({
      id:      crypto.randomUUID(),
      content,
      source:  "capture",
      token:   AuthStorage.getAccess() || "",
      queued_at: new Date().toISOString(),
    });
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });

    // Register background sync if supported
    if ("serviceWorker" in navigator && "SyncManager" in window) {
      const reg = await navigator.serviceWorker.ready;
      await reg.sync.register("sync-entries");
    }
  } catch (e) {
    console.error("[Capture] Failed to queue offline entry:", e);
  }
}

function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("thought-bio-offline", 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("pending_entries")) {
        db.createObjectStore("pending_entries", { keyPath: "id" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

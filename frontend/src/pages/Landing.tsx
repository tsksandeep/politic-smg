import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";

// Public, single-tenant gated-entry hero for Politic — "Cinematic War Room".
// Full-bleed brand video, colour-graded toward a serious ops-console look, with an
// authoritative grotesk headline and a live-status HUD overlaid on top. Pure inline
// styles + the small CSS block in index.css; no UI framework.

const CLASH = "'Clash Display', ui-sans-serif, system-ui, sans-serif";
const SATOSHI = "'Satoshi', ui-sans-serif, system-ui, sans-serif";
const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
const EMBER = "#FF5A36";

const footLink: CSSProperties = {
  color: "rgba(255,255,255,0.55)",
  fontFamily: MONO,
  fontSize: 12,
  letterSpacing: "0.04em",
  textDecoration: "none",
};

type SignInStatus = "idle" | "sending" | "sent" | "error";

export default function Landing() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<SignInStatus>("idle");
  const stageRef = useRef<HTMLDivElement>(null);

  // Single-tenant gated entry. Real auth is a Supabase magic link (OTP) to the party email.
  // The Supabase client is imported lazily on submit so this public landing chunk renders
  // without VITE_SUPABASE_* at module load. The link returns the user to /board, where
  // RequireAuth completes the session from the URL.
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || status === "sending") return;
    setStatus("sending");
    try {
      const { supabase } = await import("../services/supabase");
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        // Invite-only: never create a user from the public page; only provisioned party
        // users receive a login link (unknown emails are silently rejected server-side).
        options: { emailRedirectTo: `${window.location.origin}/board`, shouldCreateUser: false },
      });
      setStatus(error ? "error" : "sent");
    } catch {
      setStatus("error");
    }
  };

  // Staggered intro reveal (disabled under prefers-reduced-motion via CSS).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => stage.classList.add("is-in")),
    );
    const t = window.setTimeout(() => stage.classList.add("is-in"), 600);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, []);

  // Robust muted autoplay across browsers.
  const setVideo = (el: HTMLVideoElement | null) => {
    if (!el) return;
    el.muted = true;
    el.defaultMuted = true;
    el.loop = true;
    el.playsInline = true;
    const tryPlay = () => {
      const p = el.play();
      if (p && p.catch) p.catch(() => {});
    };
    tryPlay();
    el.addEventListener("loadeddata", tryPlay, { once: true });
    el.addEventListener("canplay", tryPlay, { once: true });
  };

  return (
    <div style={{ background: "#FFFFFF", padding: 24 }}>
      <div
        ref={stageRef}
        className="hero-stage"
        style={{
          position: "relative",
          width: "100%",
          height: "calc(100vh - 48px)",
          overflow: "hidden",
          background: "#05070d",
          borderRadius: 28,
          border: "1px solid rgba(0,0,0,0.05)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.18)",
        }}
      >
        <video
          ref={setVideo}
          aria-hidden="true"
          src="/media/hero_clean.mp4"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            zIndex: 0,
            // Colour-grade: desaturate + darken so the brand video reads as a serious
            // intelligence feed rather than a glossy promo reel.
            filter: "grayscale(0.5) contrast(1.08) brightness(0.6) saturate(0.85)",
            background: "linear-gradient(135deg,#0b1024 0%,#141b33 55%,#7a2417 140%)",
          }}
        />

        {/* Cool navy multiply grade — pushes the footage toward the ops-console palette */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            mixBlendMode: "multiply",
            background:
              "linear-gradient(160deg, rgba(7,12,28,0.55) 0%, rgba(9,13,26,0.35) 45%, rgba(5,7,13,0.85) 100%)",
          }}
        />

        {/* Cinematic vignette + bottom legibility scrim */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 2,
            background:
              "radial-gradient(120% 100% at 30% 28%, rgba(0,0,0,0) 38%, rgba(0,0,0,0.55) 100%), linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 46%, rgba(5,7,13,0.92) 100%)",
          }}
        />

        {/* Faint ember glow anchoring the lower-left where the headline sits */}
        <div
          aria-hidden="true"
          className="ember-glow"
          style={{
            position: "absolute",
            left: "-10%",
            bottom: "-20%",
            width: "60%",
            height: "70%",
            zIndex: 3,
            pointerEvents: "none",
            background: "radial-gradient(closest-side, rgba(255,90,54,0.16), rgba(255,90,54,0))",
          }}
        />

        {/* Film grain */}
        <div
          aria-hidden="true"
          className="grain"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 5,
            pointerEvents: "none",
            opacity: 0.05,
          }}
        />

        {/* Top nav: wordmark + live status (left) · party-email sign-in (right) */}
        <nav
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 20,
            padding: "24px 64px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 24,
            }}
          >
            <span
              style={{
                fontFamily: CLASH,
                fontSize: 24,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: "#ffffff",
              }}
            >
              Politic
            </span>

            <form onSubmit={onSubmit} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <label htmlFor="party-email" className="sr-only">
                Party email
              </label>
              <div
                className="email-field"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: 260,
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.18)",
                  borderRadius: 9999,
                  padding: "0 18px",
                  height: 44,
                  backdropFilter: "blur(8px)",
                  WebkitBackdropFilter: "blur(8px)",
                }}
              >
                <svg
                  aria-hidden="true"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="rgba(255,255,255,0.65)"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ flexShrink: 0 }}
                >
                  <rect width="20" height="16" x="2" y="4" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
                <input
                  id="party-email"
                  type="email"
                  required
                  autoComplete="email"
                  className="glass-input"
                  placeholder="you@yourparty.in"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    color: "#ffffff",
                    fontSize: 15,
                    fontFamily: SATOSHI,
                  }}
                />
              </div>
              <button
                type="submit"
                className="signin-btn"
                disabled={status === "sending"}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  minHeight: 44,
                  background: "#D6492E",
                  color: "#ffffff",
                  fontSize: 15,
                  fontWeight: 700,
                  padding: "0 8px 0 20px",
                  border: "none",
                  borderRadius: 9999,
                  cursor: status === "sending" ? "wait" : "pointer",
                  opacity: status === "sending" ? 0.7 : 1,
                  fontFamily: SATOSHI,
                }}
              >
                {status === "sending" ? "Sending…" : "Enter war room"}
                <span
                  className="arrow-circle"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#ffffff",
                    borderRadius: 9999,
                    padding: 6,
                  }}
                >
                  <svg
                    aria-hidden="true"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#D6492E"
                    strokeWidth={2.4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                </span>
              </button>
            </form>
          </div>
          {status !== "idle" && (
            <p
              role="status"
              style={{
                margin: "10px 0 0",
                textAlign: "right",
                fontFamily: MONO,
                fontSize: 12,
                letterSpacing: "0.02em",
                color: status === "error" ? "#ff8a73" : "rgba(255,255,255,0.78)",
              }}
            >
              {status === "sending"
                ? "Sending secure sign-in link…"
                : status === "sent"
                  ? "Check your party inbox for a secure sign-in link."
                  : "Couldn't send the link. Check the address and try again."}
            </p>
          )}
        </nav>

        {/* Upper-left content block */}
        <div
          style={{
            position: "absolute",
            left: 64,
            top: 120,
            zIndex: 10,
            maxWidth: 540,
            width: "calc(100% - 128px)",
          }}
        >
          <h1
            className="rv rv-1"
            style={{
              color: "#ffffff",
              fontFamily: CLASH,
              fontSize: "clamp(1.75rem, 4.2vw, 3.35rem)",
              fontWeight: 600,
              margin: 0,
              lineHeight: 1.07,
              letterSpacing: "-0.03em",
              textShadow: "0 2px 40px rgba(0,0,0,0.55)",
            }}
          >
            <span style={{ color: EMBER }}>Centralised</span> narrative efficiency tracking of party
            cadres&rsquo; social media accounts.
          </h1>
        </div>

        {/* Posture line + footer links */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 28,
            zIndex: 10,
            padding: "0 64px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 24,
            flexWrap: "wrap",
            fontFamily: MONO,
          }}
        >
          <span
            style={{
              color: "rgba(255,255,255,0.45)",
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            Single-tenant · India data residency · Consent-only observability
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <a href="#" className="footlink" style={footLink}>
              Trust
            </a>
            <a href="#" className="footlink" style={footLink}>
              Docs
            </a>
            <a href="#" className="footlink" style={footLink}>
              Privacy
            </a>
            <a href="#" className="footlink" style={footLink}>
              Status
            </a>
            <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 12 }}>© 2026 Politic</span>
          </div>
        </div>
      </div>
    </div>
  );
}

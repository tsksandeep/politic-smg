# Landing Page Build Spec — OpenPolitics

Build a minimal, institutional-grade **gated-entry hero** for OpenPolitics, using **React +
TypeScript + Vite + Tailwind CSS**, with **lucide-react** for icons. **No other UI libraries.**
Background color of the page is **#ECE9E2**.

> This is **not** a SaaS marketing site. Each tenant's deployment feels bespoke and single-tenant: a
> quiet front door that establishes credibility and lets authorised staff in. There is no pricing
> page, no signup, no feature tour. The page is one screen — a hero with a sign-in entry — plus a thin
> strip of trust/principle copy. Sign-ups are disabled (`config.toml [auth] enable_signup = false`);
> the only action is **Enter the War Room** for staff who already have an account.

## The moat (what the copy must convey, quietly)

The product's edge is **centralised tracking of the opposition cadre's narrative efficiency** — an
**offense-measurement** instrument. It tells a tenant which opposition narratives are working, how
fast, and who is making them work, before they peak. The copy gestures at that capability without
listing features and without ever implying:

- ❌ scraping private/logged-in data, defeating gates, or building dossiers on private citizens;
- ❌ blocking, removing, or controlling anyone's posts;
- ❌ certainty — coordination and amplifier rank are **signals**, never verdicts.

✅ In bounds: "public opposition narratives", "measure what's working against you", "see it forming
before it peaks", "a signal, not a verdict", "your IT-wing strength is your scale".

---

## Flat color palette

A calm "command-surface" palette — warm stone canvas, near-black ink, a deep midnight-slate for the
dark card, and a single ember accent reserved for the live/alert signal. Use the ember sparingly; it
is the only saturated color on the page.

| Token | Hex | Tailwind arbitrary value | Use |
|-------|-----|--------------------------|-----|
| **Canvas** | `#ECE9E2` | `bg-[#ECE9E2]` | Page + all section backgrounds |
| **Ink** | `#141414` | `text-[#141414]` / `bg-[#141414]` | Primary text, logo, primary (black) buttons |
| **Slate** | `#1B2540` | `bg-[#1B2540]` | The dark hero/entry card |
| **Ember** | `#D6492E` | `bg-[#D6492E]` / `text-[#D6492E]` | "Live" pulse dot + tiny accents only |
| **Muted ink** | `text-black/70`, `text-black/60` | — | Body copy on canvas |
| **Muted light** | `text-white/60` | — | Body copy on the Slate card |

Headings use **negative letter-spacing**. Heaviest weight throughout is **font-medium (600)**.

## Global setup
- Primary font **TT Norms Pro** via `@font-face` (`/fonts/tt-norms-pro-regular.woff2` weight 400,
  `/fonts/tt-norms-pro-semibold.woff2` weight 600, `font-display: swap`), applied to `html`, `body`,
  and inherited on `*`.
- Tailwind `base` + `components` + `utilities` at the top of `src/index.css`.
- Page wrapper `flex flex-col bg-[#ECE9E2]`; the hero is wrapped in `h-screen flex flex-col
  overflow-hidden`. Inner content max width `max-w-[88rem] mx-auto`.

## Logo
`LogoIcon` SVG using `currentColor`, `viewBox 0 0 256 256` — an **early-warning pulse**: a solid
signal node radiating two fading rings (a narrative detected and rippling outward). Reads at 28px.

```tsx
export function LogoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 256" className={className} fill="none"
         xmlns="http://www.w3.org/2000/svg">
      <circle cx="128" cy="128" r="34" fill="currentColor" />
      <circle cx="128" cy="128" r="74"  stroke="currentColor" strokeWidth="16" opacity="0.5" />
      <circle cx="128" cy="128" r="116" stroke="currentColor" strokeWidth="16" opacity="0.22" />
    </svg>
  );
}
```

---

## 1. Navbar (absolute, transparent over hero)
- `nav` is `absolute top-0 left-0 right-0 z-20 px-6 py-5`; inner row `flex items-center
  justify-between`.
- **Left:** `LogoIcon` (`w-7 h-7`, Ink) + word **"OpenPolitics"** (`text-2xl font-medium
  tracking-tight text-[#141414]`).
- **Right:** a small live indicator + the primary pill in `flex items-center gap-4`:
  - **Live indicator** (hidden below `sm`): `inline-flex items-center gap-2 text-sm text-gray-600
    font-medium` — a `w-2 h-2 rounded-full bg-[#D6492E]` dot with `animate-pulse`, then **"Live"**.
  - **Pill button "Enter the War Room"** — `bg-[#141414] text-white text-base font-medium px-7 py-2.5
    rounded-full hover:bg-gray-800 transition-colors duration-200`. Routes to the sign-in screen.
- **No center nav links** — this is a single-screen front door, not a multi-section site.

## 2. Hero / entry card
- Outer: `flex-1 px-6 pt-20 pb-6 flex items-end`.
- Inner card: `relative w-full rounded-2xl overflow-hidden`, `style={{ height: 'calc(100vh - 96px)',
  background: 'linear-gradient(135deg,#1B2540 0%,#2B3A63 55%,#D6492E 140%)' }}`. An optional
  `/media/hero-warroom.mp4` background video (`autoplay muted loop playsInline`,
  `poster="/media/hero-poster.jpg"`, `object-cover absolute inset-0 w-full h-full`) overlays the
  gradient; the gradient is the fallback if media is absent.
- **Content overlay:** `relative z-10 flex flex-col items-start justify-start h-full p-12 pt-36`, text
  **white** over the dark backdrop.
  - **h1:** `"Measure what they're\npushing."` (with `<br/>`) — `text-white text-5xl md:text-6xl
    font-medium leading-tight max-w-2xl mb-4`, inline `letterSpacing: '-0.04em'`.
  - **p:** **"Centralised intelligence on the opposition's public narratives — what they push, how it
    rises and decays, when it's coordinated, and who makes it work. See a narrative forming before it
    peaks. Every signal carries its confidence; none is a verdict."** — `text-white/70 text-base
    md:text-lg max-w-md mb-8 leading-relaxed`.
  - **Pill button "Enter the War Room"** with arrow circle: `inline-flex items-center gap-3 bg-white
    text-[#141414] text-base md:text-lg font-medium pl-8 pr-2 py-2 rounded-full hover:bg-gray-100
    transition-colors duration-200`; trailing arrow inside `bg-[#141414] rounded-full p-2` with
    `ArrowRight w-5 h-5 text-white` from `lucide-react`. This is the **only** call to action.
- Below the button, the **principles strip**.

### Principles strip (inside hero, below the button)
A quiet marquee of the platform's governing principles — establishes that the posture is enforced,
not promised. Same marquee pattern (duplicated track, `0 → -50%`, ~26s linear infinite),
`mx-7 shrink-0 text-white/60 whitespace-nowrap`:

- **Public-Data-Only** · **Logged-Out Capture** · **Tenant Isolation** · **Honest Signals** ·
  **Coordination Inferred** · **Author Hashing** · **Transcribe-then-Discard** · **India Residency** ·
  **Your IT-Wing is Your Scale**

Each rendered with a distinct inline font/weight/letter-spacing for the typographic-ticker feel, the
list duplicated so it loops seamlessly.

## 3. Sign-in screen (the gate)
Reached from either "Enter the War Room" button. A centered card on the same `#ECE9E2` canvas:
- `LogoIcon` + "OpenPolitics" wordmark.
- One email field + **"Send magic link"** (`bg-[#141414] text-white rounded-full`), calling Supabase
  `signInWithOtp`. No password, no "create account" — staff are provisioned by their tenant Admin.
- Helper line: **"Authorised staff only. Access is provisioned by your organisation's administrator."**
- On success: **"Check your email for a sign-in link."** The link returns to the war-room board, where
  `RequireAuth` establishes the session and `current_tenant()` scopes everything to the tenant.

---

## Animations
- One CSS keyframe marquee (~26s) for the principles strip, translating `0 → -50%` on a duplicated
  track.
- A small ember **"Live"** dot in the navbar with a soft `animate-pulse` — the only motion on the
  ember accent.
- All buttons `transition-colors duration-200`; dark pills hover `hover:bg-gray-800`; the white hero
  pill hovers `hover:bg-gray-100`.

## Composition
`App` renders, in order:
1. `h-screen overflow-hidden` wrapper containing **Navbar** (absolute) + **HeroSection** (with the
   principles strip).
2. **SignInScreen** (routed; the gate).

All backgrounds **#ECE9E2**; headings use negative letter-spacing; heaviest weight **font-medium
(600)**; the only saturated color anywhere is ember **#D6492E**, reserved for the live signal.

---

## Copy guardrails (constitution-faithful)
The page is read by a political organisation that must trust the posture — keep language inside the
constitutional perimeter:

- ✅ "public opposition narratives", "measure what's working against you", "see it forming before it
  peaks", "a **signal**, not a verdict", "coordination **inferred**", "authorised staff only".
- ❌ Never say or imply: logged-in scraping, defeating private gates, profiling private citizens,
  building dossiers, blocking/removing posts, or certainty about coordination or amplifier rank.

These mirror Principles **I–V** and **FR-001/002/007/011/013** in `specs/001-opposition-intel/`.

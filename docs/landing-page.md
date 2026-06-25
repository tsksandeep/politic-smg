# Landing Page Build Spec — Politic War Room

Build a premium, institutional-grade landing page for **Politic**, a consent-only social
war-room cockpit for political parties, using **React + TypeScript + Vite + Tailwind CSS**, with
**lucide-react** for icons. **No other UI libraries.** Background color of the page is **#ECE9E2**.

> This is the marketing/demo surface for the platform described in
> `specs/001-rapid-response/`. The page is a pitch artifact, not the war-room app itself — copy
> must stay faithful to the constitution (`/​.specify/memory/constitution.md`): consent-only,
> privacy-by-minimization, observability-not-control, honest signals. Never imply scraping,
> dossiers, opposition surveillance, or the ability to block/remove posts.

---

## Flat color palette (curated for Politic)

A calm "command-surface" palette — warm stone canvas, near-black ink, a deep midnight-slate for
the dark cards, and a single ember accent reserved for the live/alert signal. Use the ember
sparingly; it is the only saturated color on the page.

| Token | Hex | Tailwind arbitrary value | Use |
|-------|-----|--------------------------|-----|
| **Canvas** | `#ECE9E2` | `bg-[#ECE9E2]` | Page + all section backgrounds |
| **Ink** | `#141414` | `text-[#141414]` / `bg-[#141414]` | Primary text, logo, primary (black) buttons |
| **Slate** | `#1B2540` | `bg-[#1B2540]` | Dark info cards (replaces the fintech `#2B2644`) |
| **Ember** | `#D6492E` | `bg-[#D6492E]` / `text-[#D6492E]` | "Live" pulse dot + tiny accents only |
| **Muted ink** | `text-black/70`, `text-black/60` | — | Body copy on canvas |
| **Muted light** | `text-white/60` | — | Body copy on Slate cards |

Where the original used pure `black`, you may use Ink `#141414`. Headings use **negative
letter-spacing** for the tight, modern feel. Heaviest weight throughout is **font-medium (600)**.

---

## Global Setup

- Use **TT Norms Pro** as the primary font, loaded via `@font-face` from
  `/fonts/tt-norms-pro-regular.woff2` (weight 400) and `/fonts/tt-norms-pro-semibold.woff2`
  (weight 600), with `font-display: swap`. Apply it to `html`, `body`, and `inherit` on `*`.
- Tailwind `base` + `components` + `utilities` at the top of `src/index.css`.
- Page wrapper: `flex flex-col bg-[#ECE9E2]`. The first section (Navbar + Hero) is wrapped in a
  `h-screen flex flex-col overflow-hidden` container.
- Inner content max width across sections: `max-w-[88rem] mx-auto`.

```css
/* src/index.css (top of file) */
@tailwind base;
@tailwind components;
@tailwind utilities;

@font-face {
  font-family: 'TT Norms Pro';
  src: url('/fonts/tt-norms-pro-regular.woff2') format('woff2');
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: 'TT Norms Pro';
  src: url('/fonts/tt-norms-pro-semibold.woff2') format('woff2');
  font-weight: 600;
  font-display: swap;
}
html, body { font-family: 'TT Norms Pro', ui-sans-serif, system-ui, sans-serif; }
* { font-family: inherit; }
```

### Asset checklist (replace placeholders before launch)

The original Halo spec hot-linked hosted CloudFront media. For Politic, supply your own assets
under `frontend/public/media/` and reference them with root-absolute paths. Until they exist, the
specified **CSS gradient/solid fallbacks render underneath**, so the page never shows a blank box.

| Slot | Path | Fallback (renders if missing) |
|------|------|-------------------------------|
| Hero background video | `/media/hero-warroom.mp4` (poster `/media/hero-poster.jpg`) | `linear-gradient(135deg,#1B2540 0%,#2B3A63 55%,#D6492E 140%)` |
| Info Card 1 background image | `/media/card-alerts.jpg` | solid `#1B2540` |
| Use Cases background video | `/media/usecase-rapid-response.mp4` | `linear-gradient(160deg,#141414 0%,#1B2540 70%)` |

Put the gradient/solid on the card element itself (`style={{ background: '<fallback>' }}`) and lay
the `<video>`/`backgroundImage` over it; if the media fails to load, the fallback shows through.

---

## Custom Logo Icon

Create an SVG component `LogoIcon` using `currentColor`, `viewBox 0 0 256 256`. The Politic mark is
an **early-warning pulse** — a solid signal node radiating two fading rings (a narrative detected
and rippling outward). Clean, geometric, reads at 28px.

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

(Because it uses `currentColor`, it renders black in the navbar and white on a dark card.)

---

## 1. Navbar (absolute, transparent over hero)

- `nav` is `absolute top-0 left-0 right-0 z-20 px-6 py-5`.
- Inner row: `flex items-center justify-between`.
- **Left:** `LogoIcon` (`w-7 h-7`, Ink) + word **"Politic"** (`text-2xl font-medium tracking-tight
  text-[#141414]`).
- **Center** (hidden below `md`): links **Detection · War Room · Onboarding · Trust · Docs**,
  `gap-8`, `text-base text-gray-700 hover:text-black font-medium transition-colors duration-200`.
- **Right:** a small live indicator + the primary pill, in a `flex items-center gap-4` row:
  - **Live indicator** (hidden below `sm`): `inline-flex items-center gap-2 text-sm text-gray-600
    font-medium` — a `w-2 h-2 rounded-full bg-[#D6492E]` dot with a soft pulse
    (`animate-pulse`), followed by the word **"Live"**. This signals the real-time board.
  - **Pill button "Open War Room"** — `bg-[#141414] text-white text-base font-medium px-7 py-2.5
    rounded-full hover:bg-gray-800 transition-colors duration-200`.

---

## 2. Hero Section

- Outer: `flex-1 px-6 pt-20 pb-6 flex items-end`.
- Inner card: `relative w-full rounded-2xl overflow-hidden`, inline style `height: calc(100vh -
  96px)`, plus the fallback background:
  `style={{ height: 'calc(100vh - 96px)', background: 'linear-gradient(135deg,#1B2540 0%,#2B3A63 55%,#D6492E 140%)' }}`.
- **Background video** (`autoplay`, `muted`, `loop`, `playsInline`, `poster="/media/hero-poster.jpg"`,
  `object-cover absolute inset-0 w-full h-full`):
  `/media/hero-warroom.mp4`
- **Content overlay:** `relative z-10 flex flex-col items-start justify-start h-full p-12 pt-36`.
  Because the hero background is dark, hero text is **white** here (the original used black over a
  light video — invert for our slate/ember footage).
  - **h1:** `"Outrun the\nNarrative"` (with `<br/>`) — `text-white text-5xl md:text-6xl
    font-medium leading-tight max-w-2xl mb-4`, inline `letterSpacing: '-0.04em'`.
  - **p:** `"A consent-only war room that detects rising anti-party narratives and coordinated
    trolling on your cadres' own posts — and surfaces them within fifteen minutes, so you respond
    before they peak."` — `text-white/70 text-base md:text-lg max-w-md mb-8 leading-relaxed`,
    inline `fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif"`.
  - **Pill button "Request a demo"** with arrow circle: `inline-flex items-center gap-3
    bg-white text-[#141414] text-base md:text-lg font-medium pl-8 pr-2 py-2 rounded-full
    hover:bg-gray-100 transition-colors duration-200`. Trailing arrow inside `bg-[#141414]
    rounded-full p-2`, using `ArrowRight w-5 h-5 text-white` from `lucide-react`.
    (On a dark hero, the button inverts: white pill, dark arrow circle.)
- Followed by the **Built-On Marquee** below.

### Built-On Marquee (inside hero, below button)

A truthful "works with / built on" strip — the consented sources and the stack. Replaces Halo's
crypto-brand row.

- Container: `mt-24 w-full max-w-md overflow-hidden`.
- Inject a scoped `<style>` with keyframes `marquee` translating `0 → -50%`, applied to
  `.marquee-track { display:flex; width:max-content; animation: marquee 22s linear infinite; }`.
- Render the brand list **twice** (so it loops seamlessly).
- Each item: `mx-7 shrink-0 text-white/60 whitespace-nowrap` (white-tinted, since the hero is
  dark) with these inline styles:
  - **Instagram** — Georgia serif, weight 700, `letterSpacing -0.02em`, `fontSize 15px`
  - **YouTube** — Arial sans, weight 900, `letterSpacing 0.08em`, `fontSize 13px`, uppercase
  - **Supabase** — Trebuchet MS, weight 600, `letterSpacing 0.01em`, `fontSize 15px`
  - **Postgres** — Courier New monospace, weight 700, `letterSpacing 0.12em`, `fontSize 13px`,
    uppercase
  - **pgvector** — Palatino, Book Antiqua, weight 400, `letterSpacing -0.01em`, `fontSize 16px`
  - **OpenRouter** — Impact, Arial Narrow, weight 400, `letterSpacing 0.04em`, `fontSize 14px`
  - **Gemini** — Verdana, weight 700, `letterSpacing -0.03em`, `fontSize 13px`

---

## 3. Info Section ("Meet the War Room.")

- `section bg-[#ECE9E2] px-6 py-24`.
- **Row 1:** 2-col grid (`grid-cols-1 md:grid-cols-2 gap-12 mb-16 items-start`).
  - **Left:** `h2` **"Meet the War Room."** — `text-[#141414] text-4xl md:text-5xl font-medium
    leading-tight mb-8`, `letterSpacing -0.03em`. Below it, a black pill **"See it live"** button
    with a white arrow circle (same pattern as "Request a demo", but `text-base` and the
    standard dark-on-light variant: `bg-[#141414] text-white` pill, `bg-white` arrow circle with
    `ArrowRight ... text-black`).
  - **Right:** paragraph **"The war room turns thousands of comments on your cadres' own posts
    into a handful of narratives worth your attention — each one carrying a confidence signal,
    never asserted as fact."** — `text-black/70 text-2xl md:text-3xl leading-relaxed`.
- **Row 2 — 4-col card grid** (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4`):
  - **Card 1** (spans 2 cols on `lg`: `lg:col-span-2`): `rounded-2xl` with `style={{
    backgroundImage: "url('/media/card-alerts.jpg')", backgroundColor: '#1B2540',
    backgroundSize: 'cover', backgroundPosition: 'center' }}`. Inside: `p-7 min-h-80 flex flex-col
    justify-between`. **Title (top):** **"Alerts that arrive early"** — `text-white text-2xl
    font-medium leading-snug` `letterSpacing -0.02em`. **Body (bottom):** **"A coordinated
    hostile burst surfaces as one clear alert — theme, scale, and growth rate — within fifteen
    minutes of the surge beginning."** — `text-white/70 text-base max-w-xs`.
    (Text is white because the image/`#1B2540` backdrop is dark.)
  - **Card 2:** solid `#1B2540`, `rounded-2xl`, `p-7`, `min-h-80`, `flex flex-col justify-between`.
    White heading **"Consent-only,\nby design."** `text-white text-2xl font-medium`, body **"Data
    enters only through a cadre's own OAuth grant. Revoke anytime — ingestion stops immediately and
    derived data purges on schedule."** `text-white/60 text-base`.
  - **Card 3:** same `#1B2540` styling. Heading **"Patterns,\nnot people."** Body **"Commenter
    identities are hashed before storage and raw text is deleted after thirty days. We detect
    coordination — we never build dossiers."**

---

## 4. Backed By Section → "Principled By" (marquee row)

Politic is bespoke and single-party — it isn't VC-backed, so this section is reframed around the
**seven non-negotiable constitution principles**. The marquee becomes the principles themselves.

- `section bg-[#ECE9E2] px-6` with inner `max-w-[88rem] mx-auto grid grid-cols-1 md:grid-cols-4
  gap-8 items-center`.
- **Left col (1/4):** `text-black/70 text-base leading-relaxed` — **"Governed by seven
  non-negotiable principles —\nenforced in code, not just promised."**
- **Right col (3/4):** infinite marquee (same pattern as the hero marquee but `30s linear
  infinite`, class `.backers-track`, keyframes `backers-marquee`). Items use `mx-10 shrink-0
  text-black/50 whitespace-nowrap` with these inline styles:
  - **Consent-Only** — Times New Roman serif, 400, `ls 0.02em`, `14px`
  - **Own-Content Boundary** — Arial Black, 900, `ls 0.08em`, `16px`
  - **Privacy by Minimization** — Impact, 700, `ls 0.05em`, `18px`
  - **Observability not Control** — Georgia, 600, `ls -0.02em`, `17px`
  - **Honest Signals** — Helvetica, 700, `ls -0.01em`, `15px`
  - **Single-Tenant Isolation** — Verdana, 700, `ls 0.06em`, `14px`, uppercase
  - **Platform Discipline** — Courier New, 700, `ls 0.18em`, `14px`
  - **India Data Residency** — Palatino, 500, `ls 0.03em`, `15px`
- Render brands **twice** for the loop.

---

## 5. Use Cases Section

- `section bg-[#ECE9E2] px-6 py-24`. Inner: 2-col grid `grid-cols-1 md:grid-cols-2 gap-8
  items-start`.
- **Left column** (`md:pr-12 md:pt-2`):
  - Eyebrow: **"Politic in practice"** — `text-black/60 text-sm mb-2`.
  - `h2` **"Use modes"** — `text-5xl md:text-6xl font-medium leading-none mb-6`, `ls -0.04em`.
  - Paragraph: **"One consented dataset, many war rooms — for party comms teams, regional
    analysts, and rapid-response units who need to see a coordinated attack forming before it
    peaks."** — `text-black/60 text-base leading-relaxed max-w-sm`.
- **Right column:** large `relative rounded-3xl overflow-hidden min-h-[720px]` with `style={{
  background: 'linear-gradient(160deg,#141414 0%,#1B2540 70%)' }}` fallback and a background video
  (`autoplay`/`muted`/`loop`/`playsInline`, `object-cover absolute inset-0`):
  `/media/usecase-rapid-response.mp4`
  - **Overlay content** `relative z-10 p-10 md:p-12` (white text over the dark footage):
    - `h3` **"Rapid Response"** — `text-white text-4xl md:text-5xl font-medium leading-tight mb-5`,
      `ls -0.03em`.
    - Paragraph: **"When a coordinated attack starts building on your cadres' posts, an analyst
      reads the narrative, its scale, and where it's concentrated in under thirty seconds — then
      acknowledges, assigns, and logs the counter-response, all on one live board."** —
      `text-white/70 text-base max-w-md mb-8`.
    - Inline-flex link **"Know more"** (`group inline-flex items-center gap-3 text-white
      font-medium`) with a leading circular icon: `w-9 h-9 rounded-full bg-white/80 backdrop-blur
      flex items-center justify-center group-hover:bg-white transition-colors` containing
      `ArrowRight w-4 h-4 text-black`.

---

## Animations & Interactions

- Two CSS keyframe marquees (**22s** for the hero Built-On strip, **30s** for the principles row),
  both translating `0 → -50%` on a **duplicated track** for seamless looping.
- A small **ember "Live" dot** in the navbar uses a soft `animate-pulse` to convey the real-time
  board (the only motion on the ember accent).
- All buttons use `transition-colors duration-200`. Dark pills hover `hover:bg-gray-800`; the
  inverted white hero pill hovers `hover:bg-gray-100`; the white arrow circle hovers
  `hover:bg-white`.
- Nav links transition on hover from `text-gray-700` to `text-black`.
- Videos `autoplay muted` with `playsInline` for mobile compatibility, and each carries a poster +
  CSS fallback so the layout holds if media is absent.

---

## Composition

`App` renders, in order:

1. `h-screen overflow-hidden` wrapper containing **Navbar** (absolute) + **HeroSection**.
2. **InfoSection**
3. **PrincipledBySection** (the reframed "Backed By")
4. **UseCasesSection**

All section backgrounds are **#ECE9E2**. All headings use **negative letter-spacing** for the
tight, modern feel. Use **font-medium (600)** as the heaviest weight throughout. The only saturated
color anywhere is the **ember `#D6492E`**, reserved for the live/alert signal.

---

## Copy guardrails (constitution-faithful)

Keep marketing language inside the constitutional perimeter — the page is read by a party that
must trust the privacy posture:

- ✅ "on your cadres' **own** posts", "consent-only", "revoke anytime", "hashed before storage",
  "deleted after thirty days", "a **signal**, not a verdict", "respond before it peaks".
- ❌ Never say or imply: scraping, monitoring opposition accounts, identifying individuals,
  building profiles/dossiers, **blocking/removing** posts, or guaranteeing certainty on
  public-vs-opposition classification.

These mirror principles **I–V** and **FR-004/008/009/011/012** in `specs/001-rapid-response/`.

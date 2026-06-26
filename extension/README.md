# OpenPolitics Node — MV3 Browser-Extension Capture Client

The volunteer **IT-wing node** for an OpenPolitics tenant. It captures **public, logged-out**
Instagram data over the operator's residential IP and submits the normalised result to the tenant's
coordinator. It is a self-hosted **enterprise** extension (no Chrome Web Store), installed per
tenant onto trusted volunteers' machines.

This client is deliberately **dumb**: it captures public data and ships it one-way. It holds no
analytics, no tenant data beyond its current lease, and makes no narrative judgements. All analysis
lives server-side.

---

## The volunteer-safety design (Principles II & IV)

> **This extension never touches the operator's Instagram login.** That is the load-bearing safety
> property, and it is enforced structurally, not by good intentions.

### How guest-session isolation is achieved in MV3

Capture happens inside a **dedicated incognito browser window** that the node creates once and
reuses (created minimized + unfocused so it never disturbs the operator):

1. **Separate cookie jar.** An incognito context has its own ephemeral cookie store, completely
   separate from the operator's normal-profile cookies — where any Instagram login lives. The node
   therefore *cannot* read or send the operator's IG session cookies; they don't exist in the
   incognito store.
2. **In-page same-origin fetch.** The capture logic is injected into the incognito instagram.com
   tab with `chrome.scripting.executeScript`. A `fetch()` from that tab is **same-origin**, so it
   bypasses CORS with no host trickery, and uses **only** the incognito guest cookies (a logged-out
   session warmed by reload).
3. **Cold jar, every time.** Before *and* after each capture the node purges instagram.com cookies
   from the incognito store (`chrome.cookies`, scoped to that store id). Each capture starts cold
   and leaves nothing behind. Incognito cookies are discarded by the browser on window close anyway.
4. **No login, ever.** The node never calls a login/auth endpoint, never reads the **normal**
   profile cookie store, and never stores credentials. `host_permissions` cover only instagram.com
   plus the operator-entered coordinator origin.

**Why this protects the operator:** even if the operator is logged into Instagram in their everyday
browsing, that session sits in a different cookie store the node has no code path to. If a guest IP
is rate-limited, only an anonymous logged-out session is implicated — never the operator's identity
or account.

Other safety guarantees:

- **Capped + jittered rates** — every request is paced by `min_interval_ms + random(jitter_ms)`, and
  a hard `max_requests_per_day` cap (both set by the coordinator). Scale is horizontal (more nodes),
  never faster requests.
- **One-way egress** — the node only ever POSTs to the coordinator. There is no inbound channel and
  no remote code execution.
- **Public-only** — private accounts/posts are detected and dropped; the node never defeats a gate.
- **Graceful degradation** — a persistent `401` is treated as "this IP is burned": the node reports
  `ip_status: "blocked"`, backs off, and the coordinator re-leases the work to another node. Coverage
  gaps surface; the node never silently under-reports.

---

## The capture path (ported from the proven prototype)

This ports `backend/scrapers/instagram/scrape_profile.py` (live-verified June 2026) into MV3:

1. Open the public profile/post in the incognito guest tab.
2. **Warm the guest session.** The first data XHR returns `401` on a *cold* session; a page
   **reload** (a real navigation, not a wait) re-establishes it → `200`. The node retries with
   reload until warm, up to a budget; exhausting the budget ⇒ IP burned.
3. **Read profile metadata** from `/api/v1/users/web_profile_info/?username=…` (warm cookies +
   `x-ig-app-id: 936619743392459`).
4. **Paginate posts** via `/api/v1/feed/user/{uid}/?count=30&max_id=<cursor>` — a `max_id` cursor
   API, nothing to rotate. For rapid response the node pulls only the newest pages
   (`ACCOUNT_FEED_PAGES`).
5. **Post metrics** (velocity re-sampling) via `/api/v1/media/{media_id}/info/`, and **comments**
   via `/api/v1/media/{media_id}/comments/`. `media_id` is derived from the shortcode locally.

Each captured post carries: `shortcode`, `is_video`, `caption`, `audio_id`, `taken_at`, `permalink`,
`like_count`, `comment_count`, `view_count`, `media_url`. (`media_url` is transient — the coordinator
clears it once the media worker emits a transcript; the node never warehouses media bytes.)

> **Comment authors:** the node sends **raw** public comment handles. This is intentional and
> minimal — the coordinator HMAC-hashes each handle at ingest and immediately discards the raw value
> (Principle III). The node never persists, logs, or analyses comment authors.

---

## The lease / submit / heartbeat loop

A `chrome.alarm` drives the loop (so it survives service-worker suspension). Each cycle:

1. **`/work-lease`** → a small, rate-capped batch of items scoped to this node's tenant. The
   response may update the node's `rate`.
2. For each item, honouring the daily cap and paced/jittered rate, **capture** by `target_kind`
   (`account` | `post_metrics` | `comments`) and **`/submit`** the normalised payload.
   - On a persistent `401`, stop the batch, mark `ip_status: "blocked"`.
3. **`/heartbeat`** → reports `ok_count` / `error_count` / `ip_status`. The response may set a
   `backoff_ms` (honoured) or report the node `quarantined` (the node then stops and backs off).

All four endpoints authenticate with a **tenant-scoped node token** (`Authorization: Bearer …`),
never a user session. The token is obtained once via `/node-register` with an enrolment code and is
stored only in `chrome.storage.local` (never logged, never shown in the UI).

---

## Build

```bash
cd extension
npm install
npm run build        # -> extension/dist  (load this folder unpacked)
npm run typecheck    # optional: strict tsc --noEmit
npm run dev          # watch mode
```

Output in `dist/`: `manifest.json`, `background.js`, `options.html`, `options.js`, `icon128.png`.

## Sideload (enterprise self-host — no store)

1. `npm run build`.
2. Chrome → `chrome://extensions` → enable **Developer mode**.
3. **Load unpacked** → select `extension/dist`.
4. **Allow in Incognito** must be turned ON for this extension (Details → "Allow in Incognito").
   This is required: capture runs in the isolated incognito guest context.
5. Open the extension **Options** page. Enter the **Coordinator URL**, the **enrolment code** from
   your admin, and a **node label**. Approve the coordinator host-permission prompt. Done — the node
   begins leasing work.

For fleet deployment, distribute `dist/` via your enterprise policy
(`ExtensionInstallForcelist` / `ExtensionSettings`) with the incognito allowance pre-granted.

---

## Legal posture

Public, **logged-out only**. The entire legal posture rests on accessing data that is publicly
available without authenticating into any account (cf. *Meta v. Bright Data*, N.D. Cal. 2024).
Logged-in scraping would forfeit that protection — so this client structurally cannot log in. ToS
and public-data legal risk are explicit and tenant/founder-owned (see `docs/compliance.md`); the
launch jurisdiction profile is India / DPDP.

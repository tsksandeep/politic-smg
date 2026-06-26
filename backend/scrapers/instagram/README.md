# Instagram public scraper — Tier-2 (stealth browser, no login)

Pull a public profile's metadata **and full post/reel history with engagement counts**
without an Instagram account, OAuth, or API key. Built on
[Scrapling](https://github.com/d4vinci/Scrapling)'s `StealthyFetcher` (a stealth
Firefox/Camoufox driven by Playwright).

```bash
pip install "scrapling[fetchers]" && scrapling install   # one-time
python3 scrape_profile.py theeyasakthitn 100              # username, max feed pages
```

Output: prints profile + top posts, writes the full dataset to `ig_harvest.json`.

## How it works (and why it's built this way)

Everything below was established by live probing in June 2026 — Instagram's plain
unauthenticated paths are now dead:

| Path | Result (datacenter IP, no session) |
|---|---|
| `?__a=1&__d=dis` | dead (`201`, empty) |
| `/api/v1/users/web_profile_info/` over plain HTTP | `401 require_login` |
| `/graphql/query` single-post via `doc_id` over plain HTTP | `403 not-logged-in` |
| Profile HTML page | `200`, but the post JSON is stripped — only `og:` meta survives |

So the only thing plain HTTP still yields is the `og:title` / `og:description` meta
(follower / post counts + display name). That's the cheap **Tier-1** signal.

**Tier-2** (this script) gets the real data with four moves:

1. **Open the profile in a stealth browser** so requests carry a believable
   fingerprint + a real guest cookie jar.
2. **Warm the guest session.** The first data XHR returns `401` on a *cold* session,
   but a page **reload** re-establishes it and the same call then returns `200`. We
   retry-with-reload until warm. (A plain `setTimeout` wait does **not** warm it — it
   must be a navigation.)
3. **Read profile metadata** from `/api/v1/users/web_profile_info/?username=…` via an
   in-page `fetch()` (warm cookies + `x-ig-app-id: 936619743392459`).
4. **Paginate all posts** via `/api/v1/feed/user/{user_id}/?count=30&max_id=<cursor>`.
   This is a `max_id` cursor API — **no GraphQL `doc_id`**, so there is nothing that
   rotates every 2–4 weeks. Each item carries `code` (shortcode), `like_count`,
   `comment_count`, `play_count`, `caption.text`, `media_type`, `taken_at`, and a
   thumbnail URL.

## The real constraint: IP reputation

The code is reliable; the **IP is the bottleneck**. A fresh-ish datacenter IP warms to
`200` and pages cleanly. But after ~10 rapid runs the same IP gets throttled to a
**persistent `401`** that a short cooldown doesn't clear — observed firsthand while
building this. For anything beyond occasional polling you need:

- **Residential or mobile proxies**, rotated — set `IG_PROXY=http://user:pass@host:port`.
- **Polite pacing** — the feed loop already sleeps 600 ms between pages; space full
  profile pulls minutes apart, not seconds.
- Treat a persistent `401` as "this IP is burned," back off, rotate, and retry.

## Fit for rapid-response alerting

For new-post detection you don't need the full 440-post history — poll the **first feed
page** (newest ~12), diff `shortcode`s against last-seen, and alert on anything new
along with its early `like_count` / `comment_count`. Cheap and low-footprint. Reserve
full pagination (`max_pages`) for periodic backfills.

> Note: this is a Python + headless-browser worker. It cannot run inside a Supabase
> Edge Function (Deno, no browser) — run it as a separate scheduled worker/container and
> write results into Supabase.

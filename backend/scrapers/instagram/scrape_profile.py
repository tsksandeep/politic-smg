#!/usr/bin/env python3
"""
Tier-2 Instagram scraper — Scrapling StealthyFetcher (stealth Firefox/Camoufox).
No login, no API keys, NO GraphQL doc_id to maintain.

How it works (all verified live against a public profile):
  1. Open the public profile in a stealth browser.
  2. Warm the guest session: the first data XHR returns 401 on a COLD session, but after
     one reload the same call returns 200. We retry until warm.
  3. Read profile metadata from  /api/v1/users/web_profile_info/  (in-page fetch, warm
     cookies + x-ig-app-id header).
  4. Page through ALL posts/reels via  /api/v1/feed/user/{uid}/?count=30&max_id=<cursor>
     -- a max_id cursor API with nothing to rotate. Each item carries shortcode, like &
     comment counts, caption, media type, timestamp, and thumbnail.

Usage:  python3 ig_tier2.py [username] [max_pages]
Env:    IG_PROXY=http://user:pass@host:port   (recommended at scale / for flagged IPs)
"""
import os
import sys
import json

from scrapling.fetchers import StealthyFetcher

USERNAME = sys.argv[1] if len(sys.argv) > 1 else "theeyasakthitn"
MAX_PAGES = int(sys.argv[2]) if len(sys.argv) > 2 else 100   # safety cap (~30 posts/page)
URL = f"https://www.instagram.com/{USERNAME}/"
PROXY = os.environ.get("IG_PROXY")
APP_ID = "936619743392459"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ig_harvest.json")

result = {"profile": None, "posts": [], "warm_status": [], "pages": 0}

# Probe one web_profile_info call; returns HTTP status (used for reload-based warm-up).
PROBE_JS = """
async ([username, appId]) => {
  try {
    const r = await fetch('/api/v1/users/web_profile_info/?username=' + username,
      {headers: {'x-ig-app-id': appId}, credentials: 'include'});
    return r.status;
  } catch (e) { return -1; }
}
"""

# Runs only AFTER the session is warm: fetch profile metadata + paginate the user feed.
HARVEST_JS = """
async ([username, appId, maxPages]) => {
  const H = {'x-ig-app-id': appId};
  const opt = {headers: H, credentials: 'include'};

  // profile metadata
  let profile = null;
  try {
    const r = await fetch('/api/v1/users/web_profile_info/?username=' + username, opt);
    if (r.status === 200) profile = (await r.json()).data.user;
  } catch (e) {}
  if (!profile) return {profile: null, posts: [], pages: 0};

  const uid = profile.id;
  // 3) paginate the user feed (max_id cursor; no doc_id)
  const posts = [];
  let maxId = null, pages = 0;
  for (let p = 0; p < maxPages; p++) {
    let url = '/api/v1/feed/user/' + uid + '/?count=30';
    if (maxId) url += '&max_id=' + encodeURIComponent(maxId);
    let j;
    try {
      const r = await fetch(url, opt);
      if (r.status !== 200) break;
      j = await r.json();
    } catch (e) { break; }
    pages++;
    for (const it of (j.items || [])) {
      const cap = it.caption && it.caption.text ? it.caption.text : null;
      const img = it.image_versions2 && it.image_versions2.candidates &&
                  it.image_versions2.candidates[0] ? it.image_versions2.candidates[0].url : null;
      posts.push({
        shortcode: it.code,
        is_video: it.media_type === 2,
        likes: it.like_count,
        comments: it.comment_count,
        views: it.play_count || it.view_count || null,
        caption: cap,
        taken_at: it.taken_at,
        thumb: img,
      });
    }
    if (!j.more_available || !j.next_max_id) break;
    maxId = j.next_max_id;
    await new Promise(res => setTimeout(res, 600));  // polite pacing
  }
  return {
    pages,
    profile: {
      id: profile.id, full_name: profile.full_name, biography: profile.biography,
      followers: profile.edge_followed_by ? profile.edge_followed_by.count : null,
      following: profile.edge_follow ? profile.edge_follow.count : null,
      posts_count: profile.edge_owner_to_timeline_media ? profile.edge_owner_to_timeline_media.count : null,
      is_verified: profile.is_verified, is_private: profile.is_private,
      profile_pic: profile.profile_pic_url_hd || profile.profile_pic_url,
    },
    posts,
  };
}
"""


def action(page):
    # Warm the guest session: cold first call is 401; a reload re-establishes it.
    for _ in range(5):
        status = page.evaluate(PROBE_JS, [USERNAME, APP_ID])
        result["warm_status"].append(status)
        if status == 200:
            break
        try:
            page.reload(wait_until="domcontentloaded")
        except Exception:
            pass
        page.wait_for_timeout(2500)
    data = page.evaluate(HARVEST_JS, [USERNAME, APP_ID, MAX_PAGES])
    result.update(data or {})
    return page


def main():
    print(f"[*] Tier-2 fetch: {URL}  max_pages={MAX_PAGES}  proxy={'yes' if PROXY else 'no'}")
    kwargs = dict(
        headless=True, network_idle=True,
        wait_selector='meta[property="og:title"]',
        page_action=action, timeout=90000, wait=1500, google_search=True,
    )
    if PROXY:
        kwargs["proxy"] = PROXY
    resp = StealthyFetcher.fetch(URL, **kwargs)

    p = result.get("profile")
    print(f"[*] HTTP {resp.status} | warm-up statuses: {result.get('warm_status') or result.get('warm')}")
    if not p:
        print("[!] No profile JSON — session did not warm (try IG_PROXY=residential proxy).")
        return
    print("\n=== PROFILE ===")
    print(f"  @{USERNAME}  id={p['id']}  verified={p['is_verified']} private={p['is_private']}")
    print(f"  name      : {p['full_name']}")
    print(f"  bio       : {(p['biography'] or '').replace(chr(10),' ')[:90]}")
    print(f"  followers : {p['followers']:,}  following: {p['following']}  posts: {p['posts_count']}")

    posts = result.get("posts", [])
    print(f"\n=== POSTS/REELS: {len(posts)} fetched across {result.get('pages')} feed pages ===")
    for x in sorted(posts, key=lambda d: -(d.get("likes") or 0))[:25]:
        kind = "reel" if x["is_video"] else "post"
        v = f" views={x['views']}" if x.get("views") else ""
        print(f"  https://instagram.com/p/{x['shortcode']}/ [{kind}] "
              f"likes={x['likes']} comments={x['comments']}{v}  {(x.get('caption') or '')[:42]!r}")

    with open(OUT, "w") as f:
        json.dump(result, f, indent=2, default=str, ensure_ascii=False)
    print(f"\n[*] Full data ({len(posts)} posts) -> {OUT}")


if __name__ == "__main__":
    main()

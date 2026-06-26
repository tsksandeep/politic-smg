#!/usr/bin/env python3
"""worker.py — OpenPolitics media-worker loop (OCR/ASR, transcribe-then-discard).

Pipeline position (see specs/001-opposition-intel/research.md R7): capture nodes record a public
IG-CDN ``post.media_url`` and enqueue a ``media_jobs`` message {tenant_id, post_id}. This always-on
container drains that queue: fetch the public media -> OCR (image) / ASR (reel audio) -> write a
``media_transcript`` row -> NULL out ``post.media_url`` (done atomically inside the
``add_media_transcript`` RPC) -> DISCARD the raw bytes. Raw media is NEVER warehoused (Constitution
Principle III). It can't run in Edge Functions: it needs ffmpeg + (optionally) a local ASR model —
a heavy runtime Deno Edge Functions don't provide.

RAW-BYTE DISCARD — exactly where:
  * In-memory: the downloaded bytes live only in the local ``media`` variable inside process_job();
    a try/finally rebinds it to None right after transcription so the buffer is dropped immediately
    (logged as "purged in-memory media").
  * On-disk: ffmpeg/whisper temp files are created ONLY via providers.ephemeral_file(), which
    unlinks them in a finally block before returning. Nothing media-derived persists.
  * Server-side: add_media_transcript() sets post.media_url = NULL, so the URL handle is dropped too.

Tenant scoping: every job carries tenant_id and add_media_transcript(p_tenant, ...) re-enforces it
server-side. We only fetch the captured public CDN URL — never a logged-in IG endpoint (Principle II).
"""
import logging
import signal
import sys
import time

import httpx

import config
import providers

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s", stream=sys.stdout
)
log = logging.getLogger("media-worker")

_RUNNING = True


def _stop(*_):
    global _RUNNING
    _RUNNING = False
    log.info("shutdown signal received; draining current batch then exiting")


# --------------------------------------------------------------------------------------
# Supabase RPC client (service role over PostgREST /rpc — same RPCs as migrations 0004/0007).
# --------------------------------------------------------------------------------------
class Supabase:
    def __init__(self):
        config.require("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
        self.http = httpx.Client(
            timeout=config.HTTP_TIMEOUT,
            headers={
                "apikey": config.SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {config.SUPABASE_SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
            },
        )

    def rpc(self, fn: str, payload: dict):
        r = self.http.post(f"{config.RPC_URL}/{fn}", json=payload)
        if r.status_code >= 400:
            raise RuntimeError(f"rpc {fn} {r.status_code}: {r.text[:300]}")
        return r.json() if r.text and r.text != "null" else None

    def claim(self) -> list[dict]:
        rows = self.rpc(
            "claim_jobs",
            {
                "p_queue": config.QUEUE_NAME,
                "p_qty": config.MEDIA_BATCH,
                "p_vt": config.VISIBILITY_TIMEOUT,
                "p_max_reads": config.MAX_READS,
            },
        )
        return rows or []

    def complete(self, msg_id: int):
        self.rpc("complete_job", {"p_queue": config.QUEUE_NAME, "p_msg_id": msg_id})

    def fail(self, msg_id: int):
        self.rpc("fail_job", {"p_queue": config.QUEUE_NAME, "p_msg_id": msg_id})

    def get_media_url(self, post_id: str) -> str | None:
        # PostgREST read; service role. We only need the transient public CDN url.
        r = self.http.get(
            f"{config.REST_URL}/post",
            params={"id": f"eq.{post_id}", "select": "media_url", "limit": 1},
        )
        if r.status_code >= 400:
            raise RuntimeError(f"read post {r.status_code}: {r.text[:200]}")
        rows = r.json()
        return rows[0]["media_url"] if rows else None

    def add_transcript(self, tenant_id: str, post_id: str, kind: str, text: str, embedding: str):
        # Inserts media_transcript AND nulls post.media_url (transcribe-then-discard, server-side).
        self.rpc(
            "add_media_transcript",
            {
                "p_tenant": tenant_id,
                "p_post": post_id,
                "p_kind": kind,
                "p_text": text,
                "p_embedding": embedding,
            },
        )


# --------------------------------------------------------------------------------------
# Media fetch — public IG CDN only, capped, fully in memory (no streaming-to-disk).
# --------------------------------------------------------------------------------------
def fetch_media(url: str) -> tuple[bytes, str]:
    with httpx.Client(timeout=config.HTTP_TIMEOUT, follow_redirects=True) as client:
        with client.stream("GET", url, headers={"User-Agent": config.USER_AGENT}) as resp:
            if resp.status_code >= 400:
                raise RuntimeError(f"CDN fetch {resp.status_code}")
            content_type = resp.headers.get("content-type", "application/octet-stream")
            buf = bytearray()
            for chunk in resp.iter_bytes():
                buf.extend(chunk)
                if len(buf) > config.MAX_MEDIA_BYTES:
                    raise RuntimeError(f"media exceeds MAX_MEDIA_BYTES ({config.MAX_MEDIA_BYTES})")
            return bytes(buf), content_type


# --------------------------------------------------------------------------------------
# Process one job: {tenant_id, post_id[, priority]}
# --------------------------------------------------------------------------------------
def process_job(db: Supabase, message: dict):
    tenant_id = message["tenant_id"]
    post_id = message["post_id"]

    media_url = db.get_media_url(post_id)
    if not media_url:
        log.info("post %s has no media_url (already discarded) — nothing to do", post_id)
        return

    media, content_type = fetch_media(media_url)
    is_video = content_type.lower().startswith("video") or content_type.lower() in (
        "application/octet-stream",
    ) and media_url.lower().split("?")[0].endswith((".mp4", ".mov"))

    try:
        if is_video:
            # Reel: ASR on the audio track (primary), plus optional OCR of burned-in frame text.
            asr_text = providers.asr_audio(media, content_type)
            if asr_text:
                db.add_transcript(tenant_id, post_id, "asr", asr_text, providers.embed_transcript(asr_text))
            if config.VIDEO_FRAME_OCR:
                frame_text = providers.ocr_video_frames(media)
                if frame_text:
                    db.add_transcript(
                        tenant_id, post_id, "ocr", frame_text, providers.embed_transcript(frame_text)
                    )
            if not asr_text and not (config.VIDEO_FRAME_OCR):
                log.info("post %s reel produced no transcript", post_id)
        else:
            # Image: OCR overlaid/embedded text.
            ocr_text = providers.ocr_image(media, content_type)
            if ocr_text:
                db.add_transcript(tenant_id, post_id, "ocr", ocr_text, providers.embed_transcript(ocr_text))
            else:
                # Still null the url server-side so we don't re-fetch a text-less image forever.
                db.add_transcript(tenant_id, post_id, "ocr", "", "")
    finally:
        # ---- RAW-BYTE DISCARD (Principle III): drop the in-memory buffer immediately. ----
        media = None  # noqa: F841  — explicit purge; bytes are now unreferenced for GC.
        log.info("purged in-memory media for post %s (transcribe-then-discard)", post_id)


def main():
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    log.info(
        "media-worker starting | provider=%s | embeddings=%s | batch=%d | queue=%s",
        config.MEDIA_PROVIDER, config.EMBEDDINGS_PROVIDER, config.MEDIA_BATCH, config.QUEUE_NAME,
    )
    db = Supabase()

    while _RUNNING:
        try:
            jobs = db.claim()
        except Exception as e:
            log.warning("claim failed: %s", e)
            time.sleep(config.POLL_INTERVAL_SECONDS)
            continue

        if not jobs:
            time.sleep(config.POLL_INTERVAL_SECONDS)
            continue

        # Tiering: process high-velocity posts first if a priority hint is present, else FIFO.
        jobs.sort(key=lambda j: (-int((j.get("message") or {}).get("priority", 0)), j["msg_id"]))

        for job in jobs:
            if not _RUNNING:
                break
            msg_id = job["msg_id"]
            message = job.get("message") or {}
            try:
                process_job(db, message)
                db.complete(msg_id)
            except Exception as e:
                log.error("job %s failed (post=%s): %s", msg_id, message.get("post_id"), e)
                try:
                    db.fail(msg_id)  # make visible again; read_ct climbs toward the DLQ cap
                except Exception as fe:
                    log.error("fail_job %s also errored: %s", msg_id, fe)

    log.info("media-worker stopped")


if __name__ == "__main__":
    main()

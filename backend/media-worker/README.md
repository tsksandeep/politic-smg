# media-worker

Always-on container that turns opposition post media into **derived text** and throws the raw
media away. It drains the `media_jobs` pgmq queue: for each `{tenant_id, post_id}` it fetches the
post's public Instagram-CDN media, runs **OCR** (images) or **ASR** (reel audio), writes a
`media_transcript` row, and **discards the raw bytes**. This is the *transcribe-then-discard*
pipeline from R7 (`specs/001-opposition-intel/research.md`) and the load-bearing implementation of
**Constitution Principle III — Data Minimisation & No-Warehousing**.

The derived transcript text feeds narrative clustering and shared-audio / content coordination
detection (`run_detection` / `detect_coordination` in migration `0007_detection.sql`).

## Why this can't live in Edge Functions

Supabase Edge Functions run on Deno with no `ffmpeg`, no audio/vision model runtime, and tight
CPU/time/memory limits. OCR/ASR needs a heavy runtime: `ffmpeg` to demux reel audio and sample
frames, and (in local mode) a Whisper model. So this is a **standalone always-on container**, the
one net-new backend component sanctioned alongside the node extension (Constitution: Technology
Constraints). Everything else in the pipeline stays in Edge Functions.

## The transcribe-then-discard guarantee — exactly where bytes are purged

Raw media bytes never persist. Three discard points, all explicit in code:

1. **In-memory buffer** — `worker.py :: process_job()` holds the download in a single local
   `media` variable. A `try/finally` rebinds it to `None` immediately after transcription and logs
   `purged in-memory media for post <id>`. The bytes are then unreferenced and GC'd. The fetch
   (`fetch_media`) is fully in-memory and capped by `MAX_MEDIA_BYTES`; it never streams to disk.
2. **On-disk temp (local/ffmpeg path only)** — the *only* place media-derived bytes touch disk is
   `providers.py :: ephemeral_file()`, a context manager that `os.remove()`s the tempfile in a
   `finally` block before returning. Audio extraction and frame sampling both go through it, so
   nothing survives a transcription. The container also mounts `/tmp` as **tmpfs** (see
   `docker-compose.yml`) so even those transient files never hit a persistent disk.
3. **Server-side URL handle** — `add_media_transcript(...)` (migration `0007`) runs
   `update post set media_url = null` in the same call that inserts the transcript, so the CDN URL
   pointer is dropped atomically too.

No raw image/video is ever written to a bucket, a column, or a persistent path.

## Tenant scoping & public-data-only

- Every queue message carries `tenant_id`; `add_media_transcript(p_tenant, p_post, ...)` re-asserts
  it server-side (Principle I).
- We fetch **only** the public CDN `media_url` captured by nodes — never a logged-in Instagram
  endpoint (Principle II). Datacenter IPs are fine for the public CDN (R7).

## Provider abstraction (mirrors `shared/embeddings.ts` / `shared/llm.ts`)

Engine is chosen purely by env — same code, prod and local, no environment branching.

| Concern | Env | Hosted default | Local fallback |
|--------|-----|----------------|----------------|
| OCR / ASR | `MEDIA_PROVIDER` | `gemini` — Gemini 2.5 multimodal via OpenRouter (image OCR + `input_audio` ASR) | `local` — `tesseract` OCR + `faster-whisper` ASR |
| Transcript embedding | `EMBEDDINGS_PROVIDER` | `none` (leave `transcript_embedding` NULL) | `vertex` (gemini-embedding-001, India) or `openai` (LM Studio /v1/embeddings) |

**Embedding choice:** default `none` — the worker writes the transcript text only and leaves
`transcript_embedding` NULL. The transcript joins clustering via its text, and `EMBED_DIM`/provider
env mirror `shared/embeddings.ts` exactly if you flip it on (`vertex` needs a static
`VERTEX_ACCESS_TOKEN`; the SA-JWT minting in `embeddings.ts` is intentionally not duplicated here to
keep the worker dependency-light).

Reels produce up to two rows: an `asr` row (audio) and, when `VIDEO_FRAME_OCR=true`, an `ocr` row
(burned-in caption/banner text from sampled frames). Images produce one `ocr` row.

## Tiering

`claim_jobs` returns FIFO by `msg_id`. If a message carries an optional `priority` integer hint, the
worker sorts the claimed batch by `priority` descending first (high-velocity posts first), then
`msg_id` — so plain FIFO holds when no hint is present.

## Config (full list in `config.py`)

Required: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Hosted OCR/ASR also needs
`OPENROUTER_API_KEY`. Key tuning: `MEDIA_BATCH` (claim qty), `POLL_INTERVAL_SECONDS`,
`MEDIA_VT_SECONDS` (visibility timeout), `MEDIA_MAX_READS` (DLQ cap), `MAX_MEDIA_BYTES`,
`VIDEO_FRAME_OCR` / `VIDEO_FRAME_COUNT`, `TESSERACT_LANG`, `WHISPER_MODEL`. Secrets come from the
environment / Supabase Vault — never committed, never logged.

## Run locally

```bash
cd backend/media-worker
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# local engine needs ffmpeg + tesseract on PATH (brew install ffmpeg tesseract):
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_SERVICE_ROLE_KEY=...service-role-key...
export MEDIA_PROVIDER=local           # or gemini + OPENROUTER_API_KEY
python worker.py
```

## Run as a container

```bash
cp .env.example .env   # fill in SUPABASE_*, OPENROUTER_API_KEY, MEDIA_PROVIDER
docker compose up -d --build media-worker
docker compose logs -f media-worker
```

The loop claims a batch, processes each job, `complete_job`s on success or `fail_job`s on error
(which makes the message visible again so `read_ct` climbs toward the `MEDIA_MAX_READS` DLQ cap).
It handles `SIGTERM`/`SIGINT` by draining the current batch then exiting cleanly.

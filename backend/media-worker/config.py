"""config.py — env contract for the media-worker container.

Mirrors the env-driven provider style of backend/supabase/shared/{embeddings,llm}.ts:
the SAME code serves hosted cloud and local dev — only env values change, no code branches
on environment. Every value has a production-sensible default where one exists.

Two provider knobs:

  MEDIA_PROVIDER   OCR/ASR engine:
                     "gemini" (default, hosted) — Gemini 2.5 multimodal via OpenRouter
                                                   (image OCR + audio ASR, no local model weights).
                     "local"                    — tesseract (OCR) + faster-whisper (ASR), fully
                                                   offline fallback for dev / air-gapped runs.

  EMBEDDINGS_PROVIDER  transcript_embedding source (mirrors shared/embeddings.ts exactly):
                     "none"   (default) — leave transcript_embedding NULL; the row's text is
                                          embedded later by the enrich path / detection join.
                     "vertex"          — Vertex AI gemini-embedding-001 (India region), like prod.
                     "openai"          — any OpenAI-compatible /v1/embeddings server (LM Studio).

Secrets (SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY, Vertex creds) come from the environment /
Supabase Vault — never committed, never logged (Constitution: Secrets).
"""
import os


def _clean(url: str) -> str:
    return (url or "").rstrip("/")


# ---- Supabase (service role — RLS-bypassing backend; add_media_transcript re-enforces tenant) ----
SUPABASE_URL = _clean(os.environ.get("SUPABASE_URL", ""))
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
REST_URL = f"{SUPABASE_URL}/rest/v1"
RPC_URL = f"{REST_URL}/rpc"

# ---- queue / claim tuning (maps onto claim_jobs RPC args in migration 0004) ----
QUEUE_NAME = os.environ.get("MEDIA_QUEUE", "media_jobs")
MEDIA_BATCH = int(os.environ.get("MEDIA_BATCH", "8"))            # claim qty per poll
VISIBILITY_TIMEOUT = int(os.environ.get("MEDIA_VT_SECONDS", "120"))  # pgmq vt while we work a msg
MAX_READS = int(os.environ.get("MEDIA_MAX_READS", "5"))         # -> DLQ after this many attempts
POLL_INTERVAL_SECONDS = float(os.environ.get("POLL_INTERVAL_SECONDS", "5"))

# ---- media fetch (public IG CDN only — never a logged-in endpoint; Principle II) ----
HTTP_TIMEOUT = float(os.environ.get("HTTP_TIMEOUT", "60"))
MAX_MEDIA_BYTES = int(os.environ.get("MAX_MEDIA_BYTES", str(80 * 1024 * 1024)))  # 80 MB guard
USER_AGENT = os.environ.get(
    "MEDIA_USER_AGENT",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
)

# ---- OCR / ASR provider ----
MEDIA_PROVIDER = os.environ.get("MEDIA_PROVIDER", "gemini").lower()  # "gemini" | "local"

# hosted (OpenRouter, mirrors shared/llm.ts)
OPENROUTER_BASE = _clean(os.environ.get("OPENROUTER_BASE", "https://openrouter.ai/api/v1"))
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
# Gemini 2.5 Flash is multimodal (vision + audio). Flash-Lite is cheaper but vision-weaker.
OPENROUTER_MODEL_VISION = os.environ.get("OPENROUTER_MODEL_VISION", "google/gemini-2.5-flash")
OPENROUTER_MODEL_AUDIO = os.environ.get("OPENROUTER_MODEL_AUDIO", "google/gemini-2.5-flash")

# local fallback
TESSERACT_LANG = os.environ.get("TESSERACT_LANG", "eng+tam")   # India launch: English + Tamil
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")       # faster-whisper model id
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE = os.environ.get("WHISPER_COMPUTE", "int8")

# Sample frames from a reel for OCR of burned-in text (captions/banners) in addition to audio ASR.
VIDEO_FRAME_OCR = os.environ.get("VIDEO_FRAME_OCR", "true").lower() == "true"
VIDEO_FRAME_COUNT = int(os.environ.get("VIDEO_FRAME_COUNT", "4"))

# ---- transcript embedding (mirrors shared/embeddings.ts; default OFF -> NULL column) ----
EMBEDDINGS_PROVIDER = os.environ.get("EMBEDDINGS_PROVIDER", "none").lower()  # none|vertex|openai
EMBED_DIM = int(os.environ.get("EMBED_DIM", "768"))
# vertex
VERTEX_EMBEDDINGS_URL = _clean(os.environ.get("VERTEX_EMBEDDINGS_URL", ""))
VERTEX_ACCESS_TOKEN = os.environ.get("VERTEX_ACCESS_TOKEN", "")
VERTEX_EMBEDDING_MODEL = os.environ.get("VERTEX_EMBEDDING_MODEL", "gemini-embedding-001")
# openai-compatible
EMBEDDINGS_BASE = _clean(os.environ.get("EMBEDDINGS_BASE", ""))
EMBEDDINGS_MODEL = os.environ.get("EMBEDDINGS_MODEL", "text-embedding-embeddinggemma-300m")
EMBEDDINGS_API_KEY = os.environ.get("EMBEDDINGS_API_KEY", "")


def require(*keys: str) -> None:
    """Fail fast at startup if a mandatory secret/url is missing."""
    missing = [k for k in keys if not globals().get(k)]
    if missing:
        raise RuntimeError(f"missing required env: {', '.join(missing)}")

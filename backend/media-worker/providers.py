"""providers.py — the OCR / ASR / embedding abstraction (hosted Gemini vs local fallback).

Engine is chosen ONCE by config.MEDIA_PROVIDER; callers in worker.py just ask for
ocr_image() / asr_audio() and never see the engine. Heavy local deps (pytesseract, PIL,
faster_whisper) are imported lazily inside their functions so a gemini-only container does
not need them installed.

RAW-BYTE DISCIPLINE (Principle III): every function here takes media bytes IN MEMORY and
returns derived TEXT. The local ASR/frame paths must hand ffmpeg/tesseract a real file, so
they spill to an ``ephemeral_file`` — a tempfile that is ALWAYS unlinked in a finally block
before the function returns. Nothing media-derived is left on disk. See ephemeral_file().
"""
import base64
import contextlib
import logging
import mimetypes
import os
import subprocess
import tempfile

import httpx

import config

log = logging.getLogger("media-worker.providers")


# --------------------------------------------------------------------------------------
# Ephemeral on-disk buffer: exists only for the duration of one transcription, then purged.
# This is the ONLY place media-derived bytes ever touch disk, and they are deleted in finally.
# --------------------------------------------------------------------------------------
@contextlib.contextmanager
def ephemeral_file(data: bytes | None, suffix: str):
    fd, path = tempfile.mkstemp(suffix=suffix, prefix="mw_ephemeral_")
    try:
        if data is not None:
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
        else:
            os.close(fd)
        yield path
    finally:
        # PURGE: unconditional delete so no media-derived bytes survive this call.
        with contextlib.suppress(FileNotFoundError):
            os.remove(path)


def _ffmpeg(*args: str) -> None:
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args],
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {proc.stderr.decode('utf-8', 'replace')[:300]}")


# ======================================================================================
# OCR — image frames -> text
# ======================================================================================
def ocr_image(image_bytes: bytes, content_type: str) -> str:
    if config.MEDIA_PROVIDER == "local":
        return _ocr_tesseract(image_bytes)
    return _ocr_gemini(image_bytes, content_type)


def _ocr_gemini(image_bytes: bytes, content_type: str) -> str:
    mime = content_type.split(";")[0].strip() or "image/jpeg"
    data_url = f"data:{mime};base64,{base64.b64encode(image_bytes).decode()}"
    content = [
        {
            "type": "text",
            "text": (
                "Transcribe ALL text visible in this image exactly (OCR), including overlaid "
                "captions, banners, and watermarks. If text is in Tamil or another Indic script, "
                "keep the original script. Return only the transcribed text, no commentary. "
                "If there is no text, return an empty string."
            ),
        },
        {"type": "image_url", "image_url": {"url": data_url}},
    ]
    return _openrouter_chat(config.OPENROUTER_MODEL_VISION, content)


def _ocr_tesseract(image_bytes: bytes) -> str:
    import io

    import pytesseract  # lazy
    from PIL import Image

    with Image.open(io.BytesIO(image_bytes)) as img:
        return pytesseract.image_to_string(img, lang=config.TESSERACT_LANG).strip()


# ======================================================================================
# ASR — reel audio -> text   (input is the full video container; we extract the audio track)
# ======================================================================================
def asr_audio(video_bytes: bytes, content_type: str) -> str:
    if config.MEDIA_PROVIDER == "local":
        return _asr_whisper(video_bytes)
    return _asr_gemini(video_bytes)


def _extract_audio_wav(video_bytes: bytes) -> bytes:
    """video bytes -> 16 kHz mono wav bytes, via two short-lived ephemeral files."""
    with ephemeral_file(video_bytes, ".mp4") as vpath, ephemeral_file(None, ".wav") as apath:
        _ffmpeg("-i", vpath, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", apath)
        with open(apath, "rb") as fh:
            return fh.read()
    # both ephemeral files purged on context exit


def _asr_gemini(video_bytes: bytes) -> str:
    wav = _extract_audio_wav(video_bytes)
    audio_b64 = base64.b64encode(wav).decode()
    content = [
        {
            "type": "text",
            "text": (
                "Transcribe the spoken audio in this clip verbatim (ASR). Keep the original "
                "language/script (e.g. Tamil, Hindi, English). Return only the transcript text."
            ),
        },
        {"type": "input_audio", "input_audio": {"data": audio_b64, "format": "wav"}},
    ]
    return _openrouter_chat(config.OPENROUTER_MODEL_AUDIO, content)


def _asr_whisper(video_bytes: bytes) -> str:
    from faster_whisper import WhisperModel  # lazy

    global _WHISPER
    try:
        _WHISPER
    except NameError:
        _WHISPER = None
    if _WHISPER is None:
        _WHISPER = WhisperModel(
            config.WHISPER_MODEL, device=config.WHISPER_DEVICE, compute_type=config.WHISPER_COMPUTE
        )
    wav = _extract_audio_wav(video_bytes)
    with ephemeral_file(wav, ".wav") as apath:
        segments, _ = _WHISPER.transcribe(apath, vad_filter=True)
        return " ".join(seg.text.strip() for seg in segments).strip()


# ======================================================================================
# Optional: OCR burned-in text from a few sampled reel frames (captions/banners).
# ======================================================================================
def ocr_video_frames(video_bytes: bytes) -> str:
    texts: list[str] = []
    with ephemeral_file(video_bytes, ".mp4") as vpath:
        for i in range(config.VIDEO_FRAME_COUNT):
            ts = 1 + i * 2  # sample at 1s, 3s, 5s, ...
            with ephemeral_file(None, ".jpg") as fpath:
                try:
                    _ffmpeg("-ss", str(ts), "-i", vpath, "-frames:v", "1", fpath)
                    with open(fpath, "rb") as fh:
                        frame = fh.read()
                except RuntimeError:
                    break  # past end of clip
                if frame:
                    with contextlib.suppress(Exception):
                        t = ocr_image(frame, "image/jpeg")
                        if t:
                            texts.append(t)
    # de-dup consecutive identical frame text
    seen, out = set(), []
    for t in texts:
        if t not in seen:
            seen.add(t)
            out.append(t)
    return "\n".join(out).strip()


# ======================================================================================
# OpenRouter multimodal chat (mirrors shared/llm.ts request shape)
# ======================================================================================
def _openrouter_chat(model: str, content: list) -> str:
    url = f"{config.OPENROUTER_BASE}/chat/completions"
    if not config.OPENROUTER_API_KEY and "openrouter.ai" in url:
        raise RuntimeError("OPENROUTER_API_KEY is not set (MEDIA_PROVIDER=gemini)")
    headers = {"Content-Type": "application/json"}
    if config.OPENROUTER_API_KEY:
        headers["Authorization"] = f"Bearer {config.OPENROUTER_API_KEY}"
    body = {
        "model": model,
        "temperature": 0,
        "messages": [{"role": "user", "content": content}],
    }
    with httpx.Client(timeout=config.HTTP_TIMEOUT) as client:
        r = client.post(url, headers=headers, json=body)
    if r.status_code >= 400:
        raise RuntimeError(f"OpenRouter {model} error {r.status_code}: {r.text[:300]}")
    data = r.json()
    return (data.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""


# ======================================================================================
# Optional transcript embedding (mirrors shared/embeddings.ts). Returns "" when disabled,
# which add_media_transcript stores as NULL (nullif(p_embedding,'')::vector).
# ======================================================================================
def embed_transcript(text: str) -> str:
    if config.EMBEDDINGS_PROVIDER == "none" or not text.strip():
        return ""
    values = (
        _embed_openai(text) if config.EMBEDDINGS_PROVIDER == "openai" else _embed_vertex(text)
    )
    if len(values) != config.EMBED_DIM:
        raise RuntimeError(f"embedding dim {len(values)} != EMBED_DIM {config.EMBED_DIM}")
    return "[" + ",".join(str(v) for v in values) + "]"  # pgvector literal


def _embed_vertex(text: str) -> list:
    if not config.VERTEX_EMBEDDINGS_URL:
        raise RuntimeError("VERTEX_EMBEDDINGS_URL is not set (EMBEDDINGS_PROVIDER=vertex)")
    if not config.VERTEX_ACCESS_TOKEN:
        # Token minting from a SA JWT lives in shared/embeddings.ts; here we require a static token
        # (inject a short-lived VERTEX_ACCESS_TOKEN) to keep the worker dependency-light.
        raise RuntimeError("VERTEX_ACCESS_TOKEN required when EMBEDDINGS_PROVIDER=vertex")
    headers = {
        "Authorization": f"Bearer {config.VERTEX_ACCESS_TOKEN}",
        "Content-Type": "application/json",
    }
    body = {"instances": [{"content": text}], "parameters": {"outputDimensionality": config.EMBED_DIM}}
    with httpx.Client(timeout=config.HTTP_TIMEOUT) as client:
        r = client.post(config.VERTEX_EMBEDDINGS_URL, headers=headers, json=body)
    if r.status_code >= 400:
        raise RuntimeError(f"Vertex embedding error {r.status_code}: {r.text[:300]}")
    preds = r.json().get("predictions") or [{}]
    return preds[0].get("embeddings", {}).get("values", [])


def _embed_openai(text: str) -> list:
    if not config.EMBEDDINGS_BASE:
        raise RuntimeError("EMBEDDINGS_BASE is not set (EMBEDDINGS_PROVIDER=openai)")
    headers = {"Content-Type": "application/json"}
    if config.EMBEDDINGS_API_KEY:
        headers["Authorization"] = f"Bearer {config.EMBEDDINGS_API_KEY}"
    body = {"model": config.EMBEDDINGS_MODEL, "input": text}
    with httpx.Client(timeout=config.HTTP_TIMEOUT) as client:
        r = client.post(f"{config.EMBEDDINGS_BASE}/embeddings", headers=headers, json=body)
    if r.status_code >= 400:
        raise RuntimeError(f"OpenAI embedding error {r.status_code}: {r.text[:300]}")
    return (r.json().get("data") or [{}])[0].get("embedding", [])


def guess_suffix(content_type: str, url: str) -> str:
    return mimetypes.guess_extension(content_type.split(";")[0].strip()) or os.path.splitext(url)[1] or ""

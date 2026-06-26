# media-worker — always-on OCR/ASR container (cannot run in Edge Functions: needs ffmpeg +
# optional local ASR model weights, a heavy runtime Deno Edge Functions don't provide).
FROM python:3.13-slim

# System deps:
#   ffmpeg        — extract reel audio (wav) + sample frames (both providers use it)
#   tesseract-ocr — local OCR fallback (MEDIA_PROVIDER=local); eng + tam for the India launch
# For a slim gemini-only image, drop the tesseract packages and the local lines in requirements.txt.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        tesseract-ocr tesseract-ocr-eng tesseract-ocr-tam \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY config.py providers.py worker.py ./

# Run as non-root; tmpfs-backed /tmp for ephemeral media spills (see docker-compose).
RUN useradd --create-home --uid 10001 worker
USER worker

# No raw media is ever persisted: ephemeral temp files go to /tmp and are unlinked immediately.
ENV PYTHONUNBUFFERED=1 TMPDIR=/tmp

ENTRYPOINT ["python", "worker.py"]

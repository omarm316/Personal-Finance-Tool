# ── Stage 1: build the frontend ───────────────────────────────────────────
# The React app lives in frontend/ and is bundled by Vite into static/app.
# Building here means the compiled assets never need to be committed.
FROM node:20-slim AS frontend

WORKDIR /build

# Install deps first so this layer caches unless the manifests change.
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npm run build
# vite.config.js sets outDir to ../static/app, i.e. /static/app in this stage.

# ── Stage 2: the FastAPI app ──────────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Overlay the built frontend. Must come *after* `COPY . .` so a stale local
# static/app in the build context can't clobber the freshly built one.
COPY --from=frontend /static/app ./static/app

# Railway provides PORT env var
ENV PORT=8000

EXPOSE ${PORT}

CMD gunicorn main:app --workers 1 --worker-class uvicorn.workers.UvicornWorker --bind 0.0.0.0:${PORT} --timeout 120

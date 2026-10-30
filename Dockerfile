# Build React separately; Node is not present in the runtime image.
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MALLOC_ARENA_MAX=2 \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    NUMEXPR_NUM_THREADS=1 \
    PORT=10000 \
    NEUROSHIELD_FLASK_HOST=0.0.0.0 \
    NEUROSHIELD_MCP_HOST=127.0.0.1 \
    NEUROSHIELD_MAX_CONCURRENT_ANALYSES=1 \
    NEUROSHIELD_WATCHER=false

WORKDIR /app
RUN useradd --create-home --uid 10001 appuser
COPY requirements.txt ./
RUN pip install --no-cache-dir --disable-pip-version-check -r requirements.txt
COPY --chown=appuser:appuser . .
COPY --from=web --chown=appuser:appuser /web/dist ./frontend/dist
RUN mkdir -p /app/data /app/logs && chown -R appuser:appuser /app/data /app/logs

USER appuser
EXPOSE 10000
# One worker is intentional: every worker would start another four MCP servers.
CMD ["sh", "-c", "gunicorn run_all:app --bind 0.0.0.0:${PORT:-10000} --workers 1 --worker-class gthread --threads 4 --timeout 180 --graceful-timeout 30 --access-logfile - --error-logfile -"]

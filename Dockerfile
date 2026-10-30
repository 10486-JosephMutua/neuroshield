# NeuroShield: one container runs the 4 MCP servers + Flask API + built React app.
# Works on Hugging Face Spaces (Docker SDK, port 7860), Render, Railway, Fly.io.

FROM node:20-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
RUN useradd -m -u 1000 user
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=user:user . .
COPY --from=web --chown=user:user /web/dist ./frontend/dist
RUN mkdir -p data logs && chown -R user:user data logs
USER user

ENV NEUROSHIELD_FLASK_HOST=0.0.0.0 \
    NEUROSHIELD_FLASK_PORT=7860 \
    PYTHONUNBUFFERED=1
EXPOSE 7860
CMD ["python", "run_all.py"]

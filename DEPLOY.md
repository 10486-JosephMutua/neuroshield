# Deploy NeuroShield to Render (free)

This configuration targets Render's free web-service instance (512 MB RAM). It
keeps the React UI, Flask API, AI pipeline and all four MCP tool groups.

## What changed for the free instance

- The four FastMCP servers retain their own loopback ports and original tools, but
  now share one asyncio event loop in one Python process. The old launcher created
  four additional Python interpreters.
- Gunicorn runs exactly one WSGI worker. Do not increase `--workers`: each worker
  would start another set of MCP servers and duplicate the AI libraries in RAM.
- Gunicorn uses four request threads; model-backed analysis concurrency defaults to one.
- MCP HTTP transport is stateless because tool state is stored in SQLite.
- React is built in a Node build stage; Node is not installed in the runtime image.
- The always-on watcher is disabled on the free instance.

These changes reduce overhead; they do not guarantee a fixed memory figure. Check
actual Render memory during startup and while an AI analysis is running. If it still
exceeds 512 MB, further profiling or a larger instance will be necessary.

## Deploy using the Render Blueprint

1. Push the contents of this project folder to a GitHub repository.
2. In Render, choose **New + → Blueprint** and connect that repository.
3. Render reads `render.yaml`; select the free plan.
4. In the service's Environment page, add `NEBIUS_API_KEY` as a secret.
5. Deploy and wait for the build to finish.
6. Open `https://<your-service-name>.onrender.com/`.
7. Check `https://<your-service-name>.onrender.com/api/health`. Expect `status: ok`
   and all four entries in `mcp_reachable` to be `true`.

## Required secret

- `NEBIUS_API_KEY`: your Nebius Token Factory API key.

Never commit `.env` or put the API key in GitHub.

## Local production-like test

```bash
pip install -r requirements-dev.txt
cd frontend
npm ci
npm run build
cd ..
python run_all.py
```

For a Gunicorn test on Linux/macOS/Render:

```bash
PORT=10000 gunicorn run_all:app --bind 0.0.0.0:$PORT --workers 1 \
  --worker-class gthread --threads 4 --timeout 180
```

## Free-tier limitations

Render free web services sleep after inactivity and use ephemeral storage. The
SQLite database at `/tmp/neuroshield.db` can reset after a restart or redeploy. Demo
personas can be seeded again from the app. Do not use this free deployment for real
patient data or as a persistent clinical service.

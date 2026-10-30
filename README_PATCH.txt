NeuroShield Render free-tier deployment patch

The complete updated project is in neuroshield_render_optimized.zip.
This folder contains every file changed for the Render optimisation.

To use individual replacement files, copy them into the matching locations
inside your existing neuroshield project, preserving the backend/ folder.

The new production command runs Gunicorn with one worker. Do not increase the
worker count: each worker would start its own four MCP services.

Render still requires a NEBIUS_API_KEY secret in the service environment.

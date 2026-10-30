# Deploy NeuroShield on Hugging Face Spaces (free)

1. Create a Space at huggingface.co/new-space. Choose **Docker** as the SDK, **Blank** template, **Public**.
2. In the Space, open **Settings > Variables and secrets** and add a **secret** named `NEBIUS_API_KEY` with your Token Factory key.
3. Push the project to the Space repo (copy the project files into it). The Space README must start with:

   ```
   ---
   title: NeuroShield
   sdk: docker
   app_port: 7860
   ---
   ```

   Keep your GitHub README as the main one; the Space can use its own copy with this header.
4. Wait for the build (about 3-5 minutes). Open the Space URL. On the welcome page, pick a demo person. The demo data is created automatically.
5. Free Spaces sleep when idle and the database resets on restart. That is fine, because the demo people are regenerated on the welcome page.

Alternatives: Render (Docker web service, set `NEUROSHIELD_FLASK_PORT` to the port Render gives you) or Railway.

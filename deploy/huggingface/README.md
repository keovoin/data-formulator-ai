---
title: Data Formulator
emoji: 📊
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# Data Formulator (self-hosted)

A personal instance of Data Formulator running on Hugging Face Spaces (free
Docker tier). The frontend is built and the Flask backend is served by the
`Dockerfile` in this Space.

## One-time setup

1. **Make this Space private** (Settings → change visibility) so only you can
   use it — the app has no login of its own, and a public Space would let
   anyone spend your OpenRouter credits.
2. Add your OpenRouter key under **Settings → Variables and secrets →
   New secret**:
   - Name: `OPENROUTER_API_KEY`
   - Value: your key from https://openrouter.ai/keys
3. (Optional) Add `FLASK_SECRET_KEY` as a secret (any long random string) so
   sessions survive restarts.

The default model is **Llama 3.3 70B (free)**. Other models are preconfigured
in the Dockerfile's `OPENROUTER_MODELS` list; you can also add your own from
the in-app "Select models" dialog.

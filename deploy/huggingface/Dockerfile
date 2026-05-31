# Hugging Face Space (Docker SDK) — free hosting for Data Formulator.
#
# This file is self-contained: it clones the GitHub repo, builds the React
# frontend, installs the Python backend, and runs the server on the port
# Hugging Face expects (7860). You do NOT need any local setup — just create
# a Docker Space and paste this file (plus the README.md next to it).
#
# To deploy a different branch (e.g. once you merge the feature into main),
# change REPO_BRANCH below, or set it as a Space "Variable".

# ---------------------------------------------------------------------------
# Stage 1: build the frontend
# ---------------------------------------------------------------------------
FROM node:20-slim AS builder
WORKDIR /app
# ca-certificates is required so `git` can verify GitHub's HTTPS certificate
# (the slim image ships without root CAs).
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ARG REPO_URL=https://github.com/keovoin/data-formulator-ai.git
ARG REPO_BRANCH=add-editable-paste-sheet
RUN git clone --depth 1 --branch ${REPO_BRANCH} ${REPO_URL} .

# Builds into py-src/data_formulator/dist
RUN yarn install --frozen-lockfile && yarn build

# ---------------------------------------------------------------------------
# Stage 2: Python runtime with the built frontend bundled in
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc g++ libpq-dev unixodbc-dev curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV LANG=C.UTF-8
# Hugging Face Spaces run the container as UID 1000 with HOME=/home/user.
ENV HOME=/home/user
ENV DATA_FORMULATOR_HOME=/home/user/.data_formulator

# ---- OpenRouter defaults (the API KEY is set separately as a Space secret) --
# OpenRouter is OpenAI-compatible, so endpoint=openai + api_base routes through
# LiteLLM. The FIRST model in OPENROUTER_MODELS becomes the default selection.
ENV OPENROUTER_ENABLED=true \
    OPENROUTER_ENDPOINT=openai \
    OPENROUTER_API_BASE=https://openrouter.ai/api/v1 \
    OPENROUTER_MODELS="meta-llama/llama-3.3-70b-instruct:free,meta-llama/llama-3.3-70b-instruct,openai/gpt-4o-mini,anthropic/claude-3.5-sonnet,google/gemini-2.0-flash-001,deepseek/deepseek-chat"

WORKDIR /app
COPY --from=builder /app /app

RUN pip install --no-cache-dir .

# Non-root user expected by Hugging Face Spaces.
RUN useradd -m -u 1000 user \
    && mkdir -p "${DATA_FORMULATOR_HOME}" \
    && chown -R user:user /app /home/user
USER user

EXPOSE 7860

# --host 0.0.0.0 so HF can route traffic; --port 7860 is the HF default port.
ENTRYPOINT ["python", "-m", "data_formulator", "--host", "0.0.0.0", "--port", "7860"]

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# API for the Next.js app (see web/.env.local.example — BACKEND_URL).
PORT="${PORT:-8765}" exec node src/server.js

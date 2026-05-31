#!/usr/bin/env bash
#
# dev.sh — one-command local dev for AI Influencer OS.
#
# Starts the Express API (port 3000) and the Vite dev server (port 5173) together,
# guaranteeing a FRESH, cache-free frontend that can actually reach the backend
# APIs. Use the Vite URL (http://localhost:5173) — it proxies /api and /media to
# the backend. Press Ctrl+C once to stop both.
#
# Usage:
#   ./dev.sh              # clean caches, start backend + frontend, health-check
#   ./dev.sh --no-clean   # skip cache cleaning (faster restart)
#   ./dev.sh --install    # run npm installs (root + web) before starting
#   ./dev.sh --backend    # backend API only
#   ./dev.sh --frontend   # frontend dev server only (backend must be running)
#   ./dev.sh -h | --help  # show this help

set -euo pipefail

# Always operate from the repo root (the directory this script lives in).
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

API_PORT=3000
WEB_PORT=5173
WEB_URL="http://localhost:${WEB_PORT}"

# --- options --------------------------------------------------------------
DO_CLEAN=1
DO_INSTALL=0
RUN_BACKEND=1
RUN_FRONTEND=1

for arg in "$@"; do
  case "$arg" in
    --no-clean) DO_CLEAN=0 ;;
    --install)  DO_INSTALL=1 ;;
    --backend)  RUN_FRONTEND=0 ;;
    --frontend) RUN_BACKEND=0 ;;
    -h|--help)
      sed -n '3,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (try --help)" >&2
      exit 1
      ;;
  esac
done

# --- pretty logging -------------------------------------------------------
c_reset="\033[0m"; c_blue="\033[34m"; c_green="\033[32m"; c_yellow="\033[33m"; c_red="\033[31m"
log()  { printf "${c_blue}[dev]${c_reset} %s\n" "$1"; }
ok()   { printf "${c_green}[dev]${c_reset} %s\n" "$1"; }
warn() { printf "${c_yellow}[dev]${c_reset} %s\n" "$1"; }
err()  { printf "${c_red}[dev]${c_reset} %s\n" "$1" >&2; }

# --- cleanup on exit ------------------------------------------------------
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  echo
  log "Shutting down…"
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null || true
  [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null || true
  # Reap anything still bound to our ports so the next run is clean.
  free_port "$WEB_PORT"
  free_port "$API_PORT"
  ok "Stopped."
}

free_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti :"$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
}

# --- prerequisite checks --------------------------------------------------
if [ ! -f ".env" ]; then
  err "No .env found. Copy it first:  cp .env.example .env  (then fill in keys)"
  exit 1
fi

if [ "$DO_INSTALL" -eq 1 ]; then
  log "Installing dependencies (root + web)…"
  npm install --no-audit --no-fund
  npm --prefix web install --no-audit --no-fund
fi

if [ "$RUN_BACKEND" -eq 1 ] && [ ! -d "node_modules" ]; then
  err "Backend deps missing. Run:  ./dev.sh --install   (or: npm install)"
  exit 1
fi
if [ "$RUN_FRONTEND" -eq 1 ] && [ ! -d "web/node_modules" ]; then
  err "Frontend deps missing. Run:  ./dev.sh --install   (or: npm --prefix web install)"
  exit 1
fi

# --- clean caches + ports -------------------------------------------------
if [ "$DO_CLEAN" -eq 1 ]; then
  log "Cleaning stale ports and caches…"
  [ "$RUN_BACKEND" -eq 1 ] && free_port "$API_PORT"
  [ "$RUN_FRONTEND" -eq 1 ] && free_port "$WEB_PORT"
  # Vite's dep-optimize cache is the usual "old version" culprit; web/dist is the
  # stale PRODUCTION build that the backend would otherwise serve on :3000.
  rm -rf web/node_modules/.vite web/dist
  ok "Cleaned web/node_modules/.vite and web/dist."
fi

trap cleanup EXIT INT TERM

# --- start backend --------------------------------------------------------
if [ "$RUN_BACKEND" -eq 1 ]; then
  log "Starting backend API on :${API_PORT} …"
  # npm run dev frees the port itself, then starts node server/index.js.
  npm run dev &
  BACKEND_PID=$!

  # Wait until the API is actually accepting connections (up to ~30s).
  log "Waiting for the API to come up…"
  for i in $(seq 1 60); do
    if curl -sf "http://localhost:${API_PORT}/health" >/dev/null 2>&1 \
       || curl -sf "http://localhost:${API_PORT}/api/status" >/dev/null 2>&1; then
      ok "Backend is up on :${API_PORT}."
      break
    fi
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
      err "Backend exited before it was ready. Check the logs above."
      exit 1
    fi
    sleep 0.5
    if [ "$i" -eq 60 ]; then
      warn "Backend didn't answer health checks in time — continuing anyway."
    fi
  done
fi

# --- start frontend -------------------------------------------------------
if [ "$RUN_FRONTEND" -eq 1 ]; then
  log "Starting Vite dev server on :${WEB_PORT} (forced fresh, no cache)…"
  # --force re-bundles deps and ignores Vite's optimize cache on startup.
  npm --prefix web run dev -- --force &
  FRONTEND_PID=$!

  # Wait for Vite, then health-check the API *through the proxy* so we confirm
  # the frontend can actually reach the backend.
  for i in $(seq 1 60); do
    if curl -sf "${WEB_URL}/" >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done

  if [ "$RUN_BACKEND" -eq 1 ]; then
    if curl -sf "${WEB_URL}/api/status" >/dev/null 2>&1; then
      ok "Proxy works: ${WEB_URL}/api reaches the backend."
    else
      warn "Couldn't reach ${WEB_URL}/api/status yet (it may just need a moment)."
    fi
  fi
fi

echo
ok  "Ready. Open: ${WEB_URL}"
warn "Use ${WEB_URL} (NOT :${API_PORT}) so you get the live, non-cached app."
warn "Tip: hard-reload the browser with Cmd+Shift+R the first time."
warn "Note: editing server/** or .env requires a restart of this script."
echo
log "Press Ctrl+C to stop everything."

# Keep the script alive while the dev servers run; exit if either dies.
wait -n 2>/dev/null || wait

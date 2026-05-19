#!/bin/bash
# Wrapper invoked by launchd. Runs frank-scrape under 1Password secrets and
# caffeinate to prevent sleep mid-run.

set -euo pipefail

FRANK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OP="/usr/local/bin/op"
CAFFEINATE="/usr/bin/caffeinate"
SCRAPE_BIN="$FRANK_DIR/bin/frank-scrape"
ENV_TPL="$FRANK_DIR/.env.tpl"

# Ensure the log directory exists (also created by frank-scrape itself, but be safe)
mkdir -p "$HOME/Library/Logs/frank"

exec "$CAFFEINATE" -i "$OP" run --env-file="$ENV_TPL" -- "$SCRAPE_BIN"

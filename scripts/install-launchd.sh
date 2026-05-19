#!/bin/bash
# Installs the com.frank.scrape launchd agent.
# Run once: bash scripts/install-launchd.sh
# To uninstall: launchctl unload ~/Library/LaunchAgents/com.frank.scrape.plist

set -euo pipefail

FRANK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_SRC="$FRANK_DIR/scripts/com.frank.scrape.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.frank.scrape.plist"
LOG_DIR="$HOME/Library/Logs/frank"

echo "==> Creating log directory: $LOG_DIR"
mkdir -p "$LOG_DIR"

echo "==> Installing plist to $PLIST_DST"
mkdir -p "$HOME/Library/LaunchAgents"
sed \
  -e "s|FRANK_DIR|$FRANK_DIR|g" \
  -e "s|HOME_DIR|$HOME|g" \
  "$PLIST_SRC" > "$PLIST_DST"

# Unload first in case it's already loaded (ignore error if not loaded)
launchctl unload "$PLIST_DST" 2>/dev/null || true

echo "==> Loading agent"
launchctl load "$PLIST_DST"

echo ""
echo "Done. frank-scrape will run daily at 8am (or on next wake if the Mac was asleep)."
echo "Logs: $LOG_DIR"
echo ""
echo "To check status:  launchctl list | grep frank"
echo "To run now:       launchctl start com.frank.scrape"
echo "To uninstall:     launchctl unload $PLIST_DST && rm $PLIST_DST"

#!/bin/bash
# Remove SI Hive from this Mac.
#
#     bash ~/Library/Hive/uninstall.sh            # keeps your settings (~/.hive)
#     bash ~/Library/Hive/uninstall.sh --all      # also deletes ~/.hive and logs

set -uo pipefail

LABEL="dev.hive.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
rm -rf "$HOME/Library/Hive"
echo "Removed SI Hive and its LaunchAgent."

if [ "${1:-}" = "--all" ]; then
  rm -rf "$HOME/.hive" "$HOME/Library/Logs/Hive"
  echo "Removed settings (~/.hive) and logs."
else
  echo "Settings kept in ~/.hive and logs in ~/Library/Logs/Hive (use --all to remove them)."
fi

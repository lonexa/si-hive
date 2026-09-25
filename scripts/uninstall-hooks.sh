#!/usr/bin/env bash
set -euo pipefail

SETTINGS_FILE="$HOME/.claude/settings.json"
HIVE_MARKER="localhost:4747/api/events"

echo "=== SI Hive Hook Uninstall ==="
echo ""

# Check for jq
if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed."
    echo "Install it with: brew install jq (macOS) or apt-get install jq (Linux)"
    exit 1
fi

# Check if settings.json exists
if [ ! -f "$SETTINGS_FILE" ]; then
    echo "No settings file found at $SETTINGS_FILE. Nothing to remove."
    exit 0
fi

# Validate existing settings.json is valid JSON
if ! jq empty "$SETTINGS_FILE" 2>/dev/null; then
    echo "Error: $SETTINGS_FILE contains invalid JSON. Please fix it manually."
    exit 1
fi

# Check if there are any hooks at all
if ! jq -e '.hooks' "$SETTINGS_FILE" > /dev/null 2>&1; then
    echo "No hooks found in $SETTINGS_FILE. Nothing to remove."
    exit 0
fi

# Check if any SI Hive hooks exist
HIVE_COUNT=$(jq --arg marker "$HIVE_MARKER" '
    [.hooks // {} | to_entries[] | .value[] | .hooks[] | select(.command | contains($marker))] | length
' "$SETTINGS_FILE")

if [ "$HIVE_COUNT" -eq 0 ]; then
    echo "No SI Hive hooks found in $SETTINGS_FILE. Nothing to remove."
    exit 0
fi

echo "Found $HIVE_COUNT SI Hive hook(s). Removing..."

# Remove hook entries that contain the SI Hive URL, keep everything else
CLEANED=$(jq --arg marker "$HIVE_MARKER" '
    .hooks = (
        .hooks |
        to_entries |
        map(
            .value = [
                .value[] |
                select(
                    .hooks | all(.command | contains($marker) | not)
                )
            ]
        ) |
        # Remove event keys that have empty arrays
        map(select(.value | length > 0)) |
        from_entries
    ) |
    # Remove hooks key entirely if empty
    if (.hooks | length) == 0 then del(.hooks) else . end
' "$SETTINGS_FILE")

echo "$CLEANED" | jq '.' > "$SETTINGS_FILE"

echo ""
echo "SI Hive hooks removed successfully!"
echo ""
echo "Removed $HIVE_COUNT hook(s) targeting $HIVE_MARKER"
echo "Other hooks in $SETTINGS_FILE were preserved."

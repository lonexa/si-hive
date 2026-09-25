#!/bin/bash
# SI Hive installer for macOS.
#
# Run from the unzipped HiveMac folder, as yourself (NOT with sudo):
#
#     bash install.sh
#
# Installs everything under your own user account — no admin password:
#   ~/Library/Hive/node                       bundled Node.js
#   ~/Library/Hive/app                        SI Hive source, node_modules, built UI
#   ~/Library/LaunchAgents/dev.hive.server.plist   starts SI Hive at login
#   ~/Library/Logs/Hive/server.log            server log
#
# Everything is user-owned on purpose: "Refresh from Repo" in the app rewrites
# ~/Library/Hive/app and rebuilds it, which it could not do in a root-owned
# location like /usr/local.
#
# Re-running this script upgrades in place. Your settings and database live in
# ~/.hive and are never touched.

set -euo pipefail

LABEL="dev.hive.server"
PORT="${HIVE_PORT:-4747}"
BUNDLE_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$HOME/Library/Hive"
APP_DIR="$INSTALL_DIR/app"
NODE_DIR="$INSTALL_DIR/node"
LOG_DIR="$HOME/Library/Logs/Hive"
LOG_FILE="$LOG_DIR/server.log"
INSTALL_LOG="$LOG_DIR/install.log"
PLIST_DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE_VERSION="$(cat "$BUNDLE_DIR/NODE_VERSION" 2>/dev/null || echo "24.12.0")"

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
step()  { printf '\n\033[1;34m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
warn()  { printf '\033[1;33mWARNING:\033[0m %s\n' "$*"; }
fail()  {
  printf '\n\033[1;31mERROR:\033[0m %s\n' "$*" >&2
  printf 'Full install log: %s\n' "$INSTALL_LOG" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
[ "$(uname -s)" = "Darwin" ] || { echo "This installer is for macOS only." >&2; exit 1; }
if [ "$(id -u)" = "0" ]; then
  echo "Do not run this installer with sudo — run it as yourself:  bash install.sh" >&2
  exit 1
fi
[ -d "$BUNDLE_DIR/source/apps/hive" ] || { echo "source/ folder missing — run this from the unzipped HiveMac folder." >&2; exit 1; }

mkdir -p "$LOG_DIR"
: > "$INSTALL_LOG"

case "$(uname -m)" in
  arm64)  NODE_ARCH="arm64" ;;
  x86_64) NODE_ARCH="x64" ;;
  *) echo "Unsupported CPU: $(uname -m)" >&2; exit 1 ;;
esac

bold "Installing SI Hive $(cat "$BUNDLE_DIR/VERSION" 2>/dev/null || true) for macOS ($NODE_ARCH)"
echo "Install location: $INSTALL_DIR"
echo "This takes a few minutes (dependencies download from npm)."

# ---------------------------------------------------------------------------
# Stop any running copy
# ---------------------------------------------------------------------------
step "Stopping any existing SI Hive"
launchctl bootout "gui/$(id -u)/$LABEL" >>"$INSTALL_LOG" 2>&1 \
  || launchctl unload "$PLIST_DEST" >>"$INSTALL_LOG" 2>&1 \
  || true
sleep 1
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN || true
  fail "Port $PORT is already in use by the process above. Stop it and re-run the installer."
fi

# ---------------------------------------------------------------------------
# Node.js
# ---------------------------------------------------------------------------
step "Installing Node.js $NODE_VERSION"
NODE_DIST="node-v${NODE_VERSION}-darwin-${NODE_ARCH}"
NODE_TAR="$BUNDLE_DIR/node/${NODE_DIST}.tar.gz"
if [ ! -f "$NODE_TAR" ]; then
  echo "Not bundled — downloading from nodejs.org"
  NODE_TAR="$(mktemp -d)/${NODE_DIST}.tar.gz"
  curl -fSL --progress-bar "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_DIST}.tar.gz" -o "$NODE_TAR" \
    || fail "Could not download Node.js from nodejs.org."
fi
rm -rf "$NODE_DIR"
mkdir -p "$NODE_DIR"
tar -xzf "$NODE_TAR" -C "$NODE_DIR" --strip-components=1 || fail "Could not extract Node.js."
export PATH="$NODE_DIR/bin:$PATH"
echo "node $(node -v), npm $(npm -v)"

# ---------------------------------------------------------------------------
# App source
# ---------------------------------------------------------------------------
step "Copying SI Hive"
mkdir -p "$APP_DIR"
# Copy over the top rather than wiping the folder, the same way the in-app
# updater does — keeps node_modules and downloaded browsers on an upgrade.
cp -R "$BUNDLE_DIR/source/." "$APP_DIR/"
if [ -f "$BUNDLE_DIR/$LABEL.plist" ]; then
  mkdir -p "$APP_DIR/installer/mac"
  cp "$BUNDLE_DIR/$LABEL.plist" "$APP_DIR/installer/mac/"
fi
cp "$BUNDLE_DIR/uninstall.sh" "$INSTALL_DIR/uninstall.sh"
chmod +x "$INSTALL_DIR/uninstall.sh"

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
step "Installing dependencies (npm install — a few minutes)"
# Dev dependencies are required at runtime: the server runs through tsx, and
# Refresh from Repo rebuilds the UI with vite.
( cd "$APP_DIR" && npm install --no-audit --no-fund >>"$INSTALL_LOG" 2>&1 ) \
  || fail "npm install failed. The last lines of the log are:
$(tail -25 "$INSTALL_LOG")"

# node-pty ships its macOS helper without the execute bit, which makes every
# terminal fail with "posix_spawnp failed". startup.cjs also re-applies this
# on each start, in case a later update reinstalls node-pty.
chmod +x "$APP_DIR"/node_modules/node-pty/prebuilds/darwin-*/spawn-helper 2>/dev/null || true

step "Checking native modules"
if ! ( cd "$APP_DIR" && node -e "require('better-sqlite3'); require('node-pty')" >>"$INSTALL_LOG" 2>&1 ); then
  fail "better-sqlite3 / node-pty did not load. If npm had to compile them, install
Apple's command line tools and re-run this installer:
    xcode-select --install"
fi
echo "OK"

# ---------------------------------------------------------------------------
# Build the UI
# ---------------------------------------------------------------------------
step "Building the SI Hive UI"
( cd "$APP_DIR/apps/hive" && node "$APP_DIR/node_modules/vite/bin/vite.js" build >>"$INSTALL_LOG" 2>&1 ) \
  || fail "UI build failed. The last lines of the log are:
$(tail -25 "$INSTALL_LOG")"
echo "OK"

# Best effort, same as Windows: only the design-preview screenshot needs it.
if [ -f "$APP_DIR/node_modules/playwright/cli.js" ]; then
  step "Installing Chromium for screenshots (one-time, ~150 MB)"
  if PLAYWRIGHT_BROWSERS_PATH="$APP_DIR/.playwright-browsers" \
       node "$APP_DIR/node_modules/playwright/cli.js" install chromium >>"$INSTALL_LOG" 2>&1; then
    echo "OK"
  else
    warn "Chromium download failed — everything else works; only screenshot capture is disabled."
  fi
fi

# Files that came out of a browser-downloaded zip carry the quarantine flag.
xattr -dr com.apple.quarantine "$INSTALL_DIR" 2>/dev/null || true

# ---------------------------------------------------------------------------
# LaunchAgent
# ---------------------------------------------------------------------------
step "Registering SI Hive to start at login"
TEMPLATE="$APP_DIR/installer/mac/$LABEL.plist"
[ -f "$TEMPLATE" ] || fail "LaunchAgent template missing at $TEMPLATE"
SERVER_PATH="$NODE_DIR/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
mkdir -p "$(dirname "$PLIST_DEST")"
sed \
  -e "s|@@HIVE_HOME@@|$APP_DIR|g" \
  -e "s|@@NODE_BIN@@|$NODE_DIR/bin/node|g" \
  -e "s|@@LOG_FILE@@|$LOG_FILE|g" \
  -e "s|@@HIVE_PORT@@|$PORT|g" \
  -e "s|@@PATH@@|$SERVER_PATH|g" \
  -e "s|@@USER_HOME@@|$HOME|g" \
  -e "s|@@SERVICE_USER@@|$(id -un)|g" \
  "$TEMPLATE" > "$PLIST_DEST"
chmod 644 "$PLIST_DEST"
plutil -lint "$PLIST_DEST" >>"$INSTALL_LOG" 2>&1 || fail "Generated LaunchAgent plist is invalid: $PLIST_DEST"

echo "--- install $(date) ---" >> "$LOG_FILE"
launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST" >>"$INSTALL_LOG" 2>&1 \
  || launchctl load "$PLIST_DEST" >>"$INSTALL_LOG" 2>&1 \
  || fail "launchctl could not load $PLIST_DEST"

# ---------------------------------------------------------------------------
# Wait for it to come up
# ---------------------------------------------------------------------------
step "Starting SI Hive"
for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    echo "SI Hive is running."
    open "http://localhost:$PORT" || true
    echo
    bold "Done. SI Hive is at http://localhost:$PORT and will start automatically at login."
    echo "No sign-in is needed by default; turn on login in Settings → Authentication if you want it."
    echo "Server log:  $LOG_FILE"
    echo "Uninstall:   bash ~/Library/Hive/uninstall.sh"
    exit 0
  fi
  sleep 1
done

warn "SI Hive did not answer on port $PORT within 60 seconds. Last lines of the server log:"
tail -40 "$LOG_FILE" || true
echo
echo "It may still be starting — try http://localhost:$PORT in a minute."
echo "Server log: $LOG_FILE"
exit 1

#!/usr/bin/env bash
# Quiet build script for the Homey Toolbox Dashboard (Linux/macOS).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Installing dependencies (if needed)"
npm install --silent --no-audit --no-fund

case "$(uname -s)" in
  Darwin)  TARGET="release:macos" ;;
  Linux)   TARGET="release:linux" ;;
  *)       TARGET="tauri:build" ;;
esac

echo "==> Building (${TARGET})"
npm run "$TARGET" --silent

echo
echo "==> Done. Bundles:"
find src-tauri/target/release/bundle -maxdepth 3 \( -name '*.dmg' -o -name '*.app' -o -name '*.deb' -o -name '*.AppImage' \) 2>/dev/null | sed 's/^/  /'

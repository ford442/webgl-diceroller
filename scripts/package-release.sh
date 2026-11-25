#!/usr/bin/env bash
# Package dist/ as a reproducible zip + SHA-256 for a GitHub Release asset.
# Usage: scripts/package-release.sh vX.Y.Z[-rc.N]   (run after npm run build && npm run gates)
set -euo pipefail
TAG="${1:?usage: package-release.sh <tag>}"
[ -f dist/build-info.json ] || { echo "dist/ missing: run npm run build" >&2; exit 1; }
mkdir -p release
OUT="release/webgl-diceroller-${TAG}-dist.zip"
rm -f "$OUT"
# Fixed mtimes + sorted order so the same dist/ always yields the same bytes.
( cd dist && find . -type f | LC_ALL=C sort | TZ=UTC xargs touch -t 198001010000 && \
  find . -type f | LC_ALL=C sort | zip -X -q -@ "../$OUT" )
( cd release && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256" )
cat "$OUT.sha256"

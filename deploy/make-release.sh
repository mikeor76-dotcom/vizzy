#!/usr/bin/env bash
# Build and package a Vizzy release for publishing. Produces:
#   release/vizzy-<version>.zip      the prebuilt runtime (dist + scripts + meta)
#   release/manifest.json            drop this at VIZZY_UPDATE_MANIFEST_URL
#
# Usage:   bash deploy/make-release.sh [https://host/path/to/releases]
# The optional base URL is used to fill releaseUrl in the manifest.
set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

VERSION="$(bun -e 'console.log(require("./version.json").version)')"
BASE_URL="${1:-https://example.com/vizzy/releases}"
OUT="release"
ZIP="$OUT/vizzy-$VERSION.zip"

echo "==> Building v$VERSION"
bun install >/dev/null
bun run build

echo "==> Packaging $ZIP"
rm -rf "$OUT/stage"; mkdir -p "$OUT/stage"
for item in dist scripts package.json version.json README.md deploy; do
  [[ -e "$item" ]] && cp -a "$item" "$OUT/stage/"
done
( cd "$OUT/stage" && zip -rq "../vizzy-$VERSION.zip" . )
rm -rf "$OUT/stage"

SHA="$(shasum -a 256 "$ZIP" | awk '{print $1}')"
cat > "$OUT/manifest.json" <<EOF
{
  "version": "$VERSION",
  "releaseUrl": "$BASE_URL/v$VERSION/vizzy-$VERSION.zip",
  "sha256": "$SHA",
  "notes": "Vizzy $VERSION",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "minUpdaterVersion": "1.0.0"
}
EOF

echo "==> Done"
echo "    zip:      $ZIP  (sha256 $SHA)"
echo "    manifest: $OUT/manifest.json"
echo "    Publish the zip at the releaseUrl above and the manifest at VIZZY_UPDATE_MANIFEST_URL."

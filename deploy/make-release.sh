#!/usr/bin/env bash
# Build and package a Vizzy release for publishing. Produces:
#   release/vizzy-<version>.zip      the prebuilt runtime (dist + scripts + meta)
#   release/manifest.json            drop this at VIZZY_UPDATE_MANIFEST_URL
#
# Usage:   bash deploy/make-release.sh [release-download-base-url]
# Default base URL targets GitHub Releases assets (what the CI workflow
# publishes): https://github.com/<repo>/releases/download
# The device then reads the manifest at
#   https://github.com/<repo>/releases/latest/download/manifest.json
# which always redirects to the newest PUBLISHED, NON-draft, NON-prerelease
# release — exactly the eligibility rule we want, enforced by GitHub itself.
set -Eeuo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

GITHUB_REPO="${GITHUB_REPOSITORY:-mikeor76-dotcom/vizzy}"
VERSION="$(bun -e 'console.log(require("./version.json").version)')"
BASE_URL="${1:-https://github.com/$GITHUB_REPO/releases/download}"
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

# portable sha256 (macOS: shasum, Linux/CI: sha256sum)
if command -v sha256sum >/dev/null; then SHA="$(sha256sum "$ZIP" | awk '{print $1}')"
else SHA="$(shasum -a 256 "$ZIP" | awk '{print $1}')"; fi
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

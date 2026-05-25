#!/bin/bash
set -euo pipefail

REPO_SLUG="DeeJanuz/mcpviews-email-deliverability-plugin"
RELEASE_DIR="release"
BUILD_DIR=".build"

PACKAGES=(
  "email-deliverability:manifest.json"
  "email-campaigns:manifest.email-campaigns.json"
  "email-performance:manifest.email-performance.json"
)

echo "Building plugin release assets..."

rm -rf "${RELEASE_DIR}" "${BUILD_DIR}"
mkdir -p "${RELEASE_DIR}" "${BUILD_DIR}"

for package in "${PACKAGES[@]}"; do
  PLUGIN_NAME="${package%%:*}"
  MANIFEST_PATH="${package#*:}"
  ZIP_NAME="${PLUGIN_NAME}.zip"
  PACKAGE_BUILD_DIR="${BUILD_DIR}/${PLUGIN_NAME}"
  VERSION=$(python3 -c "import json; print(json.load(open('${MANIFEST_PATH}'))['version'])")
  DOWNLOAD_URL="https://github.com/${REPO_SLUG}/releases/download/${VERSION}/${ZIP_NAME}"

  python3 -c "
import json
path = '${MANIFEST_PATH}'
m = json.load(open(path))
m['download_url'] = '${DOWNLOAD_URL}'
json.dump(m, open(path, 'w'), indent=2)
open(path, 'a').write('\n')
print('  Updated ' + path + ' download_url')
"

  mkdir -p "${PACKAGE_BUILD_DIR}"
  cp "${MANIFEST_PATH}" "${PACKAGE_BUILD_DIR}/manifest.json"
  cp package.json "${PACKAGE_BUILD_DIR}/package.json"
  cp README.md "${PACKAGE_BUILD_DIR}/README.md"
  cp -r renderers "${PACKAGE_BUILD_DIR}/renderers"
  cp -r src "${PACKAGE_BUILD_DIR}/src"

  if [ -d fixtures ]; then
    cp -r fixtures "${PACKAGE_BUILD_DIR}/fixtures"
  fi

  echo "  Package: ${PLUGIN_NAME}"
  echo "  Version: ${VERSION}"
  echo "  Download URL: ${DOWNLOAD_URL}"

  cd "${PACKAGE_BUILD_DIR}"
  ZIP_INPUTS=(manifest.json package.json README.md renderers/ src/)
  if [ -d fixtures ]; then
    ZIP_INPUTS+=(fixtures/)
  fi
  zip -r "../../${RELEASE_DIR}/${ZIP_NAME}" "${ZIP_INPUTS[@]}"
  cd - >/dev/null

  echo "Built ${RELEASE_DIR}/${ZIP_NAME} ($(du -h "${RELEASE_DIR}/${ZIP_NAME}" | cut -f1))"
done

rm -rf "${BUILD_DIR}"

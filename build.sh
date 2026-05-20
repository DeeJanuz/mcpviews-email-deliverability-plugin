#!/bin/bash
set -euo pipefail

PLUGIN_NAME="email-deliverability"
ZIP_NAME="${PLUGIN_NAME}.zip"
REPO_SLUG="DeeJanuz/mcpviews-email-deliverability-plugin"
RELEASE_DIR="release"
BUILD_DIR=".build"

echo "Building ${ZIP_NAME}..."

rm -rf "${RELEASE_DIR}" "${BUILD_DIR}"
mkdir -p "${RELEASE_DIR}" "${BUILD_DIR}"

VERSION=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
DOWNLOAD_URL="https://github.com/${REPO_SLUG}/releases/download/${VERSION}/${ZIP_NAME}"

python3 -c "
import json
m = json.load(open('manifest.json'))
m['download_url'] = '${DOWNLOAD_URL}'
json.dump(m, open('manifest.json', 'w'), indent=2)
open('manifest.json', 'a').write('\n')
print('  Updated source manifest download_url')
"

cp manifest.json "${BUILD_DIR}/manifest.json"
cp package.json "${BUILD_DIR}/package.json"
cp README.md "${BUILD_DIR}/README.md"
cp -r renderers "${BUILD_DIR}/renderers"
cp -r src "${BUILD_DIR}/src"

if [ -d fixtures ]; then
  cp -r fixtures "${BUILD_DIR}/fixtures"
fi

echo "  Version: ${VERSION}"
echo "  Download URL: ${DOWNLOAD_URL}"

cd "${BUILD_DIR}"
ZIP_INPUTS=(manifest.json package.json README.md renderers/ src/)
if [ -d fixtures ]; then
  ZIP_INPUTS+=(fixtures/)
fi
zip -r "../${RELEASE_DIR}/${ZIP_NAME}" "${ZIP_INPUTS[@]}"
cd ..

rm -rf "${BUILD_DIR}"

echo "Built ${RELEASE_DIR}/${ZIP_NAME} ($(du -h "${RELEASE_DIR}/${ZIP_NAME}" | cut -f1))"

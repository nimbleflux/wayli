#!/bin/bash
# Script to update Fluxbase version across all configuration files
# Usage: ./scripts/update-fluxbase-version.sh <new-version>
# Example: ./scripts/update-fluxbase-version.sh 0.0.1-rc.82

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <new-version>"
    echo "Example: $0 0.0.1-rc.82"
    exit 1
fi

NEW_VERSION="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Updating Fluxbase to version: $NEW_VERSION"
echo ""

# Update .devcontainer/docker-compose.yml (fallback version in env var syntax)
echo "Updating .devcontainer/docker-compose.yml..."
sed -i '' "s|FLUXBASE_VERSION:-[0-9a-zA-Z.-]*}|FLUXBASE_VERSION:-$NEW_VERSION}|g" "$ROOT_DIR/.devcontainer/docker-compose.yml"

# Update .devcontainer/Dockerfile (Fluxbase CLI version)
echo "Updating .devcontainer/Dockerfile..."
sed -i '' "s|ARG FLUXBASE_CLI_VERSION=v[0-9a-zA-Z.-]*|ARG FLUXBASE_CLI_VERSION=v$NEW_VERSION|g" "$ROOT_DIR/.devcontainer/Dockerfile"

# Update deploy/docker-compose/docker-compose.yml
echo "Updating deploy/docker-compose/docker-compose.yml..."
sed -i '' "s|ghcr.io/nimbleflux/fluxbase:[0-9a-zA-Z.-]*|ghcr.io/nimbleflux/fluxbase:$NEW_VERSION|g" "$ROOT_DIR/deploy/docker-compose/docker-compose.yml"

# Update charts/wayli/Chart.yaml (dependency only — anchored to the indented,
# quoted form; the chart's own unquoted `version:` must not be touched)
echo "Updating charts/wayli/Chart.yaml..."
sed -i '' "s|^    version: '[0-9a-zA-Z.-]*'|    version: '$NEW_VERSION'|" "$ROOT_DIR/charts/wayli/Chart.yaml"

# Update Dockerfile (Fluxbase CLI version ARG)
echo "Updating Dockerfile..."
sed -i '' "s|ARG FLUXBASE_CLI_VERSION=v[0-9a-zA-Z.-]*|ARG FLUXBASE_CLI_VERSION=v$NEW_VERSION|g" "$ROOT_DIR/Dockerfile"

# Update .github/workflows/release.yml (CLI version env for the checksummed install)
echo "Updating .github/workflows/release.yml..."
sed -i '' "s|FLUXBASE_CLI_VERSION: v[0-9a-zA-Z.-]*|FLUXBASE_CLI_VERSION: v$NEW_VERSION|g" "$ROOT_DIR/.github/workflows/release.yml"

# Update android/gradle/libs.versions.toml (fluxbase-kotlin SDK, bare version)
echo "Updating android/gradle/libs.versions.toml..."
sed -i '' "s|fluxbase-kotlin = \"[0-9a-zA-Z.-]*\"|fluxbase-kotlin = \"$NEW_VERSION\"|" "$ROOT_DIR/android/gradle/libs.versions.toml"

# Update Helm dependencies
echo ""
echo "Updating Helm dependencies..."
cd "$ROOT_DIR/charts/wayli"
helm dependency update

# Fail loudly if the lockfile did not actually pick up the new version —
# a stale Chart.lock silently ships the old subchart (this exact drift
# happened: lock at 2026.8.14 while Chart.yaml said 2026.9.2).
if ! grep -q "$NEW_VERSION" "$ROOT_DIR/charts/wayli/Chart.lock"; then
    echo "Error: charts/wayli/Chart.lock does not reference $NEW_VERSION after 'helm dependency update'" >&2
    exit 1
fi

# Update web/package.json - Fluxbase SDK packages
echo ""
echo "Updating web/package.json..."
SDK_PACKAGE="@nimbleflux/fluxbase-sdk"
SDK_REACT_PACKAGE="@nimbleflux/fluxbase-sdk-react"

if grep -q "$SDK_PACKAGE" "$ROOT_DIR/web/package.json"; then
    sed -i '' "s|\"$SDK_PACKAGE\": \"[\\^]*[0-9a-zA-Z._-]*\"|\"$SDK_PACKAGE\": \"$NEW_VERSION\"|g" "$ROOT_DIR/web/package.json"
    echo "  Updated $SDK_PACKAGE to $NEW_VERSION"
else
    # Add the package to dependencies
    sed -i '' "s|\"dependencies\": {|\"dependencies\": {\n\t\t\"$SDK_PACKAGE\": \"$NEW_VERSION\",|g" "$ROOT_DIR/web/package.json"
    echo "  Added $SDK_PACKAGE $NEW_VERSION"
fi

if grep -q "$SDK_REACT_PACKAGE" "$ROOT_DIR/web/package.json"; then
    sed -i '' "s|\"$SDK_REACT_PACKAGE\": \"[\\^]*[0-9a-zA-Z._-]*\"|\"$SDK_REACT_PACKAGE\": \"$NEW_VERSION\"|g" "$ROOT_DIR/web/package.json"
    echo "  Updated $SDK_REACT_PACKAGE to $NEW_VERSION"
else
    echo "  Note: $SDK_REACT_PACKAGE not found in package.json (skipping)"
fi

# Update web bun.lock
echo ""
echo "Updating web/bun.lock..."
cd "$ROOT_DIR/web"
bun install

# Update fluxbase/functions/deno.json - Fluxbase SDK for Deno edge functions
echo ""
echo "Updating fluxbase/functions/deno.json..."
SDK_PACKAGE="npm:@nimbleflux/fluxbase-sdk"
sed -i '' "s|\"$SDK_PACKAGE@[0-9a-zA-Z.-]*\"|\"$SDK_PACKAGE@$NEW_VERSION\"|g" "$ROOT_DIR/fluxbase/functions/deno.json"
sed -i '' "s|\"$SDK_PACKAGE@[0-9a-zA-Z.-]*/\"|\"$SDK_PACKAGE@$NEW_VERSION/\"|g" "$ROOT_DIR/fluxbase/functions/deno.json"
echo "  Updated SDK to $NEW_VERSION"

echo ""
echo "Done! Fluxbase updated to version $NEW_VERSION"
echo ""
echo "Updated files:"
echo "  - .devcontainer/docker-compose.yml"
echo "  - .devcontainer/Dockerfile"
echo "  - deploy/docker-compose/docker-compose.yml"
echo "  - charts/wayli/Chart.yaml"
echo "  - charts/wayli/Chart.lock (+ vendored subchart tgz)"
echo "  - Dockerfile"
echo "  - .github/workflows/release.yml"
echo "  - android/gradle/libs.versions.toml (fluxbase-kotlin)"
echo "  - web/package.json (@nimbleflux/fluxbase-sdk, @nimbleflux/fluxbase-sdk-react)"
echo "  - web/bun.lock"
echo "  - fluxbase/functions/deno.json (@nimbleflux/fluxbase-sdk)"

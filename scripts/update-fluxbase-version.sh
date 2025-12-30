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

# Update .devcontainer/docker-compose.yml
echo "Updating .devcontainer/docker-compose.yml..."
sed -i '' "s|ghcr.io/wayli-app/fluxbase:[0-9a-zA-Z.-]*|ghcr.io/wayli-app/fluxbase:$NEW_VERSION|g" "$ROOT_DIR/.devcontainer/docker-compose.yml"

# Update deploy/docker-compose/docker-compose.yml
echo "Updating deploy/docker-compose/docker-compose.yml..."
sed -i '' "s|ghcr.io/fluxbase-eu/fluxbase:[0-9a-zA-Z.-]*|ghcr.io/fluxbase-eu/fluxbase:$NEW_VERSION|g" "$ROOT_DIR/deploy/docker-compose/docker-compose.yml"

# Update charts/wayli/Chart.yaml
echo "Updating charts/wayli/Chart.yaml..."
sed -i '' "s|version: '[0-9a-zA-Z.-]*'|version: '$NEW_VERSION'|g" "$ROOT_DIR/charts/wayli/Chart.yaml"

# Update Dockerfile (Fluxbase CLI version ARG)
echo "Updating Dockerfile..."
sed -i '' "s|ARG FLUXBASE_CLI_VERSION=v[0-9a-zA-Z.-]*|ARG FLUXBASE_CLI_VERSION=v$NEW_VERSION|g" "$ROOT_DIR/Dockerfile"

# Update Helm dependencies
echo ""
echo "Updating Helm dependencies..."
cd "$ROOT_DIR/charts/wayli"
helm dependency update

# Update web/package.json
echo ""
echo "Updating web/package.json..."
sed -i '' "s|\"@fluxbase/sdk\": \"\\^[0-9a-zA-Z.-]*\"|\"@fluxbase/sdk\": \"^$NEW_VERSION\"|g" "$ROOT_DIR/web/package.json"

# Update web package-lock.json
echo ""
echo "Updating web/package-lock.json..."
cd "$ROOT_DIR/web"
npm install

echo ""
echo "Done! Fluxbase updated to version $NEW_VERSION"
echo ""
echo "Updated files:"
echo "  - .devcontainer/docker-compose.yml"
echo "  - deploy/docker-compose/docker-compose.yml"
echo "  - charts/wayli/Chart.yaml"
echo "  - charts/wayli/Chart.lock"
echo "  - Dockerfile"
echo "  - web/package.json"
echo "  - web/package-lock.json"

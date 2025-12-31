#!/bin/bash
# Docker Entrypoint Script for Wayli Web Application
#
# Starts nginx to serve the static SvelteKit app and syncs Fluxbase resources.
#
# Author: Wayli Development Team
# Version: 4.0.0

set -e

echo "=== Container Starting ==="
echo "Current directory: $(pwd)"

# Start the web server
echo "Starting web server..."
exec /usr/local/bin/startup.sh

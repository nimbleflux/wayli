#!/bin/bash
# Docker Entrypoint Script for Wayli Web Application
#
# This script handles starting different services based on the APP_MODE environment variable:
# - APP_MODE=web: Starts nginx to serve the SvelteKit app
# - APP_MODE=worker: Starts a background worker process
# - APP_MODE=combined: Starts both nginx and worker in a single container
#
# Author: Wayli Development Team
# Version: 3.4.0

set -e

echo "=== Container Starting ==="
echo "Current directory: $(pwd)"
echo "APP_MODE: ${APP_MODE:-web (default)}"

# Validate APP_MODE
case "${APP_MODE:-web}" in
    "web"|"worker"|"combined")
        echo "Valid APP_MODE: ${APP_MODE:-web}"
        ;;
    *)
        echo "Invalid APP_MODE: ${APP_MODE}. Must be one of: web, worker, combined"
        exit 1
        ;;
esac

# Function to start worker
start_worker() {
    echo "Starting worker..."

    # Start worker process using npm script (already running as wayli)
    exec npm run worker
}

# Function to start web server
start_web() {
    echo "Starting web server..."

    # Use the startup script for web mode
    exec /usr/local/bin/startup.sh
}

# Function to start combined mode (web + worker)
start_combined() {
    echo "Starting combined mode (web + worker)..."

    # Use the startup script for combined mode
    exec /usr/local/bin/startup.sh
}

# Start appropriate service based on APP_MODE
case "${APP_MODE:-web}" in
    "web")
        start_web
        ;;
    "worker")
        start_worker
        ;;
    "combined")
        start_combined
        ;;
esac

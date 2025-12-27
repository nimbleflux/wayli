#!/bin/bash

# Startup script for Wayli - handles web mode
# APP_MODE is set by docker-entrypoint.sh

set -e

# Track child PIDs for cleanup
NGINX_PID=""

# Cleanup function for graceful shutdown
cleanup() {
    echo "Shutting down..."

    if [ -n "$NGINX_PID" ] && kill -0 "$NGINX_PID" 2>/dev/null; then
        echo "Stopping nginx (PID: $NGINX_PID)..."
        kill -TERM "$NGINX_PID" 2>/dev/null || true
        wait "$NGINX_PID" 2>/dev/null || true
    fi

    echo "Shutdown complete"
    exit 0
}

# Configure nginx (used by web and combined modes)
configure_nginx() {
    echo "Configuring nginx for runtime..."

    # Create writable directories for Kubernetes (read-only filesystem)
    mkdir -p /tmp/nginx/html \
             /tmp/nginx/client_body \
             /tmp/nginx/proxy \
             /tmp/nginx/fastcgi \
             /tmp/nginx/uwsgi \
             /tmp/nginx/scgi

    # Extract domain from FLUXBASE_BASE_URL for CSP header
    # Example: https://xyz.fluxbase.eu -> https://*.fluxbase.eu
    if [ -n "$FLUXBASE_BASE_URL" ]; then
        # Extract the protocol and domain pattern
        FLUXBASE_DOMAIN=$(echo "$FLUXBASE_BASE_URL" | sed -E 's|(https?://)[^.]+\.(.+)|\1*.\2|')
        echo "Fluxbase domain: $FLUXBASE_DOMAIN"
    else
        echo "Warning: FLUXBASE_BASE_URL not set, using default CSP"
        FLUXBASE_DOMAIN="https://*.fluxbase.eu"
    fi

    # Copy nginx config to writable location and inject CSP
    echo "Configuring Content Security Policy..."
    cp /etc/nginx/nginx.conf /tmp/nginx/nginx.conf
    sed -i "s|{{FLUXBASE_DOMAIN}}|$FLUXBASE_DOMAIN|g" /tmp/nginx/nginx.conf

    # Copy HTML files to writable location for env var injection
    echo "Copying static files..."
    cp -r /usr/share/nginx/html/* /tmp/nginx/html/

    # Navigate to writable html directory
    cd /tmp/nginx/html

    # Inject environment variables into HTML files
    # Use FLUXBASE_PUBLIC_BASE_URL for browser clients (required for client-side access)
    echo "Injecting environment variables into HTML..."
    for file in *.html; do
        if [ -f "$file" ]; then
            echo "   Processing $file..."
            sed -i "s|{{FLUXBASE_PUBLIC_BASE_URL}}|${FLUXBASE_PUBLIC_BASE_URL}|g" "$file"
            sed -i "s|{{FLUXBASE_ANON_KEY}}|${PUBLIC_FLUXBASE_ANON_KEY:-$FLUXBASE_ANON_KEY}|g" "$file"
        fi
    done

    echo "Nginx configuration complete"
}

# Sync all Fluxbase resources (RPC, functions, jobs, chatbots, migrations) using Fluxbase CLI
sync_all() {
    # Check if sync should be skipped (useful for Kubernetes where init container handles sync)
    if [ "$SKIP_SYNC" = "true" ]; then
        echo "SKIP_SYNC is set, skipping all sync operations"
        return 0
    fi

    # Verify environment variables are set
    if [ -z "$FLUXBASE_BASE_URL" ] || [ -z "$FLUXBASE_SERVICE_ROLE_KEY" ]; then
        echo "Warning: FLUXBASE_BASE_URL or FLUXBASE_SERVICE_ROLE_KEY not set"
        echo "Skipping sync - resources will need to be synced manually"
        return 0
    fi

    echo "Syncing all Fluxbase resources using CLI..."

    # Set CLI environment variables (CLI expects FLUXBASE_SERVER and FLUXBASE_TOKEN)
    export FLUXBASE_SERVER="$FLUXBASE_BASE_URL"
    export FLUXBASE_TOKEN="$FLUXBASE_SERVICE_ROLE_KEY"

    # Run fluxbase CLI sync for each resource type
    local failed=0

    echo "Syncing RPC procedures..."
    fluxbase sync rpc --dir /app/fluxbase || failed=1

    echo "Syncing functions..."
    fluxbase sync functions --dir /app/fluxbase || failed=1

    echo "Syncing jobs..."
    fluxbase sync jobs --dir /app/fluxbase || failed=1

    echo "Syncing chatbots..."
    fluxbase sync chatbots --dir /app/fluxbase || failed=1

    echo "Syncing migrations..."
    fluxbase sync migrations --dir /app/fluxbase || failed=1

    if [ "$failed" -eq 1 ]; then
        echo "Error: One or more sync operations failed"
        echo "Cannot continue - resources may be out of sync"
        exit 1
    fi

    echo "All sync operations completed successfully"
}

# Start nginx in foreground (web-only mode)
start_nginx_foreground() {
    echo "Starting nginx..."
    exec nginx -c /tmp/nginx/nginx.conf -e /dev/stderr -g "daemon off;"
}

# Start nginx in background (combined mode)
start_nginx_background() {
    echo "Starting nginx in background..."
    nginx -c /tmp/nginx/nginx.conf -e /dev/stderr -g "daemon off;" &
    NGINX_PID=$!
    echo "Nginx started (PID: $NGINX_PID)"
}

# Main execution based on APP_MODE
case "${APP_MODE:-web}" in
    "web"|"combined")
        configure_nginx
        sync_all
        start_nginx_foreground
        ;;
    *)
        echo "Unknown APP_MODE: ${APP_MODE}"
        exit 1
        ;;
esac

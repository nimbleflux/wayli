#!/bin/bash

# Startup script for Wayli web server
# Configures nginx, syncs Fluxbase resources, and starts serving

set -e

# Configure nginx for runtime
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
    fluxbase rpc sync --dir /app/fluxbase/rpc --namespace wayli || failed=1

    echo "Syncing functions..."
    fluxbase functions sync --dir /app/fluxbase/functions --namespace wayli || failed=1

    echo "Syncing jobs..."
    fluxbase jobs sync --dir /app/fluxbase/jobs --namespace wayli || failed=1

    echo "Syncing chatbots..."
    fluxbase chatbots sync --dir /app/fluxbase/chatbots --namespace wayli || failed=1

    echo "Syncing migrations..."
    fluxbase migrations sync --dir /app/fluxbase/migrations --namespace wayli || failed=1

    if [ "$failed" -eq 1 ]; then
        echo "Error: One or more sync operations failed"
        echo "Cannot continue - resources may be out of sync"
        exit 1
    fi

    echo "All sync operations completed successfully"
}

# Start nginx in foreground
start_nginx() {
    echo "Starting nginx..."
    exec nginx -c /tmp/nginx/nginx.conf -e /dev/stderr -g "daemon off;"
}

# Main execution
configure_nginx
sync_all
start_nginx

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
    # Use PUBLIC_FLUXBASE_BASE_URL for browser clients (falls back to FLUXBASE_BASE_URL)
    echo "Injecting environment variables into HTML..."
    for file in *.html; do
        if [ -f "$file" ]; then
            echo "   Processing $file..."
            sed -i "s|{{FLUXBASE_BASE_URL}}|${PUBLIC_FLUXBASE_BASE_URL:-$FLUXBASE_BASE_URL}|g" "$file"
            sed -i "s|{{FLUXBASE_ANON_KEY}}|${PUBLIC_FLUXBASE_ANON_KEY:-$FLUXBASE_ANON_KEY}|g" "$file"
            sed -i "s|{{FLUXBASE_SERVICE_ROLE_KEY}}|$FLUXBASE_SERVICE_ROLE_KEY|g" "$file"
        fi
    done

    echo "Nginx configuration complete"
}

# Sync Fluxbase migrations
sync_migrations() {
    echo "Syncing Fluxbase migrations..."

    # Check if sync should be skipped (useful for testing/dev)
    if [ "$SKIP_MIGRATION_SYNC" = "true" ]; then
        echo "⚠️  SKIP_MIGRATION_SYNC is set, skipping migration sync"
        return 0
    fi

    # Verify environment variables are set
    if [ -z "$FLUXBASE_BASE_URL" ] || [ -z "$FLUXBASE_SERVICE_ROLE_KEY" ]; then
        echo "⚠️  Warning: FLUXBASE_BASE_URL or FLUXBASE_SERVICE_ROLE_KEY not set"
        echo "⚠️  Skipping migration sync - migrations will need to be run manually"
        return 0
    fi

    cd /app

    # Run migration sync script
    if npm run sync-migrations; then
        echo "✅ Migration sync completed successfully"
    else
        echo "❌ Error: Migration sync failed (exit code: $?)"
        echo "❌ Cannot continue - database schema may be out of date"
        exit 1
    fi
}

# Sync Fluxbase edge functions
sync_functions() {
    echo "Syncing Fluxbase edge functions..."

    # Check if sync should be skipped (useful for testing/dev)
    if [ "$SKIP_FUNCTION_SYNC" = "true" ]; then
        echo "⚠️  SKIP_FUNCTION_SYNC is set, skipping function sync"
        return 0
    fi

    # Verify environment variables are set
    if [ -z "$FLUXBASE_BASE_URL" ] || [ -z "$FLUXBASE_SERVICE_ROLE_KEY" ]; then
        echo "⚠️  Warning: FLUXBASE_BASE_URL or FLUXBASE_SERVICE_ROLE_KEY not set"
        echo "⚠️  Skipping function sync - functions will need to be deployed manually"
        return 0
    fi

    cd /app

    # Run function sync script
    if npm run sync-functions; then
        echo "✅ Function sync completed successfully"
    else
        echo "⚠️  Warning: Function sync failed (exit code: $?)"
        echo "⚠️  Continuing startup - functions may not be available"
        # Don't exit - allow the app to start even if function sync fails
    fi
}

# Sync Fluxbase job handlers
# NOTE: Commented out until Fluxbase Jobs platform is available
# Job handlers are validated but not synced to platform yet
sync_jobs() {
    echo "Syncing Fluxbase job handlers..."

    # Check if sync should be skipped (useful for testing/dev)
    if [ "$SKIP_JOB_SYNC" = "true" ]; then
        echo "⚠️  SKIP_JOB_SYNC is set, skipping job sync"
        return 0
    fi

    # Verify environment variables are set
    if [ -z "$FLUXBASE_BASE_URL" ] || [ -z "$FLUXBASE_SERVICE_ROLE_KEY" ]; then
        echo "⚠️  Warning: FLUXBASE_BASE_URL or FLUXBASE_SERVICE_ROLE_KEY not set"
        echo "⚠️  Skipping job sync - jobs will need to be deployed manually"
        return 0
    fi

    cd /app

    # Run job sync script (currently just validates handlers)
    if npm run sync-jobs; then
        echo "✅ Job validation completed successfully"
    else
        echo "⚠️  Warning: Job validation failed (exit code: $?)"
        echo "⚠️  Continuing startup - jobs will still run via worker"
        # Don't exit - allow the app to start even if job validation fails
    fi
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
        sync_migrations
        sync_functions
        sync_jobs
        start_nginx_foreground
        ;;
    *)
        echo "Unknown APP_MODE: ${APP_MODE}"
        exit 1
        ;;
esac

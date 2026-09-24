#!/bin/bash

# Startup script for Wayli web server
# Configures nginx, syncs Fluxbase resources, and starts serving

set -e

# Escape sed replacement metacharacters (&, |, backslash) so runtime values
# (URLs with query strings, keys containing specials) can't corrupt the
# expression or inject into the generated config.
sed_safe() {
    printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'
}

# Replace a {{PLACEHOLDER}} in a file with a runtime value, safely.
replace_placeholder() {
    local file="$1" placeholder="$2" value="$3"
    sed -i "s|${placeholder}|$(sed_safe "$value")|g" "$file"
}

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
    replace_placeholder /tmp/nginx/nginx.conf '{{FLUXBASE_DOMAIN}}' "$FLUXBASE_DOMAIN"
    replace_placeholder /tmp/nginx/nginx.conf '{{PORT}}' "${PORT:-80}"

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
            replace_placeholder "$file" '{{FLUXBASE_PUBLIC_BASE_URL}}' "${FLUXBASE_PUBLIC_BASE_URL}"
            replace_placeholder "$file" '{{FLUXBASE_ANON_KEY}}' "${PUBLIC_FLUXBASE_ANON_KEY:-$FLUXBASE_ANON_KEY}"
        fi
    done

    # wayli-app.json is the instance manifest the Android app discovers its
    # Fluxbase backend through (same placeholders as the HTML).
    if [ -f wayli-app.json ]; then
        echo "   Processing wayli-app.json..."
        replace_placeholder wayli-app.json '{{FLUXBASE_PUBLIC_BASE_URL}}' "${FLUXBASE_PUBLIC_BASE_URL}"
        replace_placeholder wayli-app.json '{{FLUXBASE_ANON_KEY}}' "${PUBLIC_FLUXBASE_ANON_KEY:-$FLUXBASE_ANON_KEY}"
    fi

    echo "Nginx configuration complete"
}

# Sync all Fluxbase resources (RPC, functions, jobs, chatbots, migrations) using Fluxbase CLI
sync_all() {
    # Check if sync should be skipped (useful for Kubernetes where init container handles sync)
    if [ "$SKIP_SYNC" = "true" ]; then
        echo "SKIP_SYNC is set, skipping all sync operations"
        return 0
    fi

    # Verify environment variables are set. Fail CLOSED: a container that
    # boots without sync will have no schema, no RPCs, no RLS — silently
    # serving that state is worse than crashing (orchestrators restart us,
    # and the /health endpoint stays 503 so nothing routes here). Operators
    # who intentionally skip sync set SKIP_SYNC=true, handled above.
    if [ -z "$FLUXBASE_BASE_URL" ] || [ -z "$FLUXBASE_SERVICE_ROLE_KEY" ]; then
        echo "Error: FLUXBASE_BASE_URL and FLUXBASE_SERVICE_ROLE_KEY must be set"
        echo "(set SKIP_SYNC=true to intentionally run without resource sync)"
        exit 1
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

    echo "Syncing declarative schema..."
    # Enable required extensions via Fluxbase API (PostGIS not in Fluxbase's bootstrap)
    fluxbase extensions enable postgis 2>/dev/null || true
    fluxbase extensions enable postgis_topology 2>/dev/null || true
    fluxbase schema sync --dir /app/fluxbase/schema --namespace wayli || failed=1

    if [ "$failed" -eq 1 ]; then
        echo "Error: One or more sync operations failed"
        echo "Cannot continue - resources may be out of sync"
        exit 1
    fi

    echo "All sync operations completed successfully"
}

# Ensure knowledge base exists for POI semantic search
ensure_knowledge_base() {
    # Skip if sync was skipped (CLI environment not set up)
    if [ "$SKIP_SYNC" = "true" ]; then
        return 0
    fi

    echo "Ensuring knowledge base exists..."

    # Create the wayli-pois knowledge base if it doesn't exist (the
    # sync-poi-embeddings job needs it). Match the name field with optional
    # whitespace around the colon so the check is robust to both compact and
    # pretty-printed JSON. (jq would be cleaner but is not installed in the
    # production web image.)
    KB_LIST_JSON=$(fluxbase kb list --namespace wayli -o json 2>/dev/null || true)
    if printf '%s' "$KB_LIST_JSON" | grep -qE '"name"[[:space:]]*:[[:space:]]*"wayli-pois"'; then
        echo "Knowledge base already exists"
    else
        echo "Creating knowledge base..."
        if fluxbase kb create wayli-pois \
            --namespace wayli \
            --description "User POI visits with behavioral context for semantic search" \
            --chunk-size 500 \
            --embedding-model text-embedding-3-small 2>&1; then
            echo "Knowledge base created successfully"
        else
            echo "Warning: Failed to create knowledge base (embedding features degraded)"
            return 0
        fi
    fi

    # NOTE: no kb export-table here. Boot-time exports of place_visits /
    # user_preferences wrote real user rows into the instance-global KB with
    # no user scoping — the chatbot RAG would serve one user's visits to
    # another. Per-user documents are embedded by the sync-poi-embeddings job,
    # which stamps metadata.user_id so retrieval filters per caller.

    echo "Knowledge base ready"
}

# Mark the container healthy for the nginx /health endpoint. Written only
# after resource sync has succeeded (or was intentionally skipped); until the
# file exists, /health answers 503 so orchestrators don't route to a container
# whose schema/RPCs never synced.
mark_healthy() {
    printf 'healthy\n' > /tmp/nginx/health
}

# Start nginx in foreground
start_nginx() {
    echo "Starting nginx..."
    exec nginx -c /tmp/nginx/nginx.conf -e /dev/stderr -g "daemon off;"
}

# Main execution
configure_nginx
sync_all
ensure_knowledge_base
mark_healthy
start_nginx

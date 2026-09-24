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
    sed -i "s|{{PORT}}|${PORT:-80}|g" /tmp/nginx/nginx.conf

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

    # wayli-app.json is the instance manifest the Android app discovers its
    # Fluxbase backend through (same placeholders as the HTML).
    if [ -f wayli-app.json ]; then
        echo "   Processing wayli-app.json..."
        sed -i "s|{{FLUXBASE_PUBLIC_BASE_URL}}|${FLUXBASE_PUBLIC_BASE_URL}|g" wayli-app.json
        sed -i "s|{{FLUXBASE_ANON_KEY}}|${PUBLIC_FLUXBASE_ANON_KEY:-$FLUXBASE_ANON_KEY}|g" wayli-app.json
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

    echo "Syncing declarative schema..."
    # Enable required extensions via Fluxbase API (PostGIS not in Fluxbase's bootstrap)
    fluxbase extensions enable postgis 2>/dev/null || true
    fluxbase extensions enable postgis_topology 2>/dev/null || true
    fluxbase schema sync --dir /app/fluxbase/schema --namespace wayli || failed=1

    echo "Syncing MCP tools..."
    fluxbase mcp tools sync --dir /app/fluxbase/mcp-tools --namespace wayli || failed=1

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

    # Create the wayli-pois knowledge base if it doesn't exist.
    # Match the name field with optional whitespace around the colon so the
    # check is robust to both compact and pretty-printed JSON. (jq would be
    # cleaner but is not installed in the production web image.)
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
            # Re-list so the ID extraction below can find the just-created KB.
            KB_LIST_JSON=$(fluxbase kb list --namespace wayli -o json 2>/dev/null || true)
        else
            echo "Warning: Failed to create knowledge base, skipping table exports"
            return 0
        fi
    fi

    # Get the KB ID for table exports. Use the wayli-pois object's id when
    # possible; fall back to the first id in the listing. All extraction uses
    # `|| true` and `if [ -z ]` guards because `grep` returns a non-zero exit
    # code on no-match, which would abort the script under `set -e`.
    KB_ID=""
    # Match the whole wayli-pois object ({...}) regardless of id/name order.
    KB_OBJ=$(printf '%s' "$KB_LIST_JSON" | grep -oE '\{[^{}]*"wayli-pois"[^{}]*\}' | head -1 || true)
    if [ -n "$KB_OBJ" ]; then
        KB_ID=$(printf '%s' "$KB_OBJ" | grep -oE '"id"[[:space:]]*:[[:space:]]*"[0-9a-f-]{36}"' | grep -oE '[0-9a-f-]{36}' | head -1 || true)
    fi
    if [ -z "$KB_ID" ]; then
        KB_ID=$(printf '%s' "$KB_LIST_JSON" | grep -oE '"id"[[:space:]]*:[[:space:]]*"[0-9a-f-]{36}"' | head -1 | grep -oE '[0-9a-f-]{36}' || true)
    fi

    if [ -z "$KB_ID" ]; then
        echo "Warning: Could not get KB ID for table exports"
        return 0
    fi

    # NOTE: no kb export-table here. Boot-time exports of place_visits /
    # user_preferences wrote real user rows into the instance-global KB with
    # no user scoping — the chatbot RAG would serve one user's visits to
    # another. Per-user documents are embedded by the sync-poi-embeddings job,
    # which stamps metadata.user_id so retrieval filters per caller.

    echo "Knowledge base ready"
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
start_nginx

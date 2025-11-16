#!/bin/bash

echo "🔧 Configuring nginx for runtime..."

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
  echo "📍 Fluxbase domain: $FLUXBASE_DOMAIN"
else
  echo "⚠️  Warning: FLUXBASE_BASE_URL not set, using default CSP"
  FLUXBASE_DOMAIN="https://*.fluxbase.eu"
fi

# Copy nginx config to writable location and inject CSP
echo "🔐 Configuring Content Security Policy..."
cp /etc/nginx/nginx.conf /tmp/nginx/nginx.conf
sed -i "s|{{FLUXBASE_DOMAIN}}|$FLUXBASE_DOMAIN|g" /tmp/nginx/nginx.conf

# Copy HTML files to writable location for env var injection
echo "📋 Copying static files..."
cp -r /usr/share/nginx/html/* /tmp/nginx/html/

# Navigate to writable html directory
cd /tmp/nginx/html

# Inject environment variables into HTML files
echo "📝 Injecting environment variables into HTML..."
for file in *.html; do
  if [ -f "$file" ]; then
    echo "   Processing $file..."
    sed -i "s|{{FLUXBASE_BASE_URL}}|$FLUXBASE_BASE_URL|g" "$file"
    sed -i "s|{{FLUXBASE_ANON_KEY}}|$FLUXBASE_ANON_KEY|g" "$file"
    sed -i "s|{{FLUXBASE_SERVICE_ROLE_KEY}}|$FLUXBASE_SERVICE_ROLE_KEY|g" "$file"
  fi
done

echo "✅ Configuration complete"

# Start nginx in foreground with custom config from /tmp
# Use -e flag to set error log to stderr immediately (before reading config)
echo "🌐 Starting nginx..."
exec nginx -c /tmp/nginx/nginx.conf -e /dev/stderr -g "daemon off;"

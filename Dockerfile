# Multi-stage Dockerfile for Wayli - optimized for minimal size
# Stage 1: Build stage - includes all build dependencies
# Stage 2: Production stage - nginx serves static files, Fluxbase CLI for sync
#
# Container structure:
#   /app/
#   └── fluxbase/     (functions, migrations, jobs - synced at startup)
#   /usr/share/nginx/html/  (static web files)

FROM denoland/deno:bin-2.6.4 AS deno-bin

#############################################
# Stage 1: Builder
#############################################
FROM node:25.8.1-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++

WORKDIR /app/web

# Copy package files first (for better caching)
COPY web/package*.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm ci --legacy-peer-deps

# Copy web source code (node_modules excluded via .dockerignore)
COPY web/ ./

# Generate SvelteKit TypeScript configuration and build app
RUN npm run prepare && npm run build

#############################################
# Stage 2: Production Runtime
#############################################
FROM debian:bookworm-slim AS production

COPY --from=deno-bin /deno /usr/local/bin/deno

# Install nginx and tools for health checks and Fluxbase CLI
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx wget bash curl ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /run/nginx

# Install Fluxbase CLI for resource synchronization
# Set FLUXBASE_CLI_VERSION to 'local' to use a pre-built CLI from ./bin/fluxbase
# Otherwise, installs from GitHub release (e.g., 'latest' or 'v0.0.1-rc.112')
ARG FLUXBASE_CLI_VERSION=v2026.3.1
RUN curl -fsSL https://raw.githubusercontent.com/fluxbase-eu/fluxbase/main/install-cli.sh | bash -s -- ${FLUXBASE_CLI_VERSION}

WORKDIR /app

# Copy fluxbase directory (synced to Fluxbase at startup)
COPY fluxbase/ /app/fluxbase/

# Copy built static files from builder
COPY --from=builder /app/web/build /usr/share/nginx/html/
COPY --from=builder /app/web/static /usr/share/nginx/html/static/

# Copy nginx config and scripts
COPY web/nginx.conf /etc/nginx/nginx.conf
COPY web/startup.sh web/docker-entrypoint.sh /app/
RUN chmod +x /app/startup.sh /app/docker-entrypoint.sh && \
    cp /app/startup.sh /usr/local/bin/startup.sh

# Create wayli user and set up permissions
RUN groupadd --system wayli && \
    useradd --system --gid wayli --no-create-home wayli && \
    mkdir -p /var/cache/nginx /run /tmp/nginx && \
    chown -R wayli:wayli /var/cache/nginx /run /tmp/nginx /app /usr/share/nginx/html && \
    chmod -R 755 /var/cache/nginx /run /tmp/nginx /app /usr/share/nginx/html

# Switch to non-root user
USER wayli

# Expose port 80 (nginx default)
EXPOSE 80

# Health check using nginx
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-80}/health || exit 1

# Default environment
ENV NODE_ENV=production
ENV PORT=80

# Entrypoint script
ENTRYPOINT ["./docker-entrypoint.sh"]

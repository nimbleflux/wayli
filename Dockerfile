# Multi-stage Dockerfile for Wayli - optimized for minimal size
# Stage 1: Build stage - includes all build dependencies
# Stage 2: Production stage - nginx serves static files, Fluxbase CLI for sync
#
# Container structure:
#   /app/
#   └── fluxbase/     (schema, functions, jobs, rpc - synced at startup)
#   /usr/share/nginx/html/  (static web files)

FROM denoland/deno:bin-2.6.4 AS deno-bin

#############################################
# Stage 1: Builder
#############################################
FROM oven/bun:1-alpine AS builder

# Install build dependencies (linux-headers needed for re2 native module)
RUN apk add --no-cache python3 make g++ linux-headers

WORKDIR /app/web

# Copy package files first (for better caching).
# bun.lock (text lockfile) MUST be copied: without it, `bun install
# --frozen-lockfile` has nothing to freeze against and every image build
# resolves dependency ranges fresh from the registry (non-reproducible
# images). The old `bun.lockb*` glob matched nothing — bun.lockb doesn't
# exist in this repo — and was silently skipped.
COPY web/package.json web/bun.lock ./

# Install ALL dependencies (including devDependencies for build)
RUN bun install --frozen-lockfile

# Copy web source code (node_modules excluded via .dockerignore)
COPY web/ ./

# Generate SvelteKit TypeScript configuration and build app
RUN bun run prepare && bun run build

#############################################
# Stage 2: Production Runtime
#############################################
FROM debian:bookworm-slim AS production

COPY --from=deno-bin /deno /usr/local/bin/deno

# Install nginx and tools for health checks and Fluxbase CLI.
# nginx is pinned to the official nginx.org build rather than Debian's
# bookworm package (1.22.1), which falls in the vulnerable range of the
# HTTP/2 RCE CVE-2026-123007 (vulnerable: 1.9.5-1.31.8; fixed in
# 1.30.7/1.31.9). The bundled config never enables http2/QUIC, but the
# binary itself must not ship vulnerable. The signing key checksum is
# verified the same way as the Fluxbase CLI download below.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl wget bash && \
    curl -fsSLo /tmp/nginx_signing.key https://nginx.org/keys/nginx_signing.key && \
    echo "55385da31d198fa6a5012d40ae98ecb272a6c4e8fffffba94719ffd3e87de37a  /tmp/nginx_signing.key" | sha256sum -c - && \
    mkdir -p /etc/apt/keyrings && \
    cp /tmp/nginx_signing.key /etc/apt/keyrings/nginx-archive-keyring.asc && \
    echo "deb [signed-by=/etc/apt/keyrings/nginx-archive-keyring.asc] https://nginx.org/packages/debian bookworm nginx" \
        > /etc/apt/sources.list.d/nginx.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends "nginx=1.30.7-1~bookworm" && \
    rm -f /etc/nginx/conf.d/default.conf /tmp/nginx_signing.key && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /run/nginx && \
    nginx -v

# Install Fluxbase CLI for resource synchronization, pinned to
# FLUXBASE_CLI_VERSION and verified against the SHA-256 sidecar the release
# publishes. This replaces the old `curl install-cli.sh | bash` from the
# mutable main branch (no checksum, arbitrary code in every image build).
# Set FLUXBASE_CLI_VERSION to 'local' to use a pre-built CLI from ./bin/fluxbase
ARG FLUXBASE_CLI_VERSION=v2026.11.1
RUN if [ "${FLUXBASE_CLI_VERSION}" = "local" ]; then \
        cp bin/fluxbase /usr/local/bin/fluxbase; \
    else \
        ARCH="$(uname -m)" && \
        case "$ARCH" in \
            x86_64) GOARCH=amd64 ;; \
            aarch64 | arm64) GOARCH=arm64 ;; \
            *) echo "unsupported architecture: $ARCH" >&2; exit 1 ;; \
        esac && \
        BASE_URL="https://github.com/nimbleflux/fluxbase/releases/download/${FLUXBASE_CLI_VERSION}" && \
        TARBALL="fluxbase-linux-${GOARCH}.tar.gz" && \
        curl -fsSLo /tmp/fluxbase.tar.gz "${BASE_URL}/${TARBALL}" && \
        curl -fsSLo /tmp/fluxbase.tar.gz.sha256 "${BASE_URL}/${TARBALL}.sha256" && \
        EXPECTED_SHA="$(grep -oE '^[a-f0-9]{64}' /tmp/fluxbase.tar.gz.sha256 | head -1)" && \
        ACTUAL_SHA="$(sha256sum /tmp/fluxbase.tar.gz | cut -d' ' -f1)" && \
        if [ -z "$EXPECTED_SHA" ] || [ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]; then \
            echo "Fluxbase CLI checksum mismatch: expected=${EXPECTED_SHA} actual=${ACTUAL_SHA}" >&2; \
            exit 1; \
        fi && \
        tar -xzf /tmp/fluxbase.tar.gz -C /tmp "fluxbase-linux-${GOARCH}" && \
        install -m 0755 "/tmp/fluxbase-linux-${GOARCH}" /usr/local/bin/fluxbase && \
        rm -f /tmp/fluxbase.tar.gz /tmp/fluxbase.tar.gz.sha256 "/tmp/fluxbase-linux-${GOARCH}"; \
    fi && \
    fluxbase version

WORKDIR /app

# Copy fluxbase directory (synced to Fluxbase at startup)
COPY fluxbase/ /app/fluxbase/

# Copy built static files from builder
COPY --from=builder /app/web/build /usr/share/nginx/html/
COPY --from=builder /app/web/static /usr/share/nginx/html/static/

# Copy nginx config and scripts
COPY web/nginx.conf /etc/nginx/nginx.conf
COPY web/startup.sh web/docker-entrypoint.sh /app/
COPY scripts/ /app/scripts/
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

# Health check using nginx. /health answers 503 until resource sync finishes
# (see startup.sh mark_healthy), so the start period must cover a cold,
# full-first-boot sync on a fresh database.
HEALTHCHECK --interval=30s --timeout=3s --start-period=300s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-80}/health || exit 1

# Default environment
ENV NODE_ENV=production
ENV PORT=80

# Entrypoint script
ENTRYPOINT ["./docker-entrypoint.sh"]

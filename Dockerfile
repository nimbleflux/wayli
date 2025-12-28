# Multi-stage Dockerfile for Wayli - optimized for minimal size
# Stage 1: Build stage - includes all build dependencies
# Stage 2: Production stage - only runtime dependencies and built artifacts
#
# Container structure mirrors repo layout:
#   /app/
#   ├── web/          (SvelteKit app, package.json, node_modules)
#   └── fluxbase/     (functions, migrations, jobs)

#############################################
# Stage 1: Builder
#############################################
FROM node:20-alpine AS builder

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
FROM node:20-alpine AS production

# Install nginx, wget, bash, curl, and deno for static file serving, health checks, entrypoint script, CLI installation, and background jobs
RUN apk add --no-cache nginx wget bash curl deno && \
    mkdir -p /run/nginx

# Install Fluxbase CLI for resource synchronization
RUN curl -fsSL https://raw.githubusercontent.com/fluxbase-eu/fluxbase/main/install-cli.sh | bash -s -- v0.0.1-rc.106

WORKDIR /app/web

# Copy package files and install production dependencies
COPY web/package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps && \
    npm cache clean --force

# Copy entire web directory (node_modules, .svelte-kit excluded via .dockerignore)
COPY web/ ./

# Use production tsconfig (doesn't depend on .svelte-kit/tsconfig.json)
RUN mv tsconfig.prod.json tsconfig.json

# Copy built application from builder stage (overwrites empty build dir from COPY web/)
COPY --from=builder /app/web/build ./build

# Copy fluxbase directory
COPY fluxbase/ /app/fluxbase/

# Setup nginx with static files
COPY web/nginx.conf /etc/nginx/nginx.conf
RUN mkdir -p /usr/share/nginx/html && \
    rm -rf /usr/share/nginx/html/* && \
    cp -r build/* /usr/share/nginx/html/ && \
    cp -r static /usr/share/nginx/html/

# Make scripts executable
RUN chmod +x startup.sh docker-entrypoint.sh && \
    cp startup.sh /usr/local/bin/startup.sh

# Create non-root user for security
RUN addgroup -S wayli && \
    adduser -S -G wayli wayli

# Create nginx directories with proper ownership
RUN mkdir -p /var/cache/nginx /run /tmp/nginx && \
    chown -R wayli:wayli /var/cache/nginx /run /tmp/nginx /app /usr/share/nginx/html && \
    chmod -R 755 /var/cache/nginx /run /tmp/nginx /app /usr/share/nginx/html

# Switch to non-root user
USER wayli

# Expose port 80 (nginx default)
EXPOSE 80

# Health check using nginx
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/health || exit 1

# Default environment
ENV NODE_ENV=production
ENV APP_MODE=web
ENV PORT=80

# Entrypoint script that handles different modes
ENTRYPOINT ["./docker-entrypoint.sh"]

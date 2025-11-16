# Multi-stage Dockerfile for Wayli - optimized for minimal size
# Stage 1: Build stage - includes all build dependencies
# Stage 2: Production stage - only runtime dependencies and built artifacts

#############################################
# Stage 1: Builder
#############################################
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files first (for better caching)
COPY web/package*.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm ci --legacy-peer-deps

# Copy source code
COPY web/ ./

# Generate SvelteKit TypeScript configuration and build app
RUN npm run prepare && npm run build

# Verify build output
RUN echo "=== Build Complete ===" && \
    echo "Available directories:" && \
    ls -la && \
    echo "Build directory:" && \
    ls -la build/ && \
    echo "Static files:" && \
    ls -la static/

#############################################
# Stage 2: Production Runtime
#############################################
FROM node:20-alpine AS production

# Install nginx, wget, and bash for static file serving, health checks, and entrypoint script
RUN apk add --no-cache nginx wget bash && \
    mkdir -p /run/nginx

WORKDIR /app

# Copy package files
COPY web/package*.json ./

# Install ONLY production dependencies (no devDependencies)
RUN npm ci --omit=dev --legacy-peer-deps && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/build ./build
COPY --from=builder /app/static ./static

# Copy source code (needed for worker mode with tsx)
COPY web/src ./src

# Copy Fluxbase functions and migrations (needed for Kubernetes deployments)
COPY web/fluxbase/functions ./fluxbase/functions
COPY web/fluxbase/migrations ./fluxbase/migrations

# Copy nginx config and serve static files
COPY web/nginx.conf /etc/nginx/nginx.conf
RUN mkdir -p /usr/share/nginx/html && \
    rm -rf /usr/share/nginx/html/* && \
    cp -r build/* /usr/share/nginx/html/ && \
    cp -r static /usr/share/nginx/html/

# Copy startup scripts
COPY web/startup.sh /usr/local/bin/startup.sh
COPY web/docker-entrypoint.sh ./docker-entrypoint.sh

# Make scripts executable
RUN chmod +x /usr/local/bin/startup.sh ./docker-entrypoint.sh

# Create non-root user for security
RUN addgroup -S appuser && \
    adduser -S -G appuser appuser

# Create nginx directories with proper ownership
# Note: Logs go to stdout/stderr, so no log directories needed
RUN mkdir -p /var/cache/nginx /run /tmp/nginx && \
    chown -R appuser:appuser /var/cache/nginx /run /tmp/nginx /app /usr/share/nginx/html && \
    chmod -R 755 /var/cache/nginx /run /tmp/nginx /app /usr/share/nginx/html

# Switch to non-root user
USER appuser

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

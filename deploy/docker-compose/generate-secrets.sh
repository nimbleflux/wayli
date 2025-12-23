#!/bin/bash

# Wayli Docker Compose - Secret Generator
# This script generates secrets required for Wayli with Fluxbase deployment
#
# Usage:
#   ./generate-secrets.sh > .env
#   # or append to existing .env:
#   ./generate-secrets.sh >> .env

set -e

# Colors for output (only used for stderr messages)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Print to stderr (so stdout stays clean for .env output)
log_info() {
    echo -e "${GREEN}✓${NC} $1" >&2
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1" >&2
}

log_error() {
    echo -e "${RED}✗${NC} $1" >&2
}

# Check for required tools
check_requirements() {
    if ! command -v openssl &> /dev/null; then
        log_error "openssl is required but not installed"
        exit 1
    fi

    if ! command -v docker &> /dev/null; then
        log_warning "docker is not installed - JWT tokens will need to be generated manually"
        return 1
    fi
    return 0
}

# Generate a secure random password (URL-safe, alphanumeric only)
generate_password() {
    local length=${1:-32}
    openssl rand -base64 $((length * 2)) | tr -d '\n' | tr -dc 'a-zA-Z0-9' | head -c $length
}

# Generate JWT secret (base64, 48 bytes)
generate_jwt_secret() {
    openssl rand -base64 48 | tr -d "\n"
}

# Generate JWT tokens using Node.js via Docker
generate_jwt_tokens() {
    local jwt_secret=$1

    log_info "Generating JWT tokens using Docker..."

    local jwt_output
    if jwt_output=$(docker run --rm node:20-alpine node -e "
        const crypto = require('crypto');

        function base64url(input) {
            return Buffer.from(input)
                .toString('base64')
                .replace(/=/g, '')
                .replace(/\+/g, '-')
                .replace(/\//g, '_');
        }

        function generateToken(role, secret) {
            const now = Math.floor(Date.now() / 1000);
            const exp = now + (10 * 365 * 24 * 60 * 60); // 10 years

            const header = {
                alg: 'HS256',
                typ: 'JWT'
            };

            const payload = {
                role: role,
                iss: 'fluxbase',
                iat: now,
                exp: exp
            };

            const headerB64 = base64url(JSON.stringify(header));
            const payloadB64 = base64url(JSON.stringify(payload));
            const signature = crypto
                .createHmac('sha256', secret)
                .update(headerB64 + '.' + payloadB64)
                .digest('base64')
                .replace(/=/g, '')
                .replace(/\+/g, '-')
                .replace(/\//g, '_');

            return headerB64 + '.' + payloadB64 + '.' + signature;
        }

        const anonToken = generateToken('anon', '$jwt_secret');
        const serviceToken = generateToken('service_role', '$jwt_secret');
        console.log('ANON_KEY=' + anonToken);
        console.log('SERVICE_ROLE_KEY=' + serviceToken);
    " 2>&1); then
        if echo "$jwt_output" | grep -q "^ANON_KEY=eyJ"; then
            log_info "JWT tokens generated successfully"
            echo "$jwt_output"
            return 0
        fi
    fi

    log_warning "Could not generate JWT tokens automatically"
    echo "# JWT tokens could not be generated automatically."
    echo "# Please generate them manually using your JWT_SECRET above."
    echo "ANON_KEY="
    echo "SERVICE_ROLE_KEY="
    return 1
}

# Main
main() {
    log_info "Generating secrets for Wayli Docker Compose deployment..."

    local has_docker=true
    check_requirements || has_docker=false

    # Generate secrets
    JWT_SECRET=$(generate_jwt_secret)
    POSTGRES_PASSWORD=$(generate_password 40)

    log_info "JWT_SECRET generated (base64, 48 bytes)"
    log_info "POSTGRES_PASSWORD generated (40 chars)"

    # Output .env format
    echo "# Wayli Docker Compose Secrets"
    echo "# Generated on $(date)"
    echo "# IMPORTANT: Keep this file secure and never commit to version control!"
    echo ""
    echo "# Database"
    echo "POSTGRES_PASSWORD=${POSTGRES_PASSWORD}"
    echo ""
    echo "# JWT Configuration"
    echo "JWT_SECRET=${JWT_SECRET}"
    echo ""

    # Generate JWT tokens if Docker is available
    if [ "$has_docker" = true ]; then
        generate_jwt_tokens "$JWT_SECRET"
    else
        echo "# JWT tokens (generate manually using JWT_SECRET above)"
        echo "ANON_KEY="
        echo "SERVICE_ROLE_KEY="
    fi

    echo ""
    log_info "Done! Redirect output to .env file:"
    log_info "  ./generate-secrets.sh > .env"
}

main "$@"

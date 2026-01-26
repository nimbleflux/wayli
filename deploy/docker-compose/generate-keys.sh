#!/bin/bash
# Wayli Secrets Generator
# Generates all required secrets for Wayli with Fluxbase deployment
# Outputs to .env file, Kubernetes Secret manifest, or stdout
#
# Usage:
#   ./generate-keys.sh           # Interactive mode
#   ./generate-keys.sh --stdout  # Output .env content to stdout (for piping)

set -e

# Parse arguments
STDOUT_MODE=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --stdout)
            STDOUT_MODE=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [--stdout]"
            echo ""
            echo "Options:"
            echo "  --stdout    Output .env content to stdout (non-interactive)"
            echo "  -h, --help  Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Print functions
print_header() {
    echo -e "\n${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${CYAN}ℹ${NC} $1"
}

# Parse existing .env file and return value for a key
get_env_value() {
    local key=$1
    local file=$2
    grep "^${key}=" "$file" 2>/dev/null | cut -d'=' -f2- | sed "s/^[\"']//;s/[\"']$//"
}

# Check if key exists and has non-empty value
key_has_value() {
    local key=$1
    local file=$2
    local value=$(get_env_value "$key" "$file")
    [ -n "$value" ]
}

# Required keys that should be checked/generated
REQUIRED_KEYS=(
    "FLUXBASE_AUTH_JWT_SECRET"
    "POSTGRES_PASSWORD"
    "FLUXBASE_ENCRYPTION_KEY"
    "FLUXBASE_SECURITY_SETUP_TOKEN"
    "FLUXBASE_ANON_KEY"
    "FLUXBASE_SERVICE_ROLE_KEY"
)

# Display status of all required keys in a file
display_key_status() {
    local file=$1
    local missing=()

    echo ""
    echo "Current status:"
    for key in "${REQUIRED_KEYS[@]}"; do
        if key_has_value "$key" "$file"; then
            echo -e "  ${GREEN}✓${NC} ${key} (set)"
        else
            echo -e "  ${RED}✗${NC} ${key} (missing)"
            missing+=("$key")
        fi
    done
    echo ""

    # Return number of missing keys
    echo "${#missing[@]}"
}

# Get list of missing keys
get_missing_keys() {
    local file=$1
    local missing=()

    for key in "${REQUIRED_KEYS[@]}"; do
        if ! key_has_value "$key" "$file"; then
            missing+=("$key")
        fi
    done

    echo "${missing[@]}"
}

# Prompt for a value with default
prompt_with_default() {
    local prompt=$1
    local default=$2

    if [ -n "$default" ]; then
        read -p "$(echo -e ${CYAN}${prompt}${NC}) [${default}]: " value
    else
        read -p "$(echo -e ${CYAN}${prompt}${NC}): " value
    fi

    # Use default if no input provided
    if [ -z "$value" ]; then
        value=$default
    fi

    echo "$value"
}

# Check dependencies
check_requirements() {
    local missing=0

    if ! command -v openssl &> /dev/null; then
        print_error "openssl is required but not installed"
        missing=1
    fi

    if [ $missing -eq 1 ]; then
        exit 1
    fi

    if ! command -v docker &> /dev/null; then
        print_warning "docker is not installed - JWT tokens will need to be generated manually"
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

# Generate encryption key (exactly 32 characters for AES-256)
generate_encryption_key() {
    openssl rand -base64 32 | head -c 32
}

# Generate JWT tokens using Node.js via Docker
generate_jwt_tokens() {
    local jwt_secret=$1

    print_info "Generating JWT tokens using Docker..."

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
            print_success "JWT tokens generated successfully"
            echo "$jwt_output"
            return 0
        fi
    fi

    print_warning "Could not generate JWT tokens automatically"
    return 1
}

# Generate and output .env content to stdout (non-interactive mode)
generate_stdout() {
    # Check requirements silently
    if ! command -v openssl &> /dev/null; then
        echo "Error: openssl is required but not installed" >&2
        exit 1
    fi

    local has_docker=true
    if ! command -v docker &> /dev/null; then
        has_docker=false
    fi

    # Use defaults for Dev Container
    local site_url="http://localhost:4000"
    local fluxbase_public_url="http://localhost:8080"
    local fluxbase_internal_url="http://fluxbase:8080"

    # Generate secrets
    local jwt_secret=$(generate_jwt_secret)
    local postgres_password=$(generate_password 40)
    local encryption_key=$(generate_encryption_key)
    local setup_token=$(generate_password 32)

    # Generate JWT tokens
    local anon_key=""
    local service_role_key=""

    if [ "$has_docker" = true ]; then
        local jwt_output
        jwt_output=$(generate_jwt_tokens "$jwt_secret" 2>/dev/null) || true
        if [ -n "$jwt_output" ]; then
            anon_key=$(echo "$jwt_output" | grep "^ANON_KEY=" | cut -d'=' -f2-)
            service_role_key=$(echo "$jwt_output" | grep "^SERVICE_ROLE_KEY=" | cut -d'=' -f2-)
        fi
    fi

    # Output .env content
    cat << EOF
# Wayli with Fluxbase - Secrets
# Generated by generate-keys.sh --stdout on $(date)
# IMPORTANT: Keep this file secure and never commit to version control!

# URLs
SITE_URL=${site_url}
FLUXBASE_PUBLIC_BASE_URL=${fluxbase_public_url}
FLUXBASE_BASE_URL=${fluxbase_internal_url}

# Database
POSTGRES_PASSWORD=${postgres_password}

# JWT Configuration
FLUXBASE_AUTH_JWT_SECRET=${jwt_secret}
EOF

    if [ -n "$anon_key" ] && [ -n "$service_role_key" ]; then
        cat << EOF
FLUXBASE_ANON_KEY=${anon_key}
FLUXBASE_SERVICE_ROLE_KEY=${service_role_key}
EOF
    else
        cat << EOF
# JWT tokens could not be generated (Docker not available).
# Generate manually using FLUXBASE_AUTH_JWT_SECRET above.
FLUXBASE_ANON_KEY=
FLUXBASE_SERVICE_ROLE_KEY=
EOF
    fi

    cat << EOF

# Fluxbase Configuration
FLUXBASE_ENCRYPTION_KEY=${encryption_key}
FLUXBASE_SECURITY_SETUP_TOKEN=${setup_token}
EOF
}

# Main
main() {
    # Handle stdout mode
    if [ "$STDOUT_MODE" = true ]; then
        generate_stdout
        exit 0
    fi

    # Banner
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║              Wayli Secrets Generator                         ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"

    # Check requirements
    local has_docker=true
    check_requirements || has_docker=false

    # Prompt for output format
    print_header "Output Format"

    echo "1) Docker Compose (.env file)"
    echo "   For use with docker-compose.yml"
    echo ""
    echo "2) Kubernetes Secret (wayli-secrets.yaml)"
    echo "   For use with Helm charts or kubectl apply"
    echo ""
    read -p "Enter choice [1-2]: " OUTPUT_FORMAT

    case $OUTPUT_FORMAT in
        1)
            OUTPUT_TYPE="env"
            OUTPUT_FILE="$SCRIPT_DIR/.env"
            ;;
        2)
            OUTPUT_TYPE="k8s"
            OUTPUT_FILE="$SCRIPT_DIR/wayli-secrets.yaml"
            ;;
        *)
            print_error "Invalid choice"
            exit 1
            ;;
    esac

    # Check if output file exists
    UPDATE_MODE=false
    if [ -f "$OUTPUT_FILE" ]; then
        echo ""
        print_warning "Existing file found: $OUTPUT_FILE"

        # Display status and capture number of missing keys
        missing_count=$(display_key_status "$OUTPUT_FILE")
        missing_keys=$(get_missing_keys "$OUTPUT_FILE")

        if [ "$missing_count" -eq 0 ]; then
            echo "All required keys are already set."
            echo ""
            echo "1) Regenerate all keys (overwrites existing)"
            echo "2) Cancel"
            echo ""
            read -p "Enter choice [1-2]: " ENV_CHOICE

            case $ENV_CHOICE in
                1)
                    # Will regenerate all
                    ;;
                *)
                    print_info "No changes made."
                    exit 0
                    ;;
            esac
        else
            echo "Missing keys: ${missing_keys}"
            echo ""
            echo "1) Generate missing keys only (preserves existing values)"
            echo "2) Regenerate all keys (overwrites existing)"
            echo "3) Cancel"
            echo ""
            read -p "Enter choice [1-3]: " ENV_CHOICE

            case $ENV_CHOICE in
                1)
                    UPDATE_MODE=true
                    # Load existing values
                    EXISTING_JWT_SECRET=$(get_env_value "FLUXBASE_AUTH_JWT_SECRET" "$OUTPUT_FILE")
                    EXISTING_POSTGRES_PASSWORD=$(get_env_value "POSTGRES_PASSWORD" "$OUTPUT_FILE")
                    EXISTING_ENCRYPTION_KEY=$(get_env_value "FLUXBASE_ENCRYPTION_KEY" "$OUTPUT_FILE")
                    EXISTING_SETUP_TOKEN=$(get_env_value "FLUXBASE_SECURITY_SETUP_TOKEN" "$OUTPUT_FILE")
                    EXISTING_ANON_KEY=$(get_env_value "FLUXBASE_ANON_KEY" "$OUTPUT_FILE")
                    EXISTING_SERVICE_ROLE_KEY=$(get_env_value "FLUXBASE_SERVICE_ROLE_KEY" "$OUTPUT_FILE")
                    # Load existing URLs
                    EXISTING_SITE_URL=$(get_env_value "SITE_URL" "$OUTPUT_FILE")
                    EXISTING_FLUXBASE_PUBLIC_URL=$(get_env_value "FLUXBASE_PUBLIC_BASE_URL" "$OUTPUT_FILE")
                    EXISTING_FLUXBASE_INTERNAL_URL=$(get_env_value "FLUXBASE_BASE_URL" "$OUTPUT_FILE")
                    ;;
                2)
                    # Will regenerate all
                    ;;
                *)
                    print_info "No changes made."
                    exit 0
                    ;;
            esac
        fi
    fi

    # Ask for URLs (use existing values as defaults in update mode)
    print_header "Configuration"

    echo "Configure the URLs for your deployment."
    echo ""

    if [ "$UPDATE_MODE" = true ] && [ -n "$EXISTING_SITE_URL" ]; then
        SITE_URL=$(prompt_with_default "SITE_URL (public URL for Wayli app)" "$EXISTING_SITE_URL")
    else
        SITE_URL=$(prompt_with_default "SITE_URL (public URL for Wayli app)" "http://localhost:4000")
    fi

    if [ "$UPDATE_MODE" = true ] && [ -n "$EXISTING_FLUXBASE_PUBLIC_URL" ]; then
        FLUXBASE_PUBLIC_BASE_URL=$(prompt_with_default "FLUXBASE_PUBLIC_BASE_URL (public URL for Fluxbase API)" "$EXISTING_FLUXBASE_PUBLIC_URL")
    else
        FLUXBASE_PUBLIC_BASE_URL=$(prompt_with_default "FLUXBASE_PUBLIC_BASE_URL (public URL for Fluxbase API)" "http://localhost:8080")
    fi

    if [ "$UPDATE_MODE" = true ] && [ -n "$EXISTING_FLUXBASE_INTERNAL_URL" ]; then
        FLUXBASE_BASE_URL=$(prompt_with_default "FLUXBASE_BASE_URL (internal URL for container-to-container)" "$EXISTING_FLUXBASE_INTERNAL_URL")
    else
        FLUXBASE_BASE_URL=$(prompt_with_default "FLUXBASE_BASE_URL (internal URL for container-to-container)" "http://fluxbase:8080")
    fi

    # Ask for namespace if Kubernetes
    if [ "$OUTPUT_TYPE" = "k8s" ]; then
        NAMESPACE=$(prompt_with_default "Kubernetes namespace" "default")
    fi

    # Generate secrets (or use existing in update mode)
    print_header "Generating Secrets"

    if [ "$UPDATE_MODE" = true ]; then
        # Use existing values or generate new ones for missing keys
        if [ -n "$EXISTING_JWT_SECRET" ]; then
            FLUXBASE_AUTH_JWT_SECRET="$EXISTING_JWT_SECRET"
            print_info "FLUXBASE_AUTH_JWT_SECRET (using existing)"
        else
            FLUXBASE_AUTH_JWT_SECRET=$(generate_jwt_secret)
            print_success "FLUXBASE_AUTH_JWT_SECRET generated (base64, 48 bytes)"
        fi

        if [ -n "$EXISTING_POSTGRES_PASSWORD" ]; then
            POSTGRES_PASSWORD="$EXISTING_POSTGRES_PASSWORD"
            print_info "POSTGRES_PASSWORD (using existing)"
        else
            POSTGRES_PASSWORD=$(generate_password 40)
            print_success "POSTGRES_PASSWORD generated (40 chars)"
        fi

        if [ -n "$EXISTING_ENCRYPTION_KEY" ]; then
            FLUXBASE_ENCRYPTION_KEY="$EXISTING_ENCRYPTION_KEY"
            print_info "FLUXBASE_ENCRYPTION_KEY (using existing)"
        else
            FLUXBASE_ENCRYPTION_KEY=$(generate_encryption_key)
            print_success "FLUXBASE_ENCRYPTION_KEY generated (32 chars)"
        fi

        if [ -n "$EXISTING_SETUP_TOKEN" ]; then
            FLUXBASE_SECURITY_SETUP_TOKEN="$EXISTING_SETUP_TOKEN"
            print_info "FLUXBASE_SECURITY_SETUP_TOKEN (using existing)"
        else
            FLUXBASE_SECURITY_SETUP_TOKEN=$(generate_password 32)
            print_success "FLUXBASE_SECURITY_SETUP_TOKEN generated (32 chars)"
        fi
    else
        # Generate all new secrets
        FLUXBASE_AUTH_JWT_SECRET=$(generate_jwt_secret)
        POSTGRES_PASSWORD=$(generate_password 40)
        FLUXBASE_ENCRYPTION_KEY=$(generate_encryption_key)
        FLUXBASE_SECURITY_SETUP_TOKEN=$(generate_password 32)

        print_success "FLUXBASE_AUTH_JWT_SECRET generated (base64, 48 bytes)"
        print_success "POSTGRES_PASSWORD generated (40 chars)"
        print_success "FLUXBASE_ENCRYPTION_KEY generated (32 chars)"
        print_success "FLUXBASE_SECURITY_SETUP_TOKEN generated (32 chars)"
    fi

    # Generate JWT tokens
    FLUXBASE_ANON_KEY=""
    FLUXBASE_SERVICE_ROLE_KEY=""
    JWT_TOKENS_GENERATED=false

    if [ "$UPDATE_MODE" = true ] && [ -n "$EXISTING_ANON_KEY" ] && [ -n "$EXISTING_SERVICE_ROLE_KEY" ]; then
        # Use existing JWT tokens
        FLUXBASE_ANON_KEY="$EXISTING_ANON_KEY"
        FLUXBASE_SERVICE_ROLE_KEY="$EXISTING_SERVICE_ROLE_KEY"
        JWT_TOKENS_GENERATED=true
        echo ""
        print_info "FLUXBASE_ANON_KEY (using existing)"
        print_info "FLUXBASE_SERVICE_ROLE_KEY (using existing)"
    elif [ "$has_docker" = true ]; then
        # Generate new JWT tokens (using existing or new JWT secret)
        echo ""
        jwt_output=$(generate_jwt_tokens "$FLUXBASE_AUTH_JWT_SECRET") || true
        if [ -n "$jwt_output" ]; then
            FLUXBASE_ANON_KEY=$(echo "$jwt_output" | grep "^ANON_KEY=" | cut -d'=' -f2-)
            FLUXBASE_SERVICE_ROLE_KEY=$(echo "$jwt_output" | grep "^SERVICE_ROLE_KEY=" | cut -d'=' -f2-)
            if [ -n "$FLUXBASE_ANON_KEY" ] && [ -n "$FLUXBASE_SERVICE_ROLE_KEY" ]; then
                JWT_TOKENS_GENERATED=true
            fi
        fi
    fi

    if [ "$JWT_TOKENS_GENERATED" = false ]; then
        print_warning "JWT tokens could not be generated automatically"
        print_info "You will need to generate them manually using FLUXBASE_AUTH_JWT_SECRET"
    fi

    # Write output
    print_header "Writing Output"

    if [ "$OUTPUT_TYPE" = "env" ]; then
        # Generate .env file
        cat > "$OUTPUT_FILE" << EOF
# Wayli with Fluxbase - Secrets
# Generated by generate-keys.sh on $(date)
# For use with docker-compose.yml
#
# IMPORTANT: Keep this file secure and never commit to version control!

# ═══════════════════════════════════════════════════════════════
# URLs
# ═══════════════════════════════════════════════════════════════

# Public URL where Wayli app is accessible
SITE_URL=${SITE_URL}

# Public URL where Fluxbase API is accessible (used by browser)
FLUXBASE_PUBLIC_BASE_URL=${FLUXBASE_PUBLIC_BASE_URL}

# Internal URL for server-to-server communication
FLUXBASE_BASE_URL=${FLUXBASE_BASE_URL}

# ═══════════════════════════════════════════════════════════════
# Database
# ═══════════════════════════════════════════════════════════════

POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

# ═══════════════════════════════════════════════════════════════
# JWT Configuration
# ═══════════════════════════════════════════════════════════════

# JWT signing secret (keep this secure!)
FLUXBASE_AUTH_JWT_SECRET=${FLUXBASE_AUTH_JWT_SECRET}

# JWT tokens for API access
EOF

        if [ "$JWT_TOKENS_GENERATED" = true ]; then
            cat >> "$OUTPUT_FILE" << EOF
FLUXBASE_ANON_KEY=${FLUXBASE_ANON_KEY}
FLUXBASE_SERVICE_ROLE_KEY=${FLUXBASE_SERVICE_ROLE_KEY}
EOF
        else
            cat >> "$OUTPUT_FILE" << EOF
# JWT tokens could not be generated automatically.
# Generate them manually using FLUXBASE_AUTH_JWT_SECRET above.
FLUXBASE_ANON_KEY=
FLUXBASE_SERVICE_ROLE_KEY=
EOF
        fi

        cat >> "$OUTPUT_FILE" << EOF

# ═══════════════════════════════════════════════════════════════
# Fluxbase Configuration
# ═══════════════════════════════════════════════════════════════

# Encryption key for secrets at rest (AES-256, 32 chars)
FLUXBASE_ENCRYPTION_KEY=${FLUXBASE_ENCRYPTION_KEY}

# Admin setup token (required to access /admin/setup)
FLUXBASE_SECURITY_SETUP_TOKEN=${FLUXBASE_SECURITY_SETUP_TOKEN}
EOF

        print_success "Created $OUTPUT_FILE"

        # Next steps
        print_header "Next Steps"

        echo -e "${YELLOW}Save your Setup Token (needed for admin dashboard):${NC}"
        echo -e "${GREEN}${FLUXBASE_SECURITY_SETUP_TOKEN}${NC}"
        echo ""

        if [ "$JWT_TOKENS_GENERATED" = false ]; then
            print_warning "Generate JWT tokens manually before starting"
            echo ""
        fi

        echo -e "${BLUE}Start Wayli:${NC}"
        echo "  cd $SCRIPT_DIR"
        echo "  docker compose up -d"
        echo ""
        echo -e "${BLUE}Then open:${NC}"
        echo "  ${FLUXBASE_PUBLIC_BASE_URL}/admin/setup"
        echo ""

    else
        # Generate Kubernetes Secret manifest
        # Base64 encode the values
        FLUXBASE_AUTH_JWT_SECRET_B64=$(echo -n "$FLUXBASE_AUTH_JWT_SECRET" | base64)
        POSTGRES_PASSWORD_B64=$(echo -n "$POSTGRES_PASSWORD" | base64)
        FLUXBASE_ENCRYPTION_KEY_B64=$(echo -n "$FLUXBASE_ENCRYPTION_KEY" | base64)
        FLUXBASE_SECURITY_SETUP_TOKEN_B64=$(echo -n "$FLUXBASE_SECURITY_SETUP_TOKEN" | base64)
        SITE_URL_B64=$(echo -n "$SITE_URL" | base64)
        FLUXBASE_PUBLIC_BASE_URL_B64=$(echo -n "$FLUXBASE_PUBLIC_BASE_URL" | base64)
        FLUXBASE_BASE_URL_B64=$(echo -n "$FLUXBASE_BASE_URL" | base64)

        if [ "$JWT_TOKENS_GENERATED" = true ]; then
            FLUXBASE_ANON_KEY_B64=$(echo -n "$FLUXBASE_ANON_KEY" | base64)
            FLUXBASE_SERVICE_ROLE_KEY_B64=$(echo -n "$FLUXBASE_SERVICE_ROLE_KEY" | base64)
        else
            FLUXBASE_ANON_KEY_B64=""
            FLUXBASE_SERVICE_ROLE_KEY_B64=""
        fi

        cat > "$OUTPUT_FILE" << EOF
# Wayli Kubernetes Secrets
# Generated by generate-keys.sh on $(date)
# Apply with: kubectl apply -f wayli-secrets.yaml -n ${NAMESPACE}
#
# IMPORTANT: This file contains sensitive data!
# - Do NOT commit to version control
# - Consider using sealed-secrets, external-secrets, or a secrets manager

apiVersion: v1
kind: Secret
metadata:
  name: wayli-secrets
  namespace: ${NAMESPACE}
  labels:
    app.kubernetes.io/name: wayli
    app.kubernetes.io/component: secrets
type: Opaque
data:
  # Database
  postgres-password: ${POSTGRES_PASSWORD_B64}

  # JWT Configuration
  jwt-secret: ${FLUXBASE_AUTH_JWT_SECRET_B64}
EOF

        if [ "$JWT_TOKENS_GENERATED" = true ]; then
            cat >> "$OUTPUT_FILE" << EOF
  anon-key: ${FLUXBASE_ANON_KEY_B64}
  service-role-key: ${FLUXBASE_SERVICE_ROLE_KEY_B64}
EOF
        else
            cat >> "$OUTPUT_FILE" << EOF
  # JWT tokens could not be generated - add manually
  # anon-key: <base64-encoded-anon-key>
  # service-role-key: <base64-encoded-service-role-key>
EOF
        fi

        cat >> "$OUTPUT_FILE" << EOF

  # Fluxbase Configuration
  encryption-key: ${FLUXBASE_ENCRYPTION_KEY_B64}
  setup-token: ${FLUXBASE_SECURITY_SETUP_TOKEN_B64}

  # URLs
  site-url: ${SITE_URL_B64}
  fluxbase-public-url: ${FLUXBASE_PUBLIC_BASE_URL_B64}
  fluxbase-internal-url: ${FLUXBASE_BASE_URL_B64}
EOF

        print_success "Created $OUTPUT_FILE"

        # Next steps
        print_header "Next Steps"

        echo -e "${YELLOW}Save your Setup Token (needed for admin dashboard):${NC}"
        echo -e "${GREEN}${FLUXBASE_SECURITY_SETUP_TOKEN}${NC}"
        echo ""

        if [ "$JWT_TOKENS_GENERATED" = false ]; then
            print_warning "Generate JWT tokens manually and add to the secret"
            echo ""
        fi

        echo -e "${BLUE}Apply the secret:${NC}"
        echo "  kubectl apply -f $OUTPUT_FILE"
        echo ""
        echo -e "${BLUE}Reference in Helm values.yaml:${NC}"
        cat << 'YAML'
wayli:
  existingSecret: wayli-secrets
  existingSecretKeys:
    siteUrl: site-url
    jwtSecret: jwt-secret
    anonKey: anon-key
    serviceRoleKey: service-role-key
    encryptionKey: encryption-key
    setupToken: setup-token

postgresql:
  auth:
    existingSecret: wayli-secrets
    secretKeys:
      adminPasswordKey: postgres-password
YAML
        echo ""
        print_warning "Security Reminder:"
        echo -e "${YELLOW}   Do NOT commit wayli-secrets.yaml to version control!${NC}"
        echo -e "${YELLOW}   Add it to .gitignore or use a secrets manager.${NC}"
        echo ""
    fi

    print_header "Secrets Generation Complete!"
}

main "$@"

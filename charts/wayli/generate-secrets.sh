#!/bin/bash

# Wayli Helm Chart - Kubernetes Secret Generator
# This script generates Kubernetes secrets for Wayli deployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Print functions
print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
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

# Check for required tools
check_requirements() {
    local missing=0

    if ! command -v openssl &> /dev/null; then
        print_error "openssl is required but not installed"
        missing=1
    fi

    if ! command -v docker &> /dev/null; then
        print_error "docker is required but not installed"
        missing=1
    fi

    if ! command -v kubectl &> /dev/null; then
        print_warning "kubectl is not installed - secrets will be saved to files instead"
    fi

    if [ $missing -eq 1 ]; then
        echo ""
        print_error "Please install missing dependencies and try again"
        exit 1
    fi
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

# Generate a secure random password (URL-safe, alphanumeric only)
generate_password() {
    local length=${1:-32}
    openssl rand -base64 $((length * 2)) | tr -d '\n' | tr -dc 'a-zA-Z0-9' | head -c $length
}

# Generate base64 encoded random bytes
generate_base64() {
    local bytes=${1:-32}
    openssl rand -base64 ${bytes} | tr -d "\n"
}

# Generate encryption key (32 characters)
generate_encryption_key() {
    openssl rand -hex 16
}

# Generate JWT secret (base64, 48 bytes)
generate_jwt_secret() {
    openssl rand -base64 48 | tr -d "\n"
}

# Generate JWT tokens using Node.js crypto via Docker
generate_jwt_tokens() {
    local jwt_secret=$1

    echo ""
    print_info "Attempting to generate JWT tokens using Docker..."
    echo ""

    # Try to use Node.js via Docker to generate JWT tokens using built-in crypto
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
        # Check if output contains tokens (not error messages)
        if echo "$jwt_output" | grep -q "^ANON_KEY=eyJ"; then
            print_success "JWT tokens generated successfully"

            # Extract tokens
            ANON_KEY=$(echo "$jwt_output" | grep "^ANON_KEY=" | cut -d'=' -f2-)
            SERVICE_ROLE_KEY=$(echo "$jwt_output" | grep "^SERVICE_ROLE_KEY=" | cut -d'=' -f2-)

            return 0
        else
            print_warning "Could not generate JWT tokens automatically"
            echo "Docker output: $jwt_output"
            echo ""
            echo "Please generate JWT tokens manually using your JWT secret"
            echo ""
            return 1
        fi
    else
        print_warning "Could not generate JWT tokens automatically (Docker not available?)"
        echo ""
        echo "Please generate JWT tokens manually using your JWT secret"
        echo ""
        return 1
    fi
}

# Main script
main() {
    print_header "Wayli Kubernetes Secret Generator"

    # Check requirements
    check_requirements

    # Configuration Section
    print_header "Configuration"

    echo "This script will generate Kubernetes secrets for Wayli."
    echo "You can either apply them directly to your cluster or save them to files."
    echo ""

    # Ask for namespace
    NAMESPACE=$(prompt_with_default "Kubernetes namespace" "default")

    # Ask for secret name
    SECRET_NAME=$(prompt_with_default "Fluxbase secret name" "fluxbase-secret")

    # Ask for deployment method
    echo ""
    echo -e "${BLUE}Deployment method:${NC}"
    echo "1) Apply directly to cluster (requires kubectl)"
    echo "2) Save to YAML files"
    read -p "$(echo -e ${CYAN}'Choose option'${NC}) [1]: " deploy_option
    deploy_option=${deploy_option:-1}

    # Generate secrets
    print_header "Generating Secrets"

    echo "Generating secure random values..."
    echo ""

    DB_PASSWORD=$(generate_password 40)
    SECRET_KEY_BASE=$(generate_base64 48)
    VAULT_ENC_KEY=$(generate_encryption_key)
    DB_ENC_KEY=$(generate_encryption_key)
    JWT_SECRET=$(generate_jwt_secret)

    print_success "DB_PASSWORD: Generated (40 chars)"
    print_success "SECRET_KEY_BASE: Generated (base64, 48 bytes)"
    print_success "VAULT_ENC_KEY: Generated (32 chars)"
    print_success "DB_ENC_KEY: Generated (32 chars)"
    print_success "JWT_SECRET: Generated (base64, 48 bytes)"

    # Generate JWT tokens
    if generate_jwt_tokens "$JWT_SECRET"; then
        JWT_TOKENS_GENERATED=true
    else
        JWT_TOKENS_GENERATED=false
        ANON_KEY=""
        SERVICE_ROLE_KEY=""
    fi

    # Ask for SMTP credentials (optional)
    echo ""
    echo -e "${BLUE}SMTP Configuration (optional):${NC}"
    print_info "Configure SMTP for sending real emails (password reset, invites, etc.)"
    echo ""
    read -p "$(echo -e ${CYAN}'Do you want to configure SMTP?'${NC}) (y/N): " -n 1 -r
    echo

    if [[ $REPLY =~ ^[Yy]$ ]]; then
        SMTP_USERNAME=$(prompt_with_default "SMTP username" "")
        SMTP_PASSWORD=$(prompt_with_default "SMTP password" "")
        CREATE_SMTP_SECRET=true
        SMTP_SECRET_NAME=$(prompt_with_default "SMTP secret name" "smtp-secret")
    else
        CREATE_SMTP_SECRET=false
        print_info "Skipped SMTP configuration"
    fi

    # Create secrets
    print_header "Creating Secrets"

    # Create Fluxbase secret YAML
    FLUXBASE_SECRET_YAML="apiVersion: v1
kind: Secret
metadata:
  name: ${SECRET_NAME}
  namespace: ${NAMESPACE}
type: Opaque
data:
  jwt-secret: $(echo -n "$JWT_SECRET" | base64)
  anon-key: $(echo -n "$ANON_KEY" | base64)
  service-role-key: $(echo -n "$SERVICE_ROLE_KEY" | base64)
  db-password: $(echo -n "$DB_PASSWORD" | base64)
  db-enc-key: $(echo -n "$DB_ENC_KEY" | base64)
  vault-enc-key: $(echo -n "$VAULT_ENC_KEY" | base64)
  secret-key-base: $(echo -n "$SECRET_KEY_BASE" | base64)
  username: $(echo -n "fake_mail_user" | base64)
  password: $(echo -n "fake_mail_password" | base64)"

    # Create SMTP secret YAML if requested
    if [ "$CREATE_SMTP_SECRET" = true ]; then
        SMTP_SECRET_YAML="apiVersion: v1
kind: Secret
metadata:
  name: ${SMTP_SECRET_NAME}
  namespace: ${NAMESPACE}
type: Opaque
data:
  username: $(echo -n "$SMTP_USERNAME" | base64)
  password: $(echo -n "$SMTP_PASSWORD" | base64)"
    fi

    # Deploy or save secrets
    if [ "$deploy_option" = "1" ]; then
        # Apply directly to cluster
        if ! command -v kubectl &> /dev/null; then
            print_error "kubectl is not installed. Cannot apply secrets to cluster."
            print_info "Saving to files instead..."
            deploy_option=2
        else
            echo "$FLUXBASE_SECRET_YAML" | kubectl apply -f -
            print_success "Fluxbase secret created in cluster: ${NAMESPACE}/${SECRET_NAME}"

            if [ "$CREATE_SMTP_SECRET" = true ]; then
                echo "$SMTP_SECRET_YAML" | kubectl apply -f -
                print_success "SMTP secret created in cluster: ${NAMESPACE}/${SMTP_SECRET_NAME}"
            fi
        fi
    fi

    if [ "$deploy_option" = "2" ]; then
        # Save to files
        echo "$FLUXBASE_SECRET_YAML" > "${SECRET_NAME}.yaml"
        print_success "Fluxbase secret saved to: ${SECRET_NAME}.yaml"

        if [ "$CREATE_SMTP_SECRET" = true ]; then
            echo "$SMTP_SECRET_YAML" > "${SMTP_SECRET_NAME}.yaml"
            print_success "SMTP secret saved to: ${SMTP_SECRET_NAME}.yaml"
        fi

        echo ""
        print_info "To apply the secrets to your cluster, run:"
        echo "  kubectl apply -f ${SECRET_NAME}.yaml"
        if [ "$CREATE_SMTP_SECRET" = true ]; then
            echo "  kubectl apply -f ${SMTP_SECRET_NAME}.yaml"
        fi
    fi

    # Summary
    print_header "Setup Complete!"

    echo "Secrets generated for namespace: ${NAMESPACE}"
    echo ""
    echo "Summary:"
    echo "  • Fluxbase secret name: ${SECRET_NAME}"
    if [ "$CREATE_SMTP_SECRET" = true ]; then
        echo "  • SMTP secret name: ${SMTP_SECRET_NAME}"
    fi
    echo ""

    if [ "$JWT_TOKENS_GENERATED" = false ]; then
        print_warning "JWT tokens were not generated automatically"
        echo "  You will need to generate and update them manually using your JWT secret"
        echo ""
    else
        print_success "JWT tokens were successfully generated"
        echo ""
    fi

    echo "Next steps:"
    echo "  1. Update your values.yaml to reference these secrets:"
    echo "     fluxbase.global.fluxbase.existingSecret: ${SECRET_NAME}"
    if [ "$CREATE_SMTP_SECRET" = true ]; then
        echo "     fluxbase.global.fluxbase.auth.smtp.existingSecret: ${SMTP_SECRET_NAME}"
    fi
    echo "  2. Deploy Wayli using: helm install wayli ./wayli -n ${NAMESPACE}"
    echo ""
}

# Run main function
main "$@"

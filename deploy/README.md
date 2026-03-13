# Wayli Deployment Guide

This directory contains deployment configurations for Wayli. Choose the deployment method that best fits your needs.

## Deployment Options

### 🐳 Docker Compose

Docker Compose provides a simple way to run Wayli with all its dependencies (including Fluxbase) on a single machine.

**Quick Start:**
```bash
cd docker-compose
cp .env.example .env
# Edit .env with your configuration
docker-compose up -d
```

See [docker-compose/README.md](docker-compose/README.md) for detailed instructions.

### ☸️ Kubernetes (Helm)

The Helm chart provides a production-ready Kubernetes deployment with automatic scaling, health checks, and rolling updates.

**Quick Start (OCI - Recommended):**
```bash
helm install wayli oci://ghcr.io/nimbleflux/charts/wayli -n wayli --create-namespace
```

**Alternative (Helm Repository):**
```bash
helm repo add wayli https://nimbleflux.github.io/wayli
helm repo update
helm install wayli wayli/wayli -n wayli --create-namespace
```

See [charts/wayli/README.md](../charts/wayli/README.md) for detailed configuration options.

## Common Configuration

Both deployment methods require:
- **Fluxbase**: Backend API service, included as a dependency in both setups
- **PostgreSQL**: Provided by Fluxbase
- **SMTP**: Optional, for email notifications
- **Storage**: For uploaded images and data

## Updates

Both deployment methods support semantic versioning:
- Docker images: `ghcr.io/nimbleflux/wayli:v1.2.3`, `ghcr.io/nimbleflux/wayli:latest`
- Helm chart: Automatically tracks application versions

To update to the latest version:

**Docker Compose:**
```bash
docker-compose pull
docker-compose up -d
```

**Kubernetes:**
```bash
helm repo update
helm upgrade wayli wayli/wayli -n wayli
```

## Support

For issues or questions:
- Docker Compose: See [docker-compose/README.md](docker-compose/README.md)
- Kubernetes: See [charts/wayli/README.md](../charts/wayli/README.md)
- General: [GitHub Issues](https://github.com/nimbleflux/wayli/issues)

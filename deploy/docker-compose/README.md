# Docker Compose Deployment for Wayli

Deploy Wayli with Fluxbase backend using Docker Compose.

## Prerequisites

- Docker Engine 20.10+
- Docker Compose v2.0+
- 4GB RAM, 10GB disk space

## Quick Start

### 1. Generate Configuration

Run the setup script to generate all required secrets:

```bash
./generate-keys.sh
```

The script will prompt you for:
- **FLUXBASE_PUBLIC_BASE_URL**: Public URL for the API (default: `http://localhost:8080`)
- **FLUXBASE_BASE_URL**: Internal URL for container communication (default: `http://fluxbase:8080`)

It automatically generates all secrets (database password, JWT tokens, encryption keys) and saves them to `.env`.

### 2. Deploy

```bash
docker compose up -d
```

### 3. Access

- **Wayli**: http://localhost:4000
- **Fluxbase Admin**: http://localhost:8080/admin/setup (use the setup token from step 1)

## Useful Commands

```bash
docker compose ps              # Check service status
docker compose logs -f wayli   # View Wayli logs
docker compose down            # Stop all services
docker compose pull && docker compose up -d   # Update to latest version
```

## Data Persistence

Data is stored in Docker named volumes:
- `wayli_db-data`: PostgreSQL database
- `wayli_storage-data`: File storage

### Backup

```bash
# Database
docker compose exec db pg_dump -U postgres postgres > backup.sql

# Restore
docker compose exec -T db psql -U postgres postgres < backup.sql
```

## Troubleshooting

**Services won't start**: Check logs with `docker compose logs`

**Port conflicts**: Edit port mappings in `docker-compose.yml`

## Support

- [GitHub Issues](https://github.com/nimbleflux/wayli/issues)
- [Documentation](https://github.com/nimbleflux/wayli)

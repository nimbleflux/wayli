# Wayli with Fluxbase - Development Environment

This setup replaces the 11+ Supabase services with a single Fluxbase container, providing the same functionality with significantly reduced complexity and resource usage.

## Architecture Comparison

### Before (Supabase)
- **11+ services**: Kong, GoTrue, PostgREST, Realtime, Storage, Edge Functions, Meta, Studio, ImgProxy, PostgreSQL, MinIO
- **Resource usage**: ~2-4 GB RAM
- **Startup time**: ~30-60 seconds

### After (Fluxbase)
- **4 services**: Fluxbase, PostgreSQL, MinIO, Flyway (migrations)
- **Resource usage**: ~256-512 MB RAM
- **Startup time**: ~5-10 seconds

## Quick Start

### 1. Initial Setup

```bash
# Navigate to docker-compose directory
cd deploy/docker-compose

# Copy environment file
cp .env.fluxbase.example .env.fluxbase

# Edit environment variables (at minimum, change the secrets!)
nano .env.fluxbase
```

**Note**: Database migrations have already been converted to Fluxbase format (`NNN_name.{up,down}.sql`) in `volumes/migrations/`.

### 2. Start Services

```bash
# Start all services
docker compose -f docker-compose.fluxbase.yml --env-file .env.fluxbase up -d

# Watch logs
docker compose -f docker-compose.fluxbase.yml logs -f fluxbase

# Check status
docker compose -f docker-compose.fluxbase.yml ps
```

### 3. Verify Installation

```bash
# Check Fluxbase health
curl http://localhost:8080/health
# Expected: {"status":"ok"}

# Check PostgreSQL
docker compose -f docker-compose.fluxbase.yml exec postgres psql -U postgres -d wayli -c "\dt"
# Should list tables from migrations

# Access MinIO Console
open http://localhost:9001
# Login: minioadmin / minioadmin
```

### 4. Test Authentication

```bash
# Sign up a test user
curl -X POST http://localhost:8080/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123456!"}'

# Should return a session with access_token
```

## Service Details

### Fluxbase (Port 8080)
- **REST API**: Auto-generated from PostgreSQL schema
- **Authentication**: Email/password, magic links, OAuth, 2FA
- **Realtime**: WebSocket subscriptions with row-level filtering
- **Storage**: S3-compatible via MinIO integration
- **Edge Functions**: Deno runtime (mounted from `./volumes/functions`)

**Health Check**: http://localhost:8080/health

### PostgreSQL (Port 5432)
- **Image**: PostGIS 17-3.5
- **Database**: wayli
- **Extensions**: PostGIS, pgcrypto, uuid-ossp

**Connect**:
```bash
docker compose -f docker-compose.fluxbase.yml exec postgres psql -U postgres -d wayli
```

### MinIO (Ports 9000, 9001)
- **API**: http://localhost:9000
- **Console**: http://localhost:9001
- **Credentials**: minioadmin / minioadmin (change in production!)
- **Buckets**: trip-images, exports

### Flyway Migrations
- Runs automatically on startup
- Migrations from `./volumes/migrations`
- One-time execution, exits after completion

## Environment Variables

### Required Secrets

```bash
# Generate strong passwords
POSTGRES_PASSWORD=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 48)
MINIO_ROOT_PASSWORD=$(openssl rand -base64 32)
```

### API Keys

Generate at: https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys

Or use the development keys provided in `.env.fluxbase.example` (NOT for production!)

### SMTP Configuration

For local development, use Mailhog:

```yaml
# Add to docker-compose.fluxbase.yml
mailhog:
  image: mailhog/mailhog:latest
  ports:
    - "1025:1025"  # SMTP
    - "8025:8025"  # Web UI
```

Then in `.env.fluxbase`:
```bash
SMTP_HOST=mailhog
SMTP_PORT=1025
```

Access emails at: http://localhost:8025

## Development Workflow

### Running the Web Application

#### Option 1: Local Development (Recommended)

```bash
cd ../../web

# Install dependencies
npm install

# Install Fluxbase SDK
npm install @fluxbase/sdk

# Update environment
cat > .env.development.local <<EOF
PUBLIC_FLUXBASE_BASE_URL=http://localhost:8080
PUBLIC_FLUXBASE_ANON_KEY=<your-anon-key>
FLUXBASE_SERVICE_ROLE_KEY=<your-service-role-key>
EOF

# Start dev server
npm run dev
```

Access app at: http://localhost:5173

#### Option 2: Dockerized

```bash
# Build and run web container (uses production build)
docker compose -f docker-compose.fluxbase.yml up wayli-web
```

Access app at: http://localhost:4000

### Running the Worker

```bash
# Worker runs automatically with docker-compose up
docker compose -f docker-compose.fluxbase.yml logs -f wayli-worker
```

### Database Migrations

```bash
# Add new migration to ./volumes/migrations/
# Example: 2025111001__add_new_table.sql

# Restart Flyway to run new migrations
docker compose -f docker-compose.fluxbase.yml restart flyway-migrations

# Check logs
docker compose -f docker-compose.fluxbase.yml logs flyway-migrations
```

### Edge Functions

```bash
# Add functions to ./volumes/functions/
# Structure:
# volumes/functions/
#   ├── export-download/
#   │   └── index.ts
#   └── owntracks-points/
#       └── index.ts

# Restart Fluxbase to reload functions
docker compose -f docker-compose.fluxbase.yml restart fluxbase
```

## Troubleshooting

### Fluxbase Won't Start

```bash
# Check logs
docker compose -f docker-compose.fluxbase.yml logs fluxbase

# Common issues:
# 1. PostgreSQL not ready - wait for health check
# 2. Invalid JWT_SECRET - must be 32+ characters
# 3. Database connection - check POSTGRES_PASSWORD matches
```

### Migrations Failed

```bash
# Check Flyway logs
docker compose -f docker-compose.fluxbase.yml logs flyway-migrations

# Manual migration
docker compose -f docker-compose.fluxbase.yml exec postgres \
  psql -U postgres -d wayli -f /docker-entrypoint-initdb.d/your-migration.sql
```

### Cannot Connect to Realtime

```bash
# Check Fluxbase logs for WebSocket errors
docker compose -f docker-compose.fluxbase.yml logs fluxbase | grep -i websocket

# Test WebSocket connection
wscat -c ws://localhost:8080/realtime/v1/websocket
```

### Storage Upload Fails

```bash
# Check MinIO is healthy
curl http://localhost:9000/minio/health/live

# Verify buckets exist
docker compose -f docker-compose.fluxbase.yml exec -T minio-setup \
  mc ls wayli/

# Check Fluxbase storage logs
docker compose -f docker-compose.fluxbase.yml logs fluxbase | grep -i storage
```

## Useful Commands

### Logs

```bash
# All services
docker compose -f docker-compose.fluxbase.yml logs -f

# Specific service
docker compose -f docker-compose.fluxbase.yml logs -f fluxbase
docker compose -f docker-compose.fluxbase.yml logs -f postgres
docker compose -f docker-compose.fluxbase.yml logs -f wayli-web
docker compose -f docker-compose.fluxbase.yml logs -f wayli-worker
```

### Database Access

```bash
# PostgreSQL shell
docker compose -f docker-compose.fluxbase.yml exec postgres \
  psql -U postgres -d wayli

# Run query
docker compose -f docker-compose.fluxbase.yml exec -T postgres \
  psql -U postgres -d wayli -c "SELECT * FROM jobs LIMIT 10;"

# Dump database
docker compose -f docker-compose.fluxbase.yml exec -T postgres \
  pg_dump -U postgres wayli > backup.sql

# Restore database
docker compose -f docker-compose.fluxbase.yml exec -T postgres \
  psql -U postgres wayli < backup.sql
```

### Cleanup

```bash
# Stop services
docker compose -f docker-compose.fluxbase.yml down

# Remove volumes (WARNING: deletes all data!)
docker compose -f docker-compose.fluxbase.yml down -v

# Full cleanup
docker compose -f docker-compose.fluxbase.yml down -v --remove-orphans
docker volume prune -f
docker network prune -f
```

## Production Deployment

### Security Checklist

- [ ] Change all default passwords
- [ ] Generate new JWT_SECRET
- [ ] Generate new API keys (ANON_KEY, SERVICE_ROLE_KEY)
- [ ] Configure real SMTP server
- [ ] Set DISABLE_SIGNUP=true (if applicable)
- [ ] Use TLS/SSL for external access
- [ ] Configure firewall rules
- [ ] Set up monitoring and logging
- [ ] Enable PostgreSQL backups
- [ ] Use secrets management (not .env files)

### Recommended Changes

```yaml
# docker-compose.fluxbase.yml

# 1. Use specific versions (not :latest)
fluxbase:
  image: ghcr.io/wayli-app/fluxbase:v1.2.3

# 2. Resource limits
  deploy:
    resources:
      limits:
        cpus: '1'
        memory: 512M
      reservations:
        cpus: '0.5'
        memory: 256M

# 3. Read-only root filesystem
  read_only: true
  tmpfs:
    - /tmp

# 4. Health checks with retries
  healthcheck:
    retries: 10
    start_period: 30s
```

## Comparison with Supabase Setup

| Feature | Supabase | Fluxbase | Compatible |
|---------|----------|----------|------------|
| Auth | GoTrue | Built-in | ✅ 100% |
| Database | PostgREST | Built-in | ✅ PostgREST-compatible |
| Realtime | Separate service | Built-in | ✅ With row filtering |
| Storage | Separate service | Built-in | ✅ S3-compatible |
| Edge Functions | Deno runtime | Deno runtime | ✅ Compatible |
| Admin UI | Studio | None | ⚠️ Use pgAdmin/DBeaver |
| API Gateway | Kong | None | ✅ Not needed |
| Services | 11+ | 1 | ✅ Simplified |
| Memory | 2-4 GB | 256-512 MB | ✅ 4-8x less |
| Startup | 30-60s | 5-10s | ✅ 6x faster |

## Migrating from Supabase

### Code Changes Required

See the migration guide in `/fluxbase-row-filtering-spec.md` for detailed instructions.

**Summary**:
1. Replace `@supabase/supabase-js` with `@fluxbase/sdk`
2. Update client initialization
3. Add `.execute()` to database queries
4. Update environment variables
5. Test realtime subscriptions (row filtering now supported!)

### Data Migration

**No data migration needed!** Both setups use the same PostgreSQL database. Simply:

1. Dump data from Supabase PostgreSQL
2. Restore to Fluxbase PostgreSQL
3. Migrations run automatically

```bash
# Export from Supabase
docker compose exec supabase-db pg_dump -U postgres postgres > wayli-backup.sql

# Import to Fluxbase
docker compose -f docker-compose.fluxbase.yml exec -T postgres \
  psql -U postgres wayli < wayli-backup.sql
```

## Support

- **Fluxbase Docs**: https://fluxbase.eu/docs
- **GitHub**: https://github.com/wayli-app/fluxbase
- **Discord**: https://discord.gg/BXPRHkQzkA

## License

Same as Wayli project.

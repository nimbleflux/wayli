# Wayli Devcontainer

This devcontainer provides a complete development environment for Wayli with PostgreSQL 18 and Fluxbase.

## What's Included

- **Node.js 20**: For running the SvelteKit web application
- **PostgreSQL 18**: Database server
- **Fluxbase**: Backend API service (port 8080)
- **Development Tools**: Git, GitHub CLI, PostgreSQL client, pnpm

## Getting Started

1. Open this folder in VS Code
2. When prompted, click "Reopen in Container" (or run the command "Dev Containers: Reopen in Container")
3. Wait for the container to build and services to start
4. The development environment will be ready with:
   - PostgreSQL running on port 5432
   - Fluxbase API running on port 8080
   - Your workspace mounted at `/workspace`

## Ports

- **5173**: SvelteKit development server (web app)
- **8080**: Fluxbase API
- **5432**: PostgreSQL database

## Environment Variables

The following environment variables are pre-configured:

- `DATABASE_URL`: PostgreSQL connection string (uses localhost:5432 from within containers)
- `FLUXBASE_BASE_URL`: Fluxbase API endpoint
- `JWT_SECRET`: JWT secret for authentication (change in production)
- `FLUXBASE_ANON_KEY`: Anonymous API key for Edge Functions (development key only)
- `FLUXBASE_SERVICE_ROLE_KEY`: Service role API key for Edge Functions (development key only)

**Note:** The API keys are hardcoded development keys from Supabase's demo. These are safe for local development but should NEVER be used in production.

## Accessing Services

### PostgreSQL
```bash
psql postgresql://fluxbase:postgres@localhost:5432/fluxbase
```

### Fluxbase API
The Fluxbase API is available at `http://localhost:8080`

### Running the Web App
```bash
cd web
npm install
npm run dev
```

## VS Code Extensions

The following extensions are automatically installed:
- Svelte for VS Code
- ESLint
- Prettier
- Tailwind CSS IntelliSense
- Docker

## Troubleshooting

### PostgreSQL container is unhealthy
If you see "dependency failed to start: container wayli_devcontainer-postgres-1 is unhealthy":

**This is usually caused by old PostgreSQL data volumes.** PostgreSQL 18 changed its data directory structure.

**Solution:**
```bash
# Remove old containers and volumes
docker compose -f .devcontainer/docker-compose.yml down -v

# Rebuild and start fresh
docker compose -f .devcontainer/docker-compose.yml up -d

# Wait 30 seconds, then check health
docker compose -f .devcontainer/docker-compose.yml ps postgres
```

If the issue persists:
1. **Check PostgreSQL logs:**
   ```bash
   docker compose -f .devcontainer/docker-compose.yml logs postgres
   ```

2. **Verify PostgreSQL is ready:**
   ```bash
   docker compose -f .devcontainer/docker-compose.yml exec postgres pg_isready -U fluxbase
   ```

### Services not starting
Check if the containers are running:
```bash
docker compose -f .devcontainer/docker-compose.yml ps
```

### PostgreSQL connection issues
Verify PostgreSQL is healthy:
```bash
docker compose -f .devcontainer/docker-compose.yml exec postgres pg_isready -U fluxbase
```

### Port conflicts
If port 5432, 8080, or 5173 are already in use:
- Stop the conflicting service (e.g., `brew services stop postgresql` for local PostgreSQL)
- Or change the port mapping in `docker-compose.yml`

### Fluxbase container exits immediately
If Fluxbase exits with code 1, check the logs:
```bash
docker compose -f .devcontainer/docker-compose.yml logs fluxbase
```

**Common issues:**
1. **JWT Secret validation**: Fluxbase requires a secure JWT secret. The devcontainer uses a development-only secret that should work. If you see JWT-related errors, ensure `FLUXBASE_AUTH_JWT_SECRET` is set to a long, secure string.

2. **Database connection**: Ensure PostgreSQL is healthy before Fluxbase starts. The `depends_on: postgres: condition: service_healthy` configuration handles this automatically.

### Authentication/subscription verification fails
If you see errors like "FLUXBASE_SERVICE_ROLE_KEY environment variable is not set" or authentication fails during the auth flow:

**This happens when the Edge Functions can't access the API keys.**

The Edge Functions running inside Fluxbase need access to `FLUXBASE_ANON_KEY` and `FLUXBASE_SERVICE_ROLE_KEY` environment variables. These are now pre-configured in the docker-compose.yml file.

**Solution:**
```bash
# Restart the Fluxbase container to pick up the new environment variables
docker compose -f .devcontainer/docker-compose.yml restart fluxbase

# Or rebuild everything from scratch
docker compose -f .devcontainer/docker-compose.yml down -v
docker compose -f .devcontainer/docker-compose.yml up -d
```

### Dev container network errors
If you see "can't get final child's PID from pipe: EOF" or similar errors:

**Solution:**
```bash
# Clean up all containers and networks
docker compose -f .devcontainer/docker-compose.yml down

# Rebuild in VS Code
# Command Palette: "Dev Containers: Rebuild Container"
```

This error can occur if services aren't starting in the correct order or if there are leftover network configurations.

### Rebuild the container
If you make changes to the Dockerfile or docker-compose.yml, rebuild:
- Command Palette: "Dev Containers: Rebuild Container"

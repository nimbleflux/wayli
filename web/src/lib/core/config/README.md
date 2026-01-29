# Environment Configuration

Wayli is a client-side SvelteKit application. All server-side operations (authentication, database queries, background jobs, edge functions) are handled by Fluxbase.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Client (Browser)                                           │
│  └── src/lib/config.ts      → Runtime configuration         │
│  └── src/lib/fluxbase.ts    → Fluxbase client SDK           │
├─────────────────────────────────────────────────────────────┤
│  Fluxbase (Backend)                                         │
│  ├── Edge Functions         → fluxbase/functions/           │
│  ├── Background Jobs        → fluxbase/jobs/                │
│  └── Database + Auth        → PostgreSQL with RLS           │
└─────────────────────────────────────────────────────────────┘
```

## Client Configuration

The client uses two files for configuration:

### `src/lib/config.ts`

Runtime configuration that works in both development and production:

```typescript
import { config } from '$lib/config';

// Get Fluxbase URL (handles dev vs production automatically)
const url = config.fluxbaseUrl;
const anonKey = config.fluxbaseAnonKey;
```

### `src/lib/fluxbase.ts`

Pre-configured Fluxbase client for database operations:

```typescript
import { fluxbase } from '$lib/fluxbase';

// Use the client for queries (RLS enforced automatically)
const { data } = await fluxbase.from('trips').select('*');
```

## Environment Variables

### For Development (`.env`)

```env
FLUXBASE_PUBLIC_BASE_URL=http://127.0.0.1:8080
PUBLIC_FLUXBASE_ANON_KEY=your-anon-key
```

### For Deployment (Docker/Kubernetes)

Deployment configs use `FLUXBASE_ANON_KEY` (without `PUBLIC_` prefix). The `vite.config.ts` and `startup.sh` automatically map it to `PUBLIC_FLUXBASE_ANON_KEY`.

```env
FLUXBASE_PUBLIC_BASE_URL=https://flux.your-domain.com
FLUXBASE_ANON_KEY=your-anon-key
```

### Fluxbase Internal URL

For Kubernetes deployments, Fluxbase jobs and edge functions use `FLUXBASE_BASE_URL` for internal cluster communication:

```env
# Public URL (browsers)
FLUXBASE_PUBLIC_BASE_URL=https://flux.your-domain.com

# Internal URL (Fluxbase jobs/functions within cluster)
FLUXBASE_BASE_URL=http://fluxbase:8080
```

## Security Notes

- The anonymous key (`FLUXBASE_ANON_KEY`) is safe to expose to clients
- Row-Level Security (RLS) in PostgreSQL enforces data access policies
- Service role keys are only used by Fluxbase itself, never by the client app
- All sensitive operations go through Fluxbase's authenticated endpoints

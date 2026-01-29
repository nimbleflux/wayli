# Shared Configuration

This directory contains shared configuration utilities. For the main environment configuration documentation, see [`src/lib/core/config/README.md`](../../lib/core/config/README.md).

## Architecture

Wayli is a client-side SvelteKit application. All server-side operations are handled by Fluxbase:

- **Authentication** - Fluxbase Auth
- **Database** - PostgreSQL with Row-Level Security (RLS)
- **Background Jobs** - `fluxbase/jobs/` (run on Fluxbase infrastructure)
- **Edge Functions** - `fluxbase/functions/` (run on Fluxbase infrastructure)

## Client Configuration Files

| File | Purpose |
|------|---------|
| `src/lib/config.ts` | Runtime configuration (Fluxbase URL, anon key) |
| `src/lib/fluxbase.ts` | Pre-configured Fluxbase client SDK |

## Environment Variables

### Development (`.env`)

```env
FLUXBASE_PUBLIC_BASE_URL=http://127.0.0.1:8080
PUBLIC_FLUXBASE_ANON_KEY=your-anon-key
```

### Deployment

Docker and Kubernetes configs use `FLUXBASE_ANON_KEY` (without `PUBLIC_` prefix):

```env
FLUXBASE_PUBLIC_BASE_URL=https://flux.your-domain.com
FLUXBASE_ANON_KEY=your-anon-key
```

The `vite.config.ts` and `startup.sh` automatically map `FLUXBASE_ANON_KEY` to `PUBLIC_FLUXBASE_ANON_KEY`.

## See Also

- [Core Config README](../../lib/core/config/README.md)
- [Fluxbase Jobs](../../../../fluxbase/jobs/README.md)
- [Fluxbase Functions](../../../../fluxbase/functions/ARCHITECTURE.md)

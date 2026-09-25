# Wayli

Privacy-first location tracking and trip analysis application. SvelteKit frontend with Fluxbase backend.

## Tech Stack

- **Frontend**: SvelteKit 2.70, Svelte 5, TypeScript ~6 (strict), Tailwind CSS 4, Vite 8
- **Backend**: Fluxbase SDK, PostgreSQL with pgvector
- **Testing**: Vitest, Testing Library
- **Mapping**: Leaflet with MarkerCluster
- **Validation**: Zod

## Directory Structure

```
web/                      # Main SvelteKit application
├── src/
│   ├── lib/
│   │   ├── accessibility/ # Accessibility utilities
│   │   ├── architecture/  # Architecture documentation
│   │   ├── components/    # Reusable Svelte components
│   │   ├── core/          # Configuration docs (see core/config/README.md)
│   │   ├── i18n/          # Internationalization
│   │   ├── rules/         # Trip/transport detection rules
│   │   ├── schemas/       # Zod validation schemas
│   │   ├── services/      # Business logic (trips, profile, statistics, etc.)
│   │   ├── stores/        # Svelte reactive stores
│   │   ├── types/         # TypeScript type definitions
│   │   └── utils/         # Utility functions
│   ├── routes/
│   │   ├── (user)/        # Protected user routes (dashboard, map, etc.)
│   │   └── auth/          # Auth routes (signin, signup, 2FA)
│   └── shared/            # Shared config, environment, and types
├── tests/                 # Unit, integration, e2e tests
fluxbase/
├── chatbots/              # Chatbot definitions
├── functions/             # Edge functions (8: health, wayli-points, owntracks-points, etc.)
├── jobs/                  # Background jobs (Deno): import, geocoding, trip detection
└── rpc/                   # Remote procedure calls (incl. ensure-user-profile)
deploy/                    # Docker Compose configs
charts/                    # Helm charts for Kubernetes
```

## Commands (run from /web)

**Package manager: `bun`** — use `bun` (not npm/yarn) for all installs, scripts, and test runs.

```bash
bun run dev           # Start dev server
bun run build         # Production build
bun run test          # Run all tests
bun run test:coverage # Tests with coverage
bun run lint          # Check formatting/linting
bun run check         # TypeScript + Svelte checks
bun run sync:all      # Sync all resources (rpc, functions, jobs, chatbots, schema, kb)
bun add <package>     # Install a dependency
bun install           # Restore dependencies from bun.lock
```

## Coding Conventions

### TypeScript

- Strict mode enabled
- Use Zod schemas for runtime validation (in `lib/schemas/`)
- Types in `lib/types/` - prefer interfaces over type aliases

### Svelte Components

- Components in `lib/components/` - PascalCase filenames
- Use Svelte 5 runes (`$state`, `$derived`, `$effect`)
- Props via `$props()`, not `export let`

### Services

- Services in `lib/services/` - kebab-case filenames
- Export functions, not classes
- Use Fluxbase SDK for database queries (client-side with RLS)

### Styling

- Tailwind CSS utility classes
- Use `clsx()` or `tailwind-merge` for conditional classes
- Dark mode via Tailwind's `dark:` variant

### Testing

- Test files: `*.test.ts` or `*.spec.ts`
- Co-locate component tests in `tests/components/`
- Use Testing Library for component tests
- Goal: 85%+ coverage (advisory — CI runs coverage report-only)

## Key Files

- `web/src/lib/fluxbase.ts` - Client-side Fluxbase database client
- `web/src/lib/config.ts` - Client-side runtime configuration
- `web/src/lib/environment.ts`, `web/src/shared/environment.ts`, `web/src/shared/config/environment.ts` - Environment configuration
- `web/src/routes/(user)/dashboard/` - Main user dashboard
- `web/src/lib/services/trips.service.ts` - Core trip service
- `web/src/lib/rules/` - Trip detection algorithms

## Architecture Notes

- **Service pattern**: Business logic in services, not components
- **RLS**: Row-level security handles authorization for data access; role assignment is server-side only — the `user_roles` INSERT clamp plus the `ensure_user_profile` / `request_user_profile` RPCs (fluxbase/schema/public.sql, fluxbase/rpc/ensure-user-profile.sql) bootstrap the first user as admin; clients cannot send `id` or `role`
- **Edge functions**: 8 functions (discover-places, export-kb-tables, health, link-preview, owntracks-points, snap-track, trips-suggest-image, wayli-points) — prefer client SDK with RLS where possible
- **Jobs**: Deno-based background jobs on the Fluxbase platform (geocoding, import, trip detection)
- **No MCP tools or boot-time KB exports**: `fluxbase/mcp-tools/` was migrated to RPCs + the discover-places function; `bun run sync:mcp` remains as an opt-in legacy script (points at the removed dir) and is NOT part of `sync:all`. Boot-time KB table exports were removed from startup (the `wayli-pois` KB itself is still ensured by `sync:kb`, and its documents are per-user via `metadata.user_id`).

## Migration Conventions

- **Views must be DROP'd before CREATE**: `CREATE OR REPLACE VIEW` fails with SQLSTATE 42P16 when the new column list differs from the existing view. Always use `DROP VIEW IF EXISTS` followed by `CREATE VIEW` in migration up files. This is a PostgreSQL limitation, not a Fluxbase issue.
- **Order matters**: Views that depend on tables or other views must be created after their dependencies. Dropping in the correct order matters too.
- **`share_token` column**: was removed in migration 076. Do not reference it.

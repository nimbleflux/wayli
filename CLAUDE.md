# Wayli

Privacy-first location tracking and trip analysis application. SvelteKit frontend with Fluxbase backend.

## Tech Stack
- **Frontend**: SvelteKit 2.16, Svelte 5, TypeScript 5.8 (strict), Tailwind CSS 4, Vite 6
- **Backend**: Fluxbase SDK, PostgreSQL with pgvector
- **Testing**: Vitest, Testing Library
- **Mapping**: Leaflet with MarkerCluster
- **Validation**: Zod

## Directory Structure
```
web/                      # Main SvelteKit application
├── src/
│   ├── lib/
│   │   ├── components/   # Reusable Svelte components
│   │   ├── services/     # Business logic (trips, profile, statistics, etc.)
│   │   ├── stores/       # Svelte reactive stores
│   │   ├── utils/        # Utility functions
│   │   ├── types/        # TypeScript type definitions
│   │   ├── rules/        # Trip/transport detection rules
│   │   ├── core/         # Service container, config, Fluxbase clients
│   │   └── schemas/      # Zod validation schemas
│   ├── routes/
│   │   ├── (user)/       # Protected user routes (dashboard, map, etc.)
│   │   └── auth/         # Auth routes (signin, signup, 2FA)
│   └── shared/           # Shared config and types
├── tests/                # Unit, integration, accessibility tests
fluxbase/
├── functions/            # Edge functions (health, owntracks, trips-suggest-image)
├── jobs/                 # Background jobs (Deno): import, geocoding, trip detection
├── migrations/           # SQL migrations
└── rpc/                  # Remote procedure calls
deploy/                   # Docker Compose configs
charts/                   # Helm charts for Kubernetes
```

## Commands (run from /web)
```bash
npm run dev           # Start dev server
npm run build         # Production build
npm run test          # Run all tests
npm run test:coverage # Tests with coverage
npm run lint          # Check formatting/linting
npm run check         # TypeScript + Svelte checks
npm run sync:all      # Sync functions/jobs/migrations to Fluxbase
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
- Target: 85%+ coverage

## Key Files
- `web/src/lib/core/fluxbase-client.ts` - Database client setup
- `web/src/lib/core/config/` - Environment configuration
- `web/src/routes/(user)/dashboard/` - Main user dashboard
- `web/src/lib/services/trips.ts` - Core trip service
- `web/src/lib/rules/` - Trip detection algorithms

## Architecture Notes
- **Service pattern**: Business logic in services, not components
- **RLS**: Row-level security handles authorization - no server-side auth checks needed
- **Edge functions minimal**: Only 3 functions remain - prefer client SDK with RLS
- **Jobs**: Deno-based background processing for heavy tasks (geocoding, import, trip detection)

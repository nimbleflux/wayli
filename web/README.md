# Wayli - Privacy-First Location Tracking App 🗺️

Alright, so... Wayli is basically this privacy-first location analysis app. The whole thing is kind of a love letter to people who want to track their travels without selling their soul to big tech.

It started as vibes but somehow ended up with... actual architecture? 🤷‍♂️

## ✨ Features

- **🔒 Privacy-First**: Your data stays yours - no tracking, no ads, no data sharing
- **🗺️ Location Tracking**: Track your movements with customizable privacy settings
- **✈️ Trip Management**: Organize and plan your travels with rich metadata
- **📊 Statistics & Analytics**: Visualize your travel patterns and insights
- **🌍 Geocoding**: Automatic location detection and reverse geocoding
- **📱 Responsive Design**: Works seamlessly on desktop and mobile
- **♿ Accessibility**: Built toward WCAG 2.1 AA goals with full keyboard navigation
- **🌙 Dark Mode**: Beautiful light and dark themes
- **🔐 Two-Factor Authentication**: Enhanced security for your account
- **📤 Data Export**: Export your data in multiple formats (JSON, GeoJSON)

## 🏗️ Architecture

Wayli uses a modern, layered architecture with clear separation of concerns:

```mermaid
graph TB
    %% Client Layer
    subgraph "Client Layer"
        UI[UI Components]
        Pages[Svelte Pages]
        Stores[Svelte Stores]
    end

    %% Service Layer
    subgraph "Service Layer"
        CSA[Service Layer Adapter]
        US[User Profile Service]
        TS[Trips Service]
        SS[Statistics Service]
        LCS[Location Cache Service]
        WTVS[Want to Visit Service]
        TLS[Trip Locations Service]
    end

    %% Core Layer
    subgraph "Core Layer"
        SM[Service Manager]
        SC[Service Container]
        ES[Enhanced Cache Service]
        ELS[Enhanced Logger Service]
    end

    %% Infrastructure Layer
    subgraph "Infrastructure Layer"
        subgraph "Fluxbase Clients"
            BC[Browser Client]
        end

        subgraph "Environment Config"
            CEC[Client Environment]
        end

        subgraph "External Services"
            NS[Pelias Service]
            IUS[Image Upload Service]
            VS2[Valhalla Service]
        end
    end

    %% Database Layer
    subgraph "Database Layer"
        DB[(PostgreSQL Database)]
        RLS[Row Level Security]
        RT[Realtime Channels]
    end

    %% Connections
    UI --> CSA
    Pages --> CSA
    Stores --> CSA

    CSA --> US
    CSA --> TS
    CSA --> SS
    CSA --> LCS
    CSA --> WTVS
    CSA --> TLS

    CSA --> SM
    SM --> SC
    SC --> ES
    SC --> ELS

    US --> BC
    TS --> BC
    SS --> BC
    BC --> DB
    BC --> RLS
    BC --> RT
    NS --> VS2
```

All server-side work (authentication, queries, background jobs, edge functions) is handled by
[Fluxbase](https://fluxbase.eu). There is no Node.js server or worker inside the web app itself.

## 🚀 Quick Start

### Prerequisites

- [Bun](https://bun.sh) (the package manager Wayli standardizes on; see `CLAUDE.md`)
- A running Fluxbase + Postgres stack. The fastest path is the devcontainer, or the
  Docker Compose Quick Start in the [root README](../README.md#quick-start):

  ```bash
  cd ../deploy/docker-compose
  ./generate-keys.sh && docker compose up -d
  ```

  This brings up Fluxbase (`http://localhost:8080`) and Postgres. The Wayli web image
  applies the declarative schema (`fluxbase/schema/public.sql`) automatically on
  startup — there is no separate migration step.

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/nimbleflux/wayli.git
   cd wayli/web
   ```

2. **Install dependencies**

   ```bash
   bun install
   ```

3. **Set up environment variables**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` with your Fluxbase credentials (point at the stack from step 0):

   ```env
   FLUXBASE_PUBLIC_BASE_URL=http://localhost:8080
   PUBLIC_FLUXBASE_ANON_KEY=your_fluxbase_anon_key
   FLUXBASE_SERVICE_ROLE_KEY=your_service_role_key
   ```

4. **Sync Fluxbase resources and start the dev server**

   ```bash
   bun run dev:all
   # ...or, if the schema is already applied: bun run dev
   ```

   `dev:all` runs `sync:all` (RPC, functions, jobs, chatbots, schema, KB) against
   the running Fluxbase, then starts Vite. The schema is declarative — there is no
   `fluxbase db reset` / imperative migration directory; it lives in
   `fluxbase/schema/public.sql` and is reconciled by `fluxbase schema sync`.

5. **Open your browser**
   Navigate to `http://localhost:4000`

## 🧪 Testing

Wayli has comprehensive test coverage across all layers:

```bash
# Run all unit tests
bun run test

# Run tests with coverage
bun run test:coverage

# Run specific test categories
bun run test:unit                            # Unit tests (Vitest)
bun run test:integration                     # Integration tests (Vitest)
bun run test:accessibility                   # Accessibility tests (Vitest)

# E2E tests (Playwright) — public/auth pages against `bun run dev`
bun run test:e2e

# Setup-verification smoke — the documented `docker compose up` path.
# Builds the prod image, brings up an isolated stack, verifies the happy path,
# and tears everything down. Run this before tagging a release.
bun run verify:setup
```

### Test Coverage Goals

These thresholds are goals, not enforced gates — CI generates coverage reports
without failing the build on thresholds.

- **Total Coverage**: 85%+
- **Business Logic**: 90%+
- **API Layer**: 85%+
- **Components**: 80%+
- **Accessibility**: 100%

## 🔧 Development

### Project Structure

```
web/
├── src/
│   ├── lib/
│   │   ├── accessibility/       # Accessibility utilities
│   │   ├── architecture/        # Architecture documentation
│   │   ├── components/          # Reusable UI components
│   │   ├── core/
│   │   │   └── config/          # Environment configuration docs
│   │   ├── i18n/               # Internationalization
│   │   ├── rules/              # Trip/transport detection rules
│   │   ├── schemas/            # Zod validation schemas
│   │   ├── services/           # Business logic services
│   │   ├── stores/             # Svelte stores
│   │   ├── types/              # TypeScript types
│   │   ├── utils/
│   │   │   ├── api/            # API utilities and patterns
│   │   │   └── ...             # Other utilities
│   │   ├── config.ts           # Client-side runtime configuration
│   │   ├── environment.ts      # Client-side environment configuration
│   │   └── fluxbase.ts         # Client-side Fluxbase database client
│   ├── shared/                  # Shared config, environment, and types
│   ├── routes/
│   │   ├── (user)/             # Protected user routes
│   │   ├── api/                # API endpoints (link-preview only; not served in production)
│   │   └── auth/               # Auth routes
│   └── static/                 # Static assets
└── tests/                      # Test suite
    ├── unit/                   # Unit tests
    ├── components/             # Component tests
    ├── integration/            # Integration tests
    ├── e2e/                    # End-to-end tests
    ├── helpers/                # Test helpers
    ├── mocks/                  # Test mocks
    └── utils/                  # Test utilities
```

### Key Technologies

- **Frontend**: SvelteKit, TypeScript, Tailwind CSS
- **Backend**: Fluxbase (PostgreSQL, Auth, Storage)
- **Testing**: Vitest, Testing Library
- **Validation**: Zod
- **Deployment**: Docker (nginx + adapter-static) via Docker Compose or Helm

### Development Guidelines

- **TypeScript**: Strict mode enabled, no `any` types
- **Accessibility**: WCAG 2.1 AA compliance required
- **Testing**: Comprehensive test coverage for all features
- **API Design**: RESTful endpoints with consistent response formats
- **Security**: Row-level security, input validation, authentication

## 🔒 Security & Privacy

### Privacy Features

- **Local Processing**: Location data processed locally when possible
- **Data Ownership**: You own your data - no sharing with third parties
- **Transparent**: Open source code for full transparency
- **Minimal Collection**: Only collect data necessary for functionality

### Security Features

- **Authentication**: Fluxbase Auth with 2FA support
- **Authorization**: Row-level security policies
- **Input Validation**: Comprehensive Zod schema validation
- **Error Handling**: Secure error responses without data leakage
- **HTTPS**: All communications encrypted

## ♿ Accessibility

Wayli is built with accessibility as a core principle:

- **WCAG 2.1 AA**: Accessibility target the project builds toward
- **Keyboard Navigation**: Full keyboard support for all features
- **Screen Reader Support**: Semantic HTML and ARIA attributes
- **High Contrast**: Support for high contrast mode
- **Focus Management**: Proper focus indicators and management

## 🌍 Environment Configuration

Wayli is a client-side application - all server-side operations are handled by Fluxbase.

### Client Configuration

```typescript
// src/lib/config.ts - Runtime configuration
import { config } from '$lib/config';
const url = config.fluxbaseUrl;
const anonKey = config.fluxbaseAnonKey;

// src/lib/fluxbase.ts - Pre-configured Fluxbase client
import { fluxbase } from '$lib/fluxbase';
const { data } = await fluxbase.from('trips').select('*');
```

### Vite Configuration

```typescript
// vite.config.ts
// Preview server allowed hosts configuration
export default defineConfig({
	preview: {
		allowedHosts: [
			'localhost',
			'127.0.0.1',
			// Allow production domains from environment variable
			...(process.env.VITE_ALLOWED_HOSTS ? process.env.VITE_ALLOWED_HOSTS.split(',') : []),
			'wayli.app',
			'.wayli.app'
		]
	}
});
```

**Environment Variables:**

- `VITE_ALLOWED_HOSTS`: Comma-separated list of allowed hosts for preview server
  - Example: `VITE_ALLOWED_HOSTS=wayli.app,staging.wayli.app,dev.wayli.app`
  - Default: `wayli.app` and `.wayli.app` (with subdomain support)

**Note**: The `allowedHosts` check prevents host header attacks during development/preview. Since you're using HTTPS in production, this provides minimal additional security benefit.

**Production Deployment**: The Docker container uses nginx to serve the static
SvelteKit build (adapter-static) instead of running a Node.js server, which is
much more efficient and production-ready.

**Docker Architecture**: Multi-stage build (root `Dockerfile`) with nginx for
static serving — there is no worker stage.

## 🐳 Docker

### Container Architecture

The root `Dockerfile` uses a multi-stage build approach:

- **`deno-bin` stage**: provides the Deno binary for Fluxbase edge functions
- **`builder` stage**: Bun installs dependencies and builds the SvelteKit app
- **`production` stage**: debian-slim with nginx serving the static build (port configurable via `PORT`, default 80)

At startup, `startup.sh` templates runtime environment variables into the built
HTML and syncs Fluxbase resources (RPC, functions, jobs, chatbots, schema) via
the Fluxbase CLI. There is no `APP_MODE` switch — every container serves the web
app; background processing runs as Fluxbase jobs on the platform.

### Runtime Environment Variables

| Variable                                            | Purpose                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `FLUXBASE_BASE_URL`                                 | Fluxbase instance URL, used by the CLI to sync resources (required unless `SKIP_SYNC=true`) |
| `FLUXBASE_SERVICE_ROLE_KEY`                         | Service role key for the sync CLI (required unless `SKIP_SYNC=true`)                        |
| `FLUXBASE_PUBLIC_BASE_URL`                          | Browser-facing Fluxbase URL injected into the built HTML                                    |
| `FLUXBASE_ANON_KEY` (or `PUBLIC_FLUXBASE_ANON_KEY`) | Anon key injected into the built HTML and `wayli-app.json`                                  |
| `PORT`                                              | Port nginx listens on (default 80)                                                          |
| `SKIP_SYNC`                                         | Set to `true` to skip resource sync (e.g. Kubernetes init container handles it)             |

### Building and Running

```bash
# Build the container from the repo root
docker build -t wayli-web .

# Run (nginx serving static files)
docker run -p 8080:80 \
  -e FLUXBASE_BASE_URL=http://localhost:8080 \
  -e FLUXBASE_SERVICE_ROLE_KEY=... \
  -e FLUXBASE_PUBLIC_BASE_URL=http://localhost:8080 \
  -e FLUXBASE_ANON_KEY=... \
  wayli-web
```

For a full self-hosted stack, prefer the Docker Compose setup in
[`deploy/docker-compose`](../deploy/docker-compose/README.md) or the Helm chart
in [`charts/wayli`](../charts/wayli/README.md).

### Setup-Verification Smoke

`bun run verify:setup` builds the production image, brings up an isolated
stack, verifies the documented happy path, and tears everything down. Run it
before tagging a release.

## 📚 Documentation

- **[AI.MD](AI.MD)**: Comprehensive development guidelines
- **[API Documentation](src/lib/utils/api/README.md)**: API patterns and usage
- **[Testing Guide](tests/README.md)**: Testing strategy and patterns
- **[Contributing Guide](CONTRIBUTING.md)**: How to contribute to the project

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

### Code Standards

- Follow TypeScript strict mode
- Write comprehensive tests
- Ensure accessibility compliance
- Follow the established API patterns
- Update documentation as needed

## 📄 License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0) - see the [LICENSE](../LICENSE) file for details.

## 🙏 Acknowledgments

- [SvelteKit](https://kit.svelte.dev/) for the amazing framework
- [Fluxbase](https://fluxbase.eu/) for the backend infrastructure
- [Tailwind CSS](https://tailwindcss.com/) for the styling system
- [Vitest](https://vitest.dev/) for the testing framework
- [Zod](https://zod.dev/) for runtime validation

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/your-username/wayli/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-username/wayli/discussions)
- **Documentation**: [Project Wiki](https://github.com/your-username/wayli/wiki)

---

**Made with ❤️ for travelers who value privacy and control over their data.**

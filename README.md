# Wayli 🗺️

**IMPORTANT NOTE:** I'm currently actively working on moving a way from Supabase to a different backend. There will not be a convenient upgrade path other than exporting and importing data again. Hold on for a bit before deploying Wayli at this moment. I can already tell the next release of Wayli is going to be _significantly_ better.

[![CI](https://github.com/wayli-app/wayli/actions/workflows/ci.yml/badge.svg)](https://github.com/wayli-app/wayli/actions/workflows/ci.yml)
[![Release](https://github.com/wayli-app/wayli/actions/workflows/release.yml/badge.svg)](https://github.com/wayli-app/wayli/actions/workflows/release.yml)
[![Release Chart](https://github.com/wayli-app/wayli/actions/workflows/release-chart.yml/badge.svg)](https://github.com/wayli-app/wayli/actions/workflows/release-chart.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/github/v/release/wayli-app/wayli)](https://github.com/wayli-app/wayli/releases)
[![Docker](https://img.shields.io/docker/v/zehbart/wayli?label=docker&sort=semver)](https://hub.docker.com/r/zehbart/wayli)
[![Docker Pulls](https://img.shields.io/docker/pulls/zehbart/wayli)](https://hub.docker.com/r/zehbart/wayli)
[![Code Coverage](https://img.shields.io/badge/coverage-85%25-brightgreen)](web/README.md)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-yellow.svg)](https://conventionalcommits.org)

[![SvelteKit](https://img.shields.io/badge/SvelteKit-FF3E00?logo=svelte&logoColor=white)](https://kit.svelte.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)

Alright, so... Wayli is basically a privacy-first location analysis app. The whole thing is kind of a love letter to people who want to track their travels without selling their soul to big tech.

## Screenshots

<div align="center">

### Track Your Trips
![Trips Overview](docs/images/screenshot-trips.jpg)
*Automatically detected trips with cover photos and transport mode detection*

### Analyze Your Movement Patterns
![Statistics Dashboard](docs/images/screenshot-statistics.jpg)
*Detailed statistics including distance traveled, transport modes, and interactive maps*

### Plan Future Adventures
![Want to Visit](docs/images/screenshot-want-to-visit.jpg)
*Keep track of places you want to visit with map visualization*

</div>

## What it does

- Tracks your GPS movements and automatically figures out your trips
- Tries to guess your transport mode (car, train, bike, etc.)
- Lets you upload cover photos for trips, and integrates with Pexels for pretty pictures
- Export everything because YOUR data is YOURS
- Privacy-first: your data, your control

## The vibe-coded stack

- **Frontend**: SvelteKit + TypeScript + Tailwind (because who doesn't love a good component framework)
- **Backend**: Supabase doing the heavy lifting (PostgreSQL, auth, storage, the works)
- **Architecture**: Got this whole layered thing going on - services, stores, API handlers, the full shebang. It's actually pretty well organized... for something mostly vibe-coded

**Fun facts:**
- Actually has test coverage goals (85%+) which is wild for a vibe-coded project
- WCAG 2.1 AA compliant because accessibility matters
- Has this whole service manager architecture with client-safe vs server-only services

The codebase is at `/web` and honestly it's got more structure than you'd expect. Check out the [web README](web/README.md) for the full architecture breakdown.

## Quick Start
```bash
git clone https://github.com/wayli-app/wayli.git
cd wayli/web
npm install
npm run dev
```

## 🚀 Releases & Semantic Versioning

This project uses semantic versioning based on [Conventional Commits](https://www.conventionalcommits.org/).

### Creating a Release

Releases are triggered manually via GitHub Actions:

1. Go to **Actions** → **Release** → **Run workflow**
2. Optionally enable "Dry run" to preview the release without publishing
3. The release pipeline automatically:
   - Analyzes commit messages to determine version bumps
   - Creates semantic version tags (e.g., `v1.2.3`)
   - Generates GitHub releases with automatic release notes
   - Builds and tags Docker images
   - Updates deployment configurations (Helm charts, docker-compose)

This approach allows you to:
- Merge PRs to main anytime for CI/testing
- Batch multiple changes into a single release
- Control exactly when releases happen

### 📝 Commit Message Format

Follow this format for your commit messages:

```
<type>(<scope>): <subject>

<body>

<footer>
```

#### Types:
- `feat`: New feature (minor version bump)
- `fix`: Bug fix (patch version bump)
- `docs`: Documentation changes (patch version bump)
- `style`: Code style changes (patch version bump)
- `refactor`: Code refactoring (patch version bump)
- `perf`: Performance improvements (patch version bump)
- `test`: Test changes (patch version bump)
- `build`: Build system changes (patch version bump)
- `ci`: CI/CD changes (patch version bump)
- `chore`: Maintenance tasks (patch version bump)
- `revert`: Revert previous commit (patch version bump)

#### Scopes:
- `web`: Web application
- `api`: API endpoints
- `db`: Database changes
- `auth`: Authentication related
- `ui`: User interface
- `worker`: Background workers
- `docker`: Docker configuration
- `ci`: CI/CD pipeline

#### Examples:
```bash
git commit -m "feat(web): add user dashboard"
git commit -m "fix(auth): resolve login token expiration issue"
git commit -m "docs(api): update API documentation"
git commit -m "ci: add semantic versioning workflow"
```

#### Breaking Changes:
Use `BREAKING CHANGE:` in the footer for major version bumps:
```bash
git commit -m "feat(api): change user endpoint response format

BREAKING CHANGE: The user endpoint now returns user data in a different format."
```

### 🔄 Version Bumps

- **Patch** (`1.0.0` → `1.0.1`): Bug fixes, documentation, style changes
- **Minor** (`1.0.0` → `1.1.0`): New features (backward compatible)
- **Major** (`1.0.0` → `2.0.0`): Breaking changes

### 🐳 Docker Images

Docker images are automatically tagged with:
- `zehbart/wayli:v1.2.3` - Semantic version
- `zehbart/wayli:latest` - Latest stable version
- `zehbart/wayli:abc1234` - Git commit SHA

## 📦 Deployment

Wayli can be deployed using Docker Compose or Kubernetes (via Helm chart). Both deployment methods require Supabase configuration.

**Choose your deployment method:**
- **Docker Compose**: Perfect for development, testing, and small self-hosted installations
- **Kubernetes (Helm)**: Recommended for production deployments with automatic scaling and high availability

See the [Deployment Guide](deploy/README.md) for detailed instructions.

### Quick Start

**Docker Compose:**
```bash
cd deploy/docker-compose
cp .env.example .env
# Edit .env with your configuration
docker-compose up -d
```

**Kubernetes (Helm):**
```bash
# Add the Wayli Helm repository
helm repo add wayli https://wayli-app.github.io/wayli
helm repo update

# Install with default values
helm install wayli wayli/wayli -n wayli --create-namespace

# Or customize with your own values
helm install wayli wayli/wayli -n wayli --create-namespace -f custom-values.yaml
```

For detailed Helm chart configuration options (ingress, autoscaling, resources, etc.), see the [Helm Chart README](charts/wayli/README.md).

Both deployment configurations are automatically updated with each release using semantic versioning.

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute, file issues, and submit pull requests.

## License
Wayli is licensed under the MIT License. See [LICENSE](LICENSE) for details.

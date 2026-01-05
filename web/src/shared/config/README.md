# Environment Configuration Guide

This directory contains the centralized environment configuration system for the Wayli project. The configuration is separated into different contexts to ensure security and proper separation of concerns.

## 🏗️ Architecture Overview

The environment configuration follows a layered approach:

```
┌─────────────────────────────────────────────────────────────┐
│                    Environment Layers                       │
├─────────────────────────────────────────────────────────────┤
│  Server-Side (SvelteKit)                                    │
│  ├── server-environment.ts (Private variables)              │
│  └── $env/static/private                                    │
├─────────────────────────────────────────────────────────────┤
│  Worker (Node.js)                                           │
│  └── worker-environment.ts (process.env)                    │
└─────────────────────────────────────────────────────────────┘
```

## 📁 File Structure

### `server-environment.ts` - Server-Side Configuration

- **Purpose**: Server-only configuration using SvelteKit's `$env/static/private`
- **Usage**: API routes, server actions, server-side load functions
- **Variables**: Service role keys, database URLs, secrets
- **Security**: Private variables only, never exposed to client

```typescript
// ✅ Safe for server-side
import { validateServerEnvironmentConfig } from '$lib/core/config/server-environment';

// ❌ Never import in client-side code
// This would cause build errors and security issues
```

### `worker-environment.ts` - Worker Configuration

- **Purpose**: Node.js worker environment using `process.env`
- **Usage**: Background workers, job processors, standalone Node.js processes
- **Variables**: Worker-specific configuration, process-level variables
- **Security**: Uses `process.env` for Node.js compatibility

```typescript
// ✅ Safe for worker processes
import { validateWorkerEnvironmentConfig } from '$lib/core/config/worker-environment';
```

## 🔒 Security Guidelines

### ✅ Do's

- Use the appropriate config for each context
- Validate environment variables at startup
- Use TypeScript interfaces for type safety
- Handle missing variables gracefully
- Log configuration issues in development

### ❌ Don'ts

- Never import `$env/static/private` in client-side code
- Never import server configs in client components
- Never expose secrets in client bundles
- Never use `process.env` in SvelteKit server code
- Never hardcode sensitive values

## 🚀 Usage Examples

### Client-Side Configuration

```typescript
// src/routes/+page.svelte
// Note: Pelias configuration is now handled directly in the service
// Client-side can use PUBLIC_PELIAS_ENDPOINT env var (defaults to https://pelias.wayli.app)
```

### Server-Side Configuration

```typescript
// src/routes/api/v1/users/+server.ts
import { validateServerEnvironmentConfig } from '$lib/core/config/server-environment';

const config = validateServerEnvironmentConfig(true);
// config.fluxbase.url = 'https://your-project.fluxbase.eu'
// config.fluxbase.serviceRoleKey = 'your-service-role-key'
```

### Worker Configuration

```typescript
// src/lib/services/workers/job-worker.service.ts
import { validateWorkerEnvironmentConfig } from '$lib/core/config/worker-environment';

const config = validateWorkerEnvironmentConfig();
// config.fluxbase.url = 'https://your-project.fluxbase.eu'
// config.fluxbase.serviceRoleKey = 'your-service-role-key'
```

## 🔧 Environment Variables

### Fluxbase URL Configuration

There are two Fluxbase URL environment variables:

| Variable                   | Purpose                                | Usage                                      |
| -------------------------- | -------------------------------------- | ------------------------------------------ |
| `FLUXBASE_PUBLIC_BASE_URL` | Public URL accessible from browsers    | Client-side code, browser requests         |
| `FLUXBASE_BASE_URL`        | Internal URL for cluster communication | Server-side, workers, edge functions, jobs |

In Kubernetes deployments, `FLUXBASE_BASE_URL` typically points to an internal service (e.g., `http://fluxbase:8080`) while `FLUXBASE_PUBLIC_BASE_URL` points to the external ingress URL (e.g., `https://flux.your-domain.com`).

### Public Variables (Client-Safe)

```env
FLUXBASE_PUBLIC_BASE_URL=https://flux.your-domain.com
PUBLIC_FLUXBASE_ANON_KEY=your-anon-key
NODE_ENV=development
```

### Private Variables (Server-Only)

```env
FLUXBASE_BASE_URL=http://fluxbase:8080
FLUXBASE_SERVICE_ROLE_KEY=your-service-role-key
JWT_SECRET=your-jwt-secret
SESSION_SECRET=your-session-secret
COOKIE_SECRET=your-cookie-secret
```

### Worker Variables (Node.js)

```env
WORKER_POLL_INTERVAL=5000
JOB_TIMEOUT=300000
RETRY_ATTEMPTS=3
RETRY_DELAY=1000
```

## 🧪 Testing

### Environment Variable Testing

```typescript
// tests/unit/config.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateServerEnvironmentConfig } from '$lib/core/config/server-environment';

describe('Server Environment Config', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		vi.resetModules();
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it('should validate required environment variables', () => {
		process.env.FLUXBASE_PUBLIC_BASE_URL = 'https://test.fluxbase.eu';
		process.env.FLUXBASE_SERVICE_ROLE_KEY = 'test-service-key';

		const config = validateServerEnvironmentConfig(true);
		expect(config.fluxbase.url).toBe('https://test.fluxbase.eu');
		expect(config.fluxbase.serviceRoleKey).toBe('test-service-key');
	});
});
```

## 🚨 Common Issues

### Build Errors

If you see build errors like:

```
Error: Cannot import '$env/static/private' in client-side code
```

**Solution**: Move the import to a server-side file or use the appropriate client-safe config.

### Runtime Errors

If you see runtime errors like:

```
ReferenceError: process is not defined
```

**Solution**: Use SvelteKit's `$env/static/*` imports instead of `process.env` in SvelteKit code.

### Security Warnings

If you see security warnings like:

```
Warning: Sensitive environment variable exposed to client
```

**Solution**: Ensure you're using the correct config file for your context.

## 📚 Related Documentation

- [SvelteKit Environment Variables](https://kit.svelte.dev/docs/modules#$env-static-private)
- [Fluxbase Environment Setup](https://fluxbase.eu/docs/guides/getting-started/environment-variables)
- [Node.js Environment Variables](https://nodejs.org/api/process.html#processenv)

## 🔄 Migration Guide

### From Direct Environment Imports

```typescript
// ❌ Old way
import { FLUXBASE_PUBLIC_BASE_URL } from '$env/static/public';
import { FLUXBASE_SERVICE_ROLE_KEY } from '$env/static/private';

// ✅ New way
import { validateServerEnvironmentConfig } from '$lib/core/config/server-environment';
const config = validateServerEnvironmentConfig();
```

### From Process.env in SvelteKit

```typescript
// ❌ Old way
const url = process.env.FLUXBASE_PUBLIC_BASE_URL;

// ✅ New way
import { FLUXBASE_PUBLIC_BASE_URL } from '$lib/fluxbase';
const url = FLUXBASE_PUBLIC_BASE_URL;
```

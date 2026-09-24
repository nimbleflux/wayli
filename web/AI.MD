# AI.MD - Wayli Project Guidelines

## 🎯 Project Overview

Wayli is a privacy-first, open-source location tracking and trip management application built with SvelteKit and Fluxbase. This document provides comprehensive guidelines for AI-assisted development and project-specific practices.

## 🏗️ Architecture Patterns

### Service Layer Architecture

- **Location**: `src/lib/architecture/service-layer.ts`
- **Pattern**: Dependency injection with service container
- **Usage**: All business logic should be in service classes
- **Benefits**: Testability, reusability, separation of concerns

### API Layer Architecture

- **Location**: `src/lib/utils/api/`
- **Pattern**: Standardized API handlers with consistent error handling and validation
- **Components**:
  - `response.ts`: Standardized response utilities
  - `schemas.ts`: Zod validation schemas for API inputs
- **Benefits**: Consistent API responses, automatic validation, error handling

### Environment Configuration

- **Client**: `src/lib/environment.ts` (browser, injected at runtime)
- **Shared**: `src/shared/environment.ts` and `src/shared/config/environment.ts` (shared client config)
- **Note**: Wayli is a client-side SvelteKit app — all server-side work (auth, queries, jobs, edge functions) is handled by Fluxbase
- **Benefits**: Security, type safety, clear dependency boundaries

### Error Handling

- **Location**: `src/lib/services/error-handler.service.ts`
- **Pattern**: Centralized error handling with structured error codes
- **Usage**: Use `errorHandler.createError()` for all application errors
- **Benefits**: Consistent error responses, proper logging, debugging

### Validation

- **Location**: `src/lib/schemas/` and `src/lib/utils/api/schemas.ts`
- **Pattern**: Zod schemas for all data validation
- **Usage**: Use `validateWithSchema()` for API input validation
- **Benefits**: Type safety, clear error messages, API documentation

### Accessibility (A11y)

- **Location**: `src/lib/accessibility/`
- **Pattern**: Reusable accessibility utilities and actions
- **Components**:
  - `aria-button.ts`: `useAriaButton` action for accessible interactive elements
  - UI components with built-in accessibility features
- **Usage**: Use `useAriaButton` for custom interactive elements
- **Benefits**: WCAG 2.1 AA compliance, keyboard navigation, screen reader support

## 🔧 Development Guidelines

### File Organization

```
src/
├── lib/
│   ├── accessibility/       # Accessibility utilities and actions
│   ├── components/          # Reusable UI components
│   ├── core/
│   │   └── config/          # Environment configuration docs (README.md)
│   ├── rules/               # Trip/transport detection rules
│   ├── schemas/             # Zod validation schemas
│   ├── services/            # Business logic services (kebab-case, e.g. trips.service.ts)
│   ├── stores/              # Svelte stores
│   ├── types/               # TypeScript type definitions
│   └── utils/
│       └── api/             # API utilities and patterns
├── shared/                  # Shared config, environment, and types
├── routes/
│   ├── (user)/              # Protected user routes
│   ├── api/                 # API endpoints (link-preview only; not served in production)
│   └── auth/                # Auth routes (signin, signup, 2FA)
├── tests/                   # Test suite
│   ├── unit/                # Unit tests (incl. accessibility-aria-button.test.ts)
│   ├── components/          # Component tests
│   ├── integration/         # Integration tests
│   └── e2e/                 # End-to-end tests (Playwright)
├── static/                  # Static assets
├── docker-entrypoint.sh    # Container entrypoint (runs startup.sh)
└── nginx.conf              # Nginx configuration for production
```

### Naming Conventions

- **Files**: kebab-case (e.g., `user-profile.service.ts`)
- **Components**: PascalCase (e.g., `UserProfile.svelte`)
- **Services**: PascalCase with Service suffix (e.g., `UserProfileService`)
- **Types**: PascalCase (e.g., `UserProfile`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_RETRY_ATTEMPTS`)
- **API Endpoints**: RESTful naming (e.g., `/api/v1/users`)

### Code Style

- Use TypeScript strict mode
- Prefer functional components over class-based
- Use async/await for all asynchronous operations
- Handle errors gracefully with try/catch blocks
- Add JSDoc comments for complex functions
- Use descriptive variable and function names
- Follow accessibility best practices

## 🛡️ Security Practices

### Authentication & Authorization

- Always validate user authentication in protected routes
- Use RLS policies for database access control
- Implement proper session management
- Use environment variables for sensitive configuration
- Remember role assignment is server-side (ensure_user_profile RPC) — never trust client-sent roles

### Input Validation

- Validate all user input with Zod schemas
- Sanitize data before database operations
- Use parameterized queries to prevent SQL injection
- Implement rate limiting for API endpoints
- Use the new API validation schemas for consistency

### Error Handling

- Never expose sensitive information in error messages
- Log errors with appropriate context
- Use structured error codes for consistent handling
- Implement graceful degradation for failures
- Use the new API response utilities for consistent error responses

### Environment Security

- **NEVER** import `$env/static/private` in client-side code
- **NEVER** import server-only config in client components
- Use the appropriate environment config for each context
- Validate environment variables at startup

## 🚀 Performance Guidelines

### Database Optimization

- Use proper indexing for frequently queried columns
- Implement caching for expensive operations
- Use query batching for multiple operations
- Monitor query performance and optimize slow queries

### Bundle Optimization

- Use lazy loading for heavy components
- Implement code splitting for routes
- Optimize imports to reduce bundle size
- Use the bundle optimizer utilities for dynamic imports

### API Performance

- Use the new API response utilities for consistent performance
- Implement proper pagination for large datasets
- Use caching headers appropriately
- Monitor API response times

## 🧪 Testing Strategy

### Test Categories

Coverage thresholds are advisory goals — CI runs coverage report-only and does not fail on them.

- **Unit Tests**: Business logic, utilities, services (goal: 85%+)
- **Component Tests**: UI components, user interactions
- **Accessibility Tests**: ARIA attributes, keyboard navigation (see `tests/unit/accessibility-aria-button.test.ts`)
- **Integration Tests**: API endpoints, service integration

### Testing Patterns

- Use Vitest as the testing framework
- Follow AAA (Arrange-Act-Assert) pattern
- Use descriptive test names
- Test both success and error scenarios
- Mock external dependencies appropriately

### Accessibility Testing

- Test ARIA attributes and roles
- Verify keyboard navigation
- Test screen reader compatibility
- Validate focus management
- Check color contrast ratios

## 🔄 API Development Patterns

Wayli is client-side first: data access goes through the Fluxbase client SDK with RLS, not custom API routes. The only SvelteKit endpoint is `src/routes/api/link-preview/`, and it is NOT served in production (adapter-static build + nginx `try_files`).

### Conventions for API routes

1. **Use response utilities** (`$lib/utils/api/response`):

```typescript
import { successResponse, errorResponse } from '$lib/utils/api/response';

return successResponse(data, 200);
return errorResponse(error, 500);
```

2. **Use validation schemas** (`$lib/utils/api/schemas`):

```typescript
import { paginationSchema } from '$lib/utils/api/schemas';
// Zod schemas for query/body validation
```

3. **Extract business logic to the service layer** (`src/lib/services/*.service.ts`)
4. **Write tests** in `tests/unit/` or `tests/integration/`

### API Response Format

All API responses follow this structure:

```typescript
{
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code: string;
    details?: unknown;
  };
  meta?: {
    timestamp: string;
    requestId?: string;
  };
}
```

## ♿ Accessibility Guidelines

### Interactive Elements

- Use `useAriaButton` action for custom interactive elements
- Ensure all interactive elements are keyboard accessible
- Provide proper ARIA labels and descriptions
- Test with screen readers

### Form Accessibility

- Associate labels with form controls using `for` and `id`
- Provide error messages with proper ARIA attributes
- Use semantic HTML elements
- Ensure proper focus management

### Keyboard Navigation

- Support Tab navigation
- Handle Enter and Space keys for activation
- Provide visible focus indicators
- Implement logical tab order

### Screen Reader Support

- Use semantic HTML structure
- Provide alternative text for images
- Use proper heading hierarchy
- Test with actual screen readers

## 🌍 Environment Configuration

### Client Configuration

```typescript
// src/lib/environment.ts
// Browser-side runtime configuration (values injected into the HTML at
// container startup: FLUXBASE_PUBLIC_BASE_URL, FLUXBASE_ANON_KEY)
```

### Shared Configuration

```typescript
// src/shared/environment.ts, src/shared/config/environment.ts
// Configuration shared across client modules
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

**Production Deployment**: The Docker container uses nginx to serve the static SvelteKit build (adapter-static), with `startup.sh` templating runtime env vars into the HTML and syncing Fluxbase resources.

**Docker Architecture**: Multi-stage build (`deno-bin`, `builder`, `production`) at the repo root — nginx serves static files; there is no separate worker stage.

### Docker Configuration

**Multi-Stage Architecture** (root `Dockerfile`):

- **`deno-bin` stage**: provides the Deno binary used by Fluxbase edge functions
- **`builder` stage**: Bun installs dependencies and builds the SvelteKit application
- **`production` stage**: debian-slim with nginx, serving the static build on port 80 (configurable via `PORT`)

**Entrypoint Script**: `docker-entrypoint.sh` simply executes `startup.sh`, which:

- Configures nginx at runtime (CSP domain, port, health endpoint)
- Injects environment variables into the built HTML (`FLUXBASE_PUBLIC_BASE_URL`, `FLUXBASE_ANON_KEY`/`PUBLIC_FLUXBASE_ANON_KEY`)
- Syncs Fluxbase resources (rpc, functions, jobs, chatbots, schema) unless `SKIP_SYNC=true`
- Requires `FLUXBASE_BASE_URL` and `FLUXBASE_SERVICE_ROLE_KEY` when sync is enabled

**Best Practices**:

- Use nginx for static file serving (much more efficient than Node.js)
- Validate environment variables in startup scripts
- Provide clear error messages and debugging information
- Use non-root users for security

## 📚 Documentation Standards

### Code Comments

- Add JSDoc comments for all public functions
- Include parameter and return type documentation
- Document complex business logic
- Add examples for non-obvious usage

### API Documentation

- Document all API endpoints
- Include request/response examples
- Document error codes and messages
- Keep documentation up to date with code changes
- Use the API documentation in `src/lib/utils/api/README.md`

### Component Documentation

- Document component props and events
- Include usage examples
- Document accessibility features
- Add performance considerations

### Project Documentation

- **AI.MD**: Comprehensive development guidelines (this file)
- **README.md**: Project overview and quick start guide
- **CONTRIBUTING.md**: Detailed contribution guidelines
- **CODE_OF_CONDUCT.md**: Community behavior standards
- **API Documentation**: `src/lib/utils/api/README.md`
- **Environment Guide**: `src/lib/core/config/README.md`
- **Testing Guide**: `tests/README.md`

## 🔄 Migration Guidelines

### API Endpoint Migration

When touching SvelteKit API endpoints (only `api/link-preview` exists today — prefer Fluxbase RPCs and edge functions for new server logic):

1. Use the response utilities for consistent responses
2. Add Zod validation schemas
3. Extract business logic to service layer
4. Update error handling
5. Add comprehensive tests

### Component Migration

When migrating components for accessibility:

1. Add proper ARIA attributes
2. Implement keyboard navigation
3. Use `useAriaButton` for custom interactive elements
4. Test with screen readers
5. Add accessibility tests

### Environment Migration

When updating environment configuration:

1. Identify client vs server usage
2. Move to appropriate config file
3. Add validation for required variables
4. Update imports across the codebase
5. Test in different environments

## 🚨 Common Pitfalls

### Security Issues

- ❌ Importing server config in client code
- ❌ Exposing sensitive data in error messages
- ❌ Not validating user input
- ❌ Missing authentication checks

### Performance Issues

- ❌ Not using lazy loading for heavy components
- ❌ Missing database indexes
- ❌ Not implementing proper caching
- ❌ Large bundle sizes

### Accessibility Issues

- ❌ Missing ARIA attributes
- ❌ Not supporting keyboard navigation
- ❌ Poor color contrast
- ❌ Missing alternative text

### Testing Issues

- ❌ Not testing error scenarios
- ❌ Missing accessibility tests
- ❌ Not mocking external dependencies
- ❌ Incomplete test coverage

## 📖 Resources

- [SvelteKit Documentation](https://kit.svelte.dev/)
- [Fluxbase Documentation](https://fluxbase.eu/docs)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [Vitest Testing Framework](https://vitest.dev/)
- [Zod Validation](https://zod.dev/)
- [Testing Library](https://testing-library.com/)

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

- **Server-only**: `src/lib/core/config/server-environment.ts` (private variables)
- **Worker**: `src/lib/core/config/worker-environment.ts` (process.env)
- **Pattern**: Clear separation between server and worker environments
- **Benefits**: Security, type safety, clear dependency boundaries

### Error Handling

- **Location**: `src/lib/services/error-handler.service.ts`
- **Pattern**: Centralized error handling with structured error codes
- **Usage**: Use `errorHandler.createError()` for all application errors
- **Benefits**: Consistent error responses, proper logging, debugging

### Validation

- **Location**: `src/lib/validation/schemas.ts` and `src/lib/utils/api/schemas.ts`
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
│   │   ├── config/          # Environment configuration
│   │   └── fluxbase/        # Fluxbase clients
│   ├── services/           # Business logic services
│   ├── stores/             # Svelte stores
│   ├── types/              # TypeScript type definitions
│   ├── utils/
│   │   ├── api/            # API utilities and patterns
│   │   └── ...             # Other utilities
│   ├── validation/         # Zod validation schemas
│   ├── middleware/         # Request middleware
│   └── ...                 # Other modules
├── routes/
│   ├── (user)/             # Protected user routes
│   ├── api/                # API endpoints
│   └── setup/              # Initial setup flow
├── tests/                  # Test suite
│   ├── unit/               # Unit tests
│   ├── components/         # Component tests
│   ├── integration/        # Integration tests
│   └── accessibility/      # Accessibility tests
├── static/                 # Static assets
├── docker-entrypoint.sh    # Docker container entrypoint script
├── nginx.conf             # Nginx configuration for production
└── test-container.sh       # Docker container testing script
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
- Use the new API base handler for consistent auth patterns

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

- **Unit Tests**: Business logic, utilities, services (90%+ coverage)
- **Component Tests**: UI components, user interactions (80%+ coverage)
- **Accessibility Tests**: ARIA attributes, keyboard navigation (100% coverage)
- **Integration Tests**: API endpoints, service integration (85%+ coverage)

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

### Creating New API Endpoints

1. **Use the base handler pattern**:

```typescript
export const GET: RequestHandler = createGetHandler(
	async (context) => {
		// Business logic here
		return { data: result };
	},
	{
		requireAuthentication: true,
		validateQuery: paginationSchema
	}
);
```

2. **Use validation schemas**:

```typescript
import { createTripSchema } from '$lib/utils/api/schemas';

export const POST: RequestHandler = createPostHandler(
	async (context) => {
		const { body } = context;
		// body is already validated
		return { trip: result };
	},
	{
		validateBody: createTripSchema
	}
);
```

3. **Use response utilities**:

```typescript
import { successResponse, errorResponse } from '$lib/utils/api/response';

// Success
return successResponse(data, 201);

// Error
throw new Error('Resource not found');
// Base handler will convert to appropriate response
```

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

### Server-Side Configuration

```typescript
// src/lib/core/config/server-environment.ts
// Server-only variables from $env/static/private
export function validateServerEnvironment() {
	// Validate required environment variables
}
```

### Worker Configuration

```typescript
// src/lib/core/config/worker-environment.ts
// Worker-specific variables using process.env
export function validateWorkerEnvironment() {
	// Validate worker environment
}
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

**Production Deployment**: The Docker container uses nginx to serve static files instead of running a Node.js server, which is much more efficient and production-ready.

**Docker Architecture**: Multi-stage build with nginx for web serving and Node.js for background workers.

### Docker Configuration

**Multi-Stage Architecture**:

- **`web` stage**: nginx serving static files (port 80)
- **`worker` stage**: Node.js for background processing
- **`builder` stage**: Builds the SvelteKit application

**Entrypoint Script**: `docker-entrypoint.sh`

- Handles worker modes (worker, workers)
- Provides comprehensive debugging and error handling
- Validates APP_MODE environment variable
- Note: Web mode uses nginx directly

**Container Modes**:

- `APP_MODE=web`: Use nginx stage (static file serving)
- `APP_MODE=worker`: Background worker process
- `APP_MODE=workers`: Worker manager process

**Best Practices**:

- Use nginx for static file serving (much more efficient than Node.js)
- Separate concerns: web serving vs background processing
- Validate environment variables in entrypoint scripts
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

When migrating existing API endpoints to the new patterns:

1. Replace manual authentication with base handler
2. Add Zod validation schemas
3. Use response utility functions
4. Extract business logic to service layer
5. Update error handling
6. Add comprehensive tests

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

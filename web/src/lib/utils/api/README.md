# API Layer Refactor Documentation

## Overview

This document outlines the standardized patterns for API endpoints in the Wayli application. The refactor introduces consistent error handling, validation, authentication, and response shapes across all API endpoints.

## Key Components

### 1. Response Utilities (`response.ts`)

Standardized response functions for consistent API responses:

```typescript
import {
	successResponse,
	errorResponse,
	validationErrorResponse,
	notFoundResponse,
	conflictResponse,
	serverErrorResponse
} from '$lib/utils/api/response';

// Success response
return successResponse(data, 200);

// Error responses
return errorResponse(error, 500);
return validationErrorResponse('Invalid input', { field: 'email' });
return notFoundResponse('User not found');
return conflictResponse('Email already exists');
return serverErrorResponse('Database connection failed');
```

### 2. Base API Handler (`base-handler.ts`)

Abstract base class for standardized API endpoint patterns:

```typescript
import { BaseApiHandler, type ApiContext } from '$lib/utils/api/base-handler';

class MyApiHandler extends BaseApiHandler {
	constructor() {
		super({
			requireAuthentication: true,
			requiredRole: 'admin',
			validateBody: mySchema,
			validateQuery: querySchema,
			validateParams: paramSchema
		});
	}

	protected async execute(context: ApiContext): Promise<unknown> {
		// Business logic here
		return result;
	}
}
```

### 3. Helper Functions

Simple helper functions for common patterns:

```typescript
import { createGetHandler, createPostHandler } from '$lib/utils/api/base-handler';

// GET handler
export const GET: RequestHandler = createGetHandler(
	async (context) => {
		// Handler logic
		return data;
	},
	{
		requireAuthentication: true,
		validateQuery: paginationSchema
	}
);

// POST handler
export const POST: RequestHandler = createPostHandler(
	async (context) => {
		// Handler logic
		return result;
	},
	{
		requireAuthentication: true,
		validateBody: createSchema
	}
);
```

### 4. Validation Schemas (`schemas.ts`)

Pre-defined Zod schemas for common validation patterns:

```typescript
import {
  paginationSchema,
  createJobSchema,
  createTripSchema
} from '$lib/utils/api/schemas';

// Use in handlers
{
  validateQuery: paginationSchema,
  validateBody: createJobSchema
}
```

## Migration Guide

### Before (Old Pattern)

```typescript
export const GET: RequestHandler = async ({ locals }) => {
	try {
		const session = await locals.getSession();
		if (!session?.user) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const { data, error } = await locals.fluxbase.from('table').select('*');

		if (error) {
			return json({ error: error.message }, { status: 500 });
		}

		return json({ data });
	} catch (error) {
		return json({ error: 'Server error' }, { status: 500 });
	}
};
```

### After (New Pattern)

```typescript
export const GET: RequestHandler = createGetHandler(
	async (context) => {
		const { user, fluxbase } = context;

		const { data, error } = await fluxbase.from('table').select('*').eq('user_id', user!.id);

		if (error) throw error;

		return { data };
	},
	{
		requireAuthentication: true
	}
);
```

## Best Practices

### 1. Authentication

- Always use `requireAuthentication: true` for protected endpoints
- Use `requiredRole` for role-based access control
- Let the base handler manage authentication logic

### 2. Validation

- Use Zod schemas for all input validation
- Validate body, query parameters, and path parameters
- Provide meaningful error messages

### 3. Error Handling

- Throw errors instead of returning error responses
- Let the base handler convert errors to appropriate responses
- Use specific error types for different scenarios

### 4. Service Layer

- Extract business logic to service classes
- Keep API handlers thin and focused on HTTP concerns
- Use dependency injection for services

### 5. Response Consistency

- Always use the response utility functions
- Maintain consistent response shapes
- Include appropriate HTTP status codes

## Common Patterns

### Pagination

```typescript
export const GET: RequestHandler = createGetHandler(
	async (context) => {
		const { query } = context;
		const { page, limit, search } = query as { page: number; limit: number; search?: string };

		// Business logic with pagination
		return {
			data: results,
			pagination: {
				page,
				limit,
				total,
				totalPages: Math.ceil(total / limit),
				hasNext: page * limit < total,
				hasPrev: page > 1
			}
		};
	},
	{
		validateQuery: paginationSchema
	}
);
```

### CRUD Operations

```typescript
// Create
export const POST: RequestHandler = createPostHandler(
	async (context) => {
		const { user, body } = context;
		const result = await service.create(body, user!.id);
		return { item: result };
	},
	{
		validateBody: createSchema
	}
);

// Read
export const GET: RequestHandler = createGetHandler(
	async (context) => {
		const { user, params } = context;
		const { id } = params as { id: string };
		const item = await service.getById(id, user!.id);
		if (!item) throw new Error('Not found');
		return { item };
	},
	{
		validateParams: idParamSchema
	}
);

// Update
export const PUT: RequestHandler = createPostHandler(
	async (context) => {
		const { user, body, params } = context;
		const { id } = params as { id: string };
		const result = await service.update(id, body, user!.id);
		return { item: result };
	},
	{
		validateBody: updateSchema,
		validateParams: idParamSchema
	}
);

// Delete
export const DELETE: RequestHandler = createGetHandler(
	async (context) => {
		const { user, params } = context;
		const { id } = params as { id: string };
		await service.delete(id, user!.id);
		return { message: 'Deleted successfully' };
	},
	{
		validateParams: idParamSchema
	}
);
```

## Error Types

The base handler automatically converts different error types to appropriate responses:

- `Error` with "not found" in message → 404 Not Found
- `Error` with "conflict" or "already exists" → 409 Conflict
- `Error` with "validation" or "invalid" → 400 Bad Request
- `Response` objects → Returned as-is
- Other errors → 500 Internal Server Error

## Testing

When testing API endpoints:

1. Test authentication requirements
2. Test validation rules
3. Test error scenarios
4. Test successful responses
5. Test service layer integration

## Migration Checklist

For each API endpoint to refactor:

- [ ] Replace manual authentication with base handler
- [ ] Add Zod validation schemas
- [ ] Extract business logic to service layer
- [ ] Use response utility functions
- [ ] Update error handling
- [ ] Add TypeScript types
- [ ] Update tests
- [ ] Update documentation

## Examples

See the following files for complete examples:

- `web/src/routes/api/v1/jobs/+server.ts` (original)
- `web/src/routes/api/v1/trips/+server.ts` (partially refactored)
- `web/src/routes/api/v1/auth/profile/+server.ts` (good pattern)

## Next Steps

1. **Immediate**: Refactor high-priority endpoints (jobs, trips, auth)
2. **Short-term**: Create missing service layer methods
3. **Medium-term**: Add comprehensive validation schemas
4. **Long-term**: Implement API versioning strategy

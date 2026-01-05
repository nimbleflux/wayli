# API Layer Documentation

## Overview

This document outlines the standardized patterns for API endpoints in the Wayli application.

## Key Components

### Response Utilities (`response.ts`)

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

### Validation Schemas (`schemas.ts`)

Pre-defined Zod schemas for common validation patterns:

```typescript
import { paginationSchema, createJobSchema, createTripSchema } from '$lib/utils/api/schemas';
```

## Best Practices

### 1. Authentication

- Use the auth middleware for protected endpoints
- Use role-based access control where appropriate

### 2. Validation

- Use Zod schemas for all input validation
- Validate body, query parameters, and path parameters
- Provide meaningful error messages

### 3. Error Handling

- Use specific error types for different scenarios
- Log errors appropriately for debugging

### 4. Service Layer

- Extract business logic to service classes
- Keep API handlers thin and focused on HTTP concerns
- Use dependency injection for services

### 5. Response Consistency

- Always use the response utility functions
- Maintain consistent response shapes
- Include appropriate HTTP status codes

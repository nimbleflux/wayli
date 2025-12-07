// src/lib/utils/api/base-handler.ts
// Base API handler class for standardized API endpoint patterns

import { createClient } from '@fluxbase/sdk';
import { config } from '../../config';
import { z } from 'zod';

import {
	requireAuth,
	requireRole,
	type AuthenticatedRequest
} from '$lib/middleware/auth.middleware';

import {
	successResponse,
	validationErrorResponse,
	notFoundResponse,
	conflictResponse,
	serverErrorResponse
} from './response';

import type { RequestEvent } from '@sveltejs/kit';

export interface ApiHandlerOptions {
	requireAuthentication?: boolean;
	requiredRole?: string | string[];
	validateBody?: z.ZodSchema;
	validateQuery?: z.ZodSchema;
	validateParams?: z.ZodSchema;
}

export interface ApiContext {
	event: RequestEvent | AuthenticatedRequest;
	user?: {
		id: string;
		email: string;
		role: string;
		metadata: Record<string, unknown>;
	};
	fluxbase: ReturnType<typeof createClient>;
	body?: unknown;
	query?: Record<string, string>;
	params?: Record<string, string>;
}

/**
 * Base API handler class for standardized endpoint patterns
 */
export abstract class BaseApiHandler {
	protected options: ApiHandlerOptions;

	constructor(options: ApiHandlerOptions = {}) {
		this.options = {
			requireAuthentication: true,
			...options
		};
	}

	/**
	 * Main handler method that orchestrates the request processing
	 */
	async handle(event: RequestEvent): Promise<Response> {
		try {
			// Step 1: Authentication
			const authenticatedEvent = await this.authenticate(event);

			// Step 2: Validation
			const context = await this.validate(authenticatedEvent);

			// Step 3: Business logic
			const result = await this.execute(context);

			// Step 4: Response
			return successResponse(result);
		} catch (error) {
			return this.handleError(error);
		}
	}

	/**
	 * Handle authentication based on options
	 */
	private async authenticate(event: RequestEvent): Promise<RequestEvent | AuthenticatedRequest> {
		if (!this.options.requireAuthentication) {
			return event;
		}

		if (this.options.requiredRole) {
			return requireRole(event, this.options.requiredRole);
		}

		return requireAuth(event);
	}

	/**
	 * Validate request data based on options
	 */
	private async validate(event: RequestEvent | AuthenticatedRequest): Promise<ApiContext> {
		const context: ApiContext = {
			event,
			fluxbase: createClient(config.fluxbaseUrl, config.fluxbaseServiceKey)
		};

		// Add user if authenticated
		if ('user' in event) {
			context.user = event.user;
		}

		// Validate body
		if (this.options.validateBody) {
			try {
				const body = await event.request.json();
				context.body = this.options.validateBody.parse(body);
			} catch (error) {
				if (error instanceof z.ZodError) {
					throw validationErrorResponse('Invalid request body', {
						errors: error.issues
					});
				}
				throw validationErrorResponse('Invalid JSON in request body');
			}
		}

		// Validate query parameters
		if (this.options.validateQuery) {
			const query = Object.fromEntries(event.url.searchParams.entries());
			try {
				context.query = this.options.validateQuery.parse(query) as Record<string, string>;
			} catch (error) {
				if (error instanceof z.ZodError) {
					throw validationErrorResponse('Invalid query parameters', {
						errors: error.issues
					});
				}
			}
		}

		// Validate path parameters
		if (this.options.validateParams) {
			const params = event.params || {};
			try {
				context.params = this.options.validateParams.parse(params) as Record<string, string>;
			} catch (error) {
				if (error instanceof z.ZodError) {
					throw validationErrorResponse('Invalid path parameters', {
						errors: error.issues
					});
				}
			}
		}

		return context;
	}

	/**
	 * Execute the business logic - to be implemented by subclasses
	 */
	protected abstract execute(context: ApiContext): Promise<unknown>;

	/**
	 * Handle errors and return appropriate responses
	 */
	private handleError(error: unknown): Response {
		console.error('❌ [API] Error in handler:', error);

		// Handle validation errors
		if (error instanceof Response) {
			return error;
		}

		// Handle known error types
		if (error instanceof Error) {
			const message = error.message.toLowerCase();

			if (message.includes('not found') || message.includes('not found')) {
				return notFoundResponse(error.message);
			}

			if (message.includes('conflict') || message.includes('already exists')) {
				return conflictResponse(error.message);
			}

			if (message.includes('validation') || message.includes('invalid')) {
				return validationErrorResponse(error.message);
			}
		}

		// Default to server error
		return serverErrorResponse(
			error instanceof Error ? error.message : 'An unexpected error occurred'
		);
	}

	/**
	 * Helper method to create a handler function
	 */
	static createHandler<T extends BaseApiHandler>(
		HandlerClass: new (options?: ApiHandlerOptions) => T,
		options?: ApiHandlerOptions
	) {
		const handler = new HandlerClass(options);
		return (event: RequestEvent) => handler.handle(event);
	}
}

/**
 * Helper function to create a simple GET handler
 */
export function createGetHandler(
	handler: (context: ApiContext) => Promise<unknown>,
	options?: ApiHandlerOptions
) {
	return BaseApiHandler.createHandler(
		class extends BaseApiHandler {
			protected async execute(context: ApiContext): Promise<unknown> {
				return handler(context);
			}
		},
		options
	);
}

/**
 * Helper function to create a simple POST handler
 */
export function createPostHandler(
	handler: (context: ApiContext) => Promise<unknown>,
	options?: ApiHandlerOptions
) {
	return BaseApiHandler.createHandler(
		class extends BaseApiHandler {
			protected async execute(context: ApiContext): Promise<unknown> {
				return handler(context);
			}
		},
		options
	);
}

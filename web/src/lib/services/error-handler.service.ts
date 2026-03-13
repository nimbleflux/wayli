/**
 * Error Handler Service
 *
 * Provides centralized error handling with structured error codes, logging,
 * and consistent error responses across the application.
 *
 * @file src/lib/services/error-handler.service.ts
 * @author Wayli Development Team
 * @version 1.0.0
 */

import type { FluxbaseClient } from '@nimbleflux/fluxbase-sdk';

/**
 * Application error codes for consistent error handling
 */
export enum ErrorCode {
	// Authentication errors
	AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
	INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
	SESSION_EXPIRED = 'SESSION_EXPIRED',
	INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',

	// Validation errors
	VALIDATION_ERROR = 'VALIDATION_ERROR',
	INVALID_INPUT = 'INVALID_INPUT',
	MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',

	// Database errors
	DATABASE_ERROR = 'DATABASE_ERROR',
	RECORD_NOT_FOUND = 'RECORD_NOT_FOUND',
	DUPLICATE_RECORD = 'DUPLICATE_RECORD',
	FOREIGN_KEY_VIOLATION = 'FOREIGN_KEY_VIOLATION',

	// External service errors
	EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
	GEOCODING_ERROR = 'GEOCODING_ERROR',
	FILE_UPLOAD_ERROR = 'FILE_UPLOAD_ERROR',
	EMAIL_SEND_ERROR = 'EMAIL_SEND_ERROR',

	// Rate limiting
	RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',

	// Job processing errors
	JOB_PROCESSING_ERROR = 'JOB_PROCESSING_ERROR',
	JOB_NOT_FOUND = 'JOB_NOT_FOUND',
	JOB_ALREADY_RUNNING = 'JOB_ALREADY_RUNNING',

	// General errors
	INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
	NOT_FOUND = 'NOT_FOUND',
	BAD_REQUEST = 'BAD_REQUEST',
	UNAUTHORIZED = 'UNAUTHORIZED',
	FORBIDDEN = 'FORBIDDEN',

	// Conflict errors
	CONFLICT_ERROR = 'CONFLICT_ERROR'
}

export interface AppError extends Error {
	code: ErrorCode;
	statusCode: number;
	details?: unknown;
	context?: Record<string, unknown>;
	isOperational: boolean;
}

export interface ErrorLogEntry {
	timestamp: string;
	level: 'error' | 'warn' | 'info';
	code: ErrorCode;
	message: string;
	stack?: string;
	context?: Record<string, unknown>;
	userId?: string;
	requestId?: string;
	userAgent?: string;
	ip?: string;
}

class ErrorHandlerService {
	private fluxbase: FluxbaseClient | null = null;
	private isDevelopment = process.env.NODE_ENV === 'development';

	setFluxbaseClient(client: FluxbaseClient) {
		this.fluxbase = client;
	}

	/**
	 * Creates a structured application error with consistent formatting
	 *
	 * @param code - The error code from the ErrorCode enum
	 * @param message - Human-readable error message
	 * @param statusCode - HTTP status code (default: 500)
	 * @param details - Additional error details for debugging
	 * @param context - Context information about the error
	 * @returns AppError instance with structured error information
	 *
	 * @example
	 * ```typescript
	 * const error = errorHandler.createError(
	 *   ErrorCode.VALIDATION_ERROR,
	 *   'Invalid email format',
	 *   400,
	 *   { field: 'email', value: 'invalid-email' }
	 * );
	 * ```
	 */
	createError(
		code: ErrorCode,
		message: string,
		statusCode: number = 500,
		details?: unknown,
		context?: Record<string, unknown>
	): AppError {
		const error = new Error(message) as AppError;
		error.code = code;
		error.statusCode = statusCode;
		error.details = details;
		error.context = context;
		error.isOperational = this.isOperationalError(code);
		return error;
	}

	private isOperationalError(code: ErrorCode): boolean {
		// Operational errors are expected and don't indicate a bug
		const operationalErrors = [
			ErrorCode.AUTHENTICATION_FAILED,
			ErrorCode.INVALID_CREDENTIALS,
			ErrorCode.SESSION_EXPIRED,
			ErrorCode.INSUFFICIENT_PERMISSIONS,
			ErrorCode.VALIDATION_ERROR,
			ErrorCode.INVALID_INPUT,
			ErrorCode.MISSING_REQUIRED_FIELD,
			ErrorCode.RECORD_NOT_FOUND,
			ErrorCode.DUPLICATE_RECORD,
			ErrorCode.FOREIGN_KEY_VIOLATION,
			ErrorCode.EXTERNAL_SERVICE_ERROR,
			ErrorCode.GEOCODING_ERROR,
			ErrorCode.FILE_UPLOAD_ERROR,
			ErrorCode.EMAIL_SEND_ERROR,
			ErrorCode.RATE_LIMIT_EXCEEDED,
			ErrorCode.JOB_NOT_FOUND,
			ErrorCode.JOB_ALREADY_RUNNING,
			ErrorCode.NOT_FOUND,
			ErrorCode.BAD_REQUEST,
			ErrorCode.UNAUTHORIZED,
			ErrorCode.FORBIDDEN
		];
		return operationalErrors.includes(code);
	}

	async logError(error: AppError, request?: Request, userId?: string): Promise<void> {
		const logEntry: ErrorLogEntry = {
			timestamp: new Date().toISOString(),
			level: error.isOperational ? 'warn' : 'error',
			code: error.code,
			message: error.message,
			stack: error.stack,
			context: error.context,
			userId,
			requestId: request?.headers.get('x-request-id') || undefined,
			userAgent: request?.headers.get('user-agent') || undefined,
			ip: this.extractClientIP(request)
		};

		// Console logging for development
		if (this.isDevelopment) {
			console.error('🚨 Error:', {
				code: logEntry.code,
				message: logEntry.message,
				statusCode: error.statusCode,
				stack: logEntry.stack,
				context: logEntry.context
			});
		}

		// Database logging for production
		if (this.fluxbase && !this.isDevelopment) {
			try {
				await this.fluxbase.from('error_logs').insert({
					timestamp: logEntry.timestamp,
					level: logEntry.level,
					code: logEntry.code,
					message: logEntry.message,
					stack: logEntry.stack,
					context: logEntry.context,
					user_id: logEntry.userId,
					request_id: logEntry.requestId,
					user_agent: logEntry.userAgent,
					ip_address: logEntry.ip
				});
			} catch (dbError) {
				// Fallback to console if database logging fails
				console.error('Failed to log error to database:', dbError);
				console.error('Original error:', logEntry);
			}
		}
	}

	private extractClientIP(request?: Request): string | undefined {
		if (!request) return undefined;

		const forwarded = request.headers.get('x-forwarded-for');
		const realIp = request.headers.get('x-real-ip');
		const cfConnectingIp = request.headers.get('cf-connecting-ip');

		return forwarded?.split(',')[0] || realIp || cfConnectingIp || undefined;
	}

	createErrorResponse(error: AppError, includeDetails: boolean = false): Response {
		const errorObj: Record<string, unknown> = {
			message: error.message,
			code: error.code
		};

		if (includeDetails && error.details) {
			errorObj.details = error.details;
		}

		const responseBody = {
			success: false,
			error: errorObj
		};

		return new Response(JSON.stringify(responseBody), {
			status: error.statusCode,
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': 'no-cache, no-store, must-revalidate'
			}
		});
	}

	handleDatabaseError(error: unknown, context?: Record<string, unknown>): AppError {
		// Handle Fluxbase/PostgreSQL specific errors
		const dbError = error as { code?: string };

		if (dbError.code === '23505') {
			// Unique violation
			return this.createError(
				ErrorCode.DUPLICATE_RECORD,
				'A record with this information already exists',
				409,
				error,
				context
			);
		}

		if (dbError.code === '23503') {
			// Foreign key violation
			return this.createError(
				ErrorCode.FOREIGN_KEY_VIOLATION,
				'Referenced record does not exist',
				400,
				error,
				context
			);
		}

		if (dbError.code === '42P01') {
			// Undefined table
			return this.createError(
				ErrorCode.DATABASE_ERROR,
				'Database table not found',
				500,
				error,
				context
			);
		}

		// Generic database error
		return this.createError(
			ErrorCode.DATABASE_ERROR,
			'Database operation failed',
			500,
			error,
			context
		);
	}

	handleValidationError(
		field: string,
		message: string,
		context?: Record<string, unknown>
	): AppError {
		return this.createError(
			ErrorCode.VALIDATION_ERROR,
			`${field}: ${message}`,
			400,
			{ field, message },
			context
		);
	}

	handleAuthenticationError(
		message: string = 'Authentication failed',
		context?: Record<string, unknown>
	): AppError {
		return this.createError(ErrorCode.AUTHENTICATION_FAILED, message, 401, undefined, context);
	}

	handleAuthorizationError(
		message: string = 'Insufficient permissions',
		context?: Record<string, unknown>
	): AppError {
		return this.createError(ErrorCode.INSUFFICIENT_PERMISSIONS, message, 403, undefined, context);
	}

	handleNotFoundError(resource: string, context?: Record<string, unknown>): AppError {
		return this.createError(
			ErrorCode.RECORD_NOT_FOUND,
			`${resource} not found`,
			404,
			{ resource },
			context
		);
	}

	handleExternalServiceError(
		service: string,
		error: unknown,
		context?: Record<string, unknown>
	): AppError {
		return this.createError(
			ErrorCode.EXTERNAL_SERVICE_ERROR,
			`${service} service is currently unavailable`,
			503,
			error,
			{ service, ...context }
		);
	}

	// Async error handler for API routes
	async handleApiError(error: unknown, request?: Request, userId?: string): Promise<Response> {
		let appError: AppError;

		if (this.isAppError(error)) {
			appError = error;
		} else if (error instanceof Error) {
			appError = this.createError(ErrorCode.INTERNAL_SERVER_ERROR, error.message, 500, error);
		} else {
			appError = this.createError(
				ErrorCode.INTERNAL_SERVER_ERROR,
				'An unexpected error occurred',
				500,
				error
			);
		}

		// Log the error
		await this.logError(appError, request, userId);

		// Return appropriate response
		return this.createErrorResponse(appError, this.isDevelopment);
	}

	private isAppError(error: unknown): error is AppError {
		return error instanceof Error && 'code' in error && 'statusCode' in error;
	}

	isStructuredError(error: unknown): error is AppError {
		return this.isAppError(error);
	}
}

// Export singleton instance
export const errorHandler = new ErrorHandlerService();

// Helper function to wrap API handlers with error handling
export function withErrorHandling<T extends unknown[]>(handler: (...args: T) => Promise<Response>) {
	return async (...args: T): Promise<Response> => {
		try {
			return await handler(...args);
		} catch (error) {
			return errorHandler.handleApiError(error);
		}
	};
}

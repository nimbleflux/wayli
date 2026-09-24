import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { errorHandler, ErrorCode } from '$lib/services/error-handler.service';
import { loggingService, LogLevel } from '$lib/services/logging.service';

describe('Error Handler Service', () => {
	describe('createError', () => {
		it('should create validation errors', () => {
			const error = errorHandler.createError(ErrorCode.VALIDATION_ERROR, 'Validation failed', 400);

			expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
			expect(error.statusCode).toBe(400);
			expect(error.message).toBe('Validation failed');
			expect(error.isOperational).toBe(true);
		});

		it('should create authentication errors', () => {
			const error = errorHandler.createError(
				ErrorCode.AUTHENTICATION_FAILED,
				'Authentication required',
				401
			);

			expect(error.code).toBe(ErrorCode.AUTHENTICATION_FAILED);
			expect(error.statusCode).toBe(401);
			expect(error.message).toBe('Authentication required');
			expect(error.isOperational).toBe(true);
		});

		it('should create authorization errors', () => {
			const error = errorHandler.createError(
				ErrorCode.INSUFFICIENT_PERMISSIONS,
				'Insufficient permissions',
				403
			);

			expect(error.code).toBe(ErrorCode.INSUFFICIENT_PERMISSIONS);
			expect(error.statusCode).toBe(403);
			expect(error.message).toBe('Insufficient permissions');
			expect(error.isOperational).toBe(true);
		});

		it('should create not found errors', () => {
			const error = errorHandler.createError(ErrorCode.RECORD_NOT_FOUND, 'Resource not found', 404);

			expect(error.code).toBe(ErrorCode.RECORD_NOT_FOUND);
			expect(error.statusCode).toBe(404);
			expect(error.message).toBe('Resource not found');
			expect(error.isOperational).toBe(true);
		});

		it('should create rate limit errors', () => {
			const error = errorHandler.createError(
				ErrorCode.RATE_LIMIT_EXCEEDED,
				'Rate limit exceeded',
				429
			);

			expect(error.code).toBe(ErrorCode.RATE_LIMIT_EXCEEDED);
			expect(error.statusCode).toBe(429);
			expect(error.message).toBe('Rate limit exceeded');
			expect(error.isOperational).toBe(true);
		});

		it('should create database errors', () => {
			const error = errorHandler.createError(
				ErrorCode.DATABASE_ERROR,
				'Database connection failed',
				500
			);

			expect(error.code).toBe(ErrorCode.DATABASE_ERROR);
			expect(error.statusCode).toBe(500);
			expect(error.message).toBe('Database connection failed');
			expect(error.isOperational).toBe(false);
		});

		it('should create unknown errors', () => {
			const error = errorHandler.createError(
				ErrorCode.INTERNAL_SERVER_ERROR,
				'Unknown error occurred',
				500
			);

			expect(error.code).toBe(ErrorCode.INTERNAL_SERVER_ERROR);
			expect(error.statusCode).toBe(500);
			expect(error.message).toBe('Unknown error occurred');
			expect(error.isOperational).toBe(false);
		});
	});

	describe('createErrorResponse', () => {
		it('should create a proper error response', () => {
			const error = errorHandler.createError(ErrorCode.VALIDATION_ERROR, 'Test error', 400);
			const response = errorHandler.createErrorResponse(error);

			expect(response.status).toBe(400);
			expect(response.headers.get('Content-Type')).toBe('application/json');
		});

		it('should include error details in response', async () => {
			const error = errorHandler.createError(ErrorCode.VALIDATION_ERROR, 'Test error', 400);
			const response = errorHandler.createErrorResponse(error);
			const data = await response.json();

			expect(data.success).toBe(false);
			expect(data.error).toBeDefined();
			expect(data.error.code).toBe('VALIDATION_ERROR');
			expect(data.error.message).toBe('Test error');
		});

		it('should include additional details when requested', async () => {
			const error = errorHandler.createError(ErrorCode.VALIDATION_ERROR, 'Test error', 400, {
				field: 'email',
				value: 'invalid'
			});
			const response = errorHandler.createErrorResponse(error, true);
			const data = await response.json();

			expect(data.error.details).toBeDefined();
			expect(data.error.details.field).toBe('email');
		});
	});
});

describe('Logging Service', () => {
	beforeEach(() => {
		// Mock console methods
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('log', () => {
		it('should log info messages', async () => {
			await loggingService.log(LogLevel.INFO, 'Test info message');

			expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Test info message'));
		});

		it('should log warning messages', async () => {
			await loggingService.log(LogLevel.WARN, 'Test warning message');

			expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Test warning message'));
		});

		it('should log error messages', async () => {
			await loggingService.log(LogLevel.ERROR, 'Test error message');

			expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Test error message'));
		});

		it('should include metadata in log messages', async () => {
			const metadata = { userId: '123', action: 'test' };
			await loggingService.log(LogLevel.INFO, 'Test message', metadata);

			expect(console.log).toHaveBeenCalledWith(
				expect.stringContaining('Test message'),
				expect.objectContaining(metadata)
			);
		});
	});

	describe('info', () => {
		it('should log info level messages', () => {
			loggingService.info('Test info message');

			expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Test info message'));
		});
	});

	describe('warn', () => {
		it('should log warning level messages', () => {
			loggingService.warn('Test warning message');

			expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Test warning message'));
		});
	});

	describe('error', () => {
		it('should log error level messages', () => {
			loggingService.error('Test error message');

			expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Test error message'));
		});
	});

	describe('debug', () => {
		it('should log debug messages in development', () => {
			const originalEnv = process.env.NODE_ENV;
			process.env.NODE_ENV = 'development';

			loggingService.debug('Test debug message');

			expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Test debug message'));

			process.env.NODE_ENV = originalEnv;
		});

		it('should not log debug messages in production', () => {
			const originalEnv = process.env.NODE_ENV;
			process.env.NODE_ENV = 'production';

			loggingService.debug('Test debug message');

			expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Test debug message'));

			process.env.NODE_ENV = originalEnv;
		});
	});
});

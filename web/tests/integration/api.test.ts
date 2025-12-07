import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
	auditLogger,
	AuditEventType,
	AuditSeverity
} from '../../src/lib/services/audit-logger.service';
import { rateLimitService } from '../../src/lib/services/rate-limit.service';

// Mock external dependencies
vi.mock('../../src/lib/services/audit-logger.service');
vi.mock('../../src/lib/services/rate-limit.service');

describe('Service Integration Tests', () => {
	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks();

		// Mock audit logger
		vi.mocked(auditLogger.logEvent).mockResolvedValue(undefined);
		vi.mocked(auditLogger.logDataAccess).mockResolvedValue(undefined);

		// Mock rate limit service
		vi.mocked(rateLimitService.checkRateLimit).mockReturnValue({ allowed: true });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('Audit Logging', () => {
		it('should log events successfully', async () => {
			const mockRequest = new Request('http://localhost:4000/test');
			await auditLogger.logEvent(
				AuditEventType.DATA_VIEW,
				'Test event description',
				AuditSeverity.LOW,
				{ test: true },
				mockRequest,
				'test_user'
			);

			expect(auditLogger.logEvent).toHaveBeenCalledWith(
				AuditEventType.DATA_VIEW,
				'Test event description',
				AuditSeverity.LOW,
				{ test: true },
				mockRequest,
				'test_user'
			);
		});

		it('should log data access events', async () => {
			const mockRequest = new Request('http://localhost:4000/test');
			await auditLogger.logDataAccess('test_user', 'view', 'test_resource', undefined, mockRequest);

			expect(auditLogger.logDataAccess).toHaveBeenCalledWith(
				'test_user',
				'view',
				'test_resource',
				undefined,
				mockRequest
			);
		});
	});

	describe('Rate Limiting', () => {
		it('should check rate limits', () => {
			const mockRequest = new Request('http://localhost:4000/test');
			const config = { windowMs: 60000, maxRequests: 100 };
			const result = rateLimitService.checkRateLimit(mockRequest, config);

			expect(rateLimitService.checkRateLimit).toHaveBeenCalledWith(mockRequest, config);
			expect(result.allowed).toBe(true);
		});

		it('should handle rate limit exceeded', () => {
			const mockRequest = new Request('http://localhost:4000/test');
			const config = { windowMs: 60000, maxRequests: 100 };
			vi.mocked(rateLimitService.checkRateLimit).mockReturnValue({
				allowed: false,
				retryAfter: 60,
				message: 'Too many requests'
			});

			const result = rateLimitService.checkRateLimit(mockRequest, config);

			expect(result.allowed).toBe(false);
			if (!result.allowed) {
				expect(result.retryAfter).toBe(60);
				expect(result.message).toBe('Too many requests');
			}
		});
	});

	describe('Service Interaction', () => {
		it('should integrate audit logging with rate limiting', async () => {
			const mockRequest = new Request('http://localhost:4000/test');
			const config = { windowMs: 60000, maxRequests: 100 };

			// Simulate a rate-limited request
			vi.mocked(rateLimitService.checkRateLimit).mockReturnValue({
				allowed: false,
				retryAfter: 60,
				message: 'Too many requests'
			});

			const result = rateLimitService.checkRateLimit(mockRequest, config);

			// Log the rate limit event
			if (!result.allowed) {
				await auditLogger.logEvent(
					AuditEventType.RATE_LIMIT_EXCEEDED,
					'Rate limit exceeded for API call',
					AuditSeverity.MEDIUM,
					{ retryAfter: result.retryAfter, message: result.message },
					mockRequest,
					'test_user'
				);

				expect(auditLogger.logEvent).toHaveBeenCalledWith(
					AuditEventType.RATE_LIMIT_EXCEEDED,
					'Rate limit exceeded for API call',
					AuditSeverity.MEDIUM,
					{ retryAfter: 60, message: 'Too many requests' },
					mockRequest,
					'test_user'
				);
			}
		});
	});
});

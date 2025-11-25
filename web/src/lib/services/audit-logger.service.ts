/**
 * Audit Logger Service - STUBBED
 *
 * NOTE: This service has been stubbed out because Fluxbase provides
 * its own audit logging functionality. All methods are no-ops.
 *
 * The types and interfaces are kept for backward compatibility.
 */

export enum AuditEventType {
	// Authentication events
	USER_LOGIN = 'user_login',
	USER_LOGOUT = 'user_logout',
	USER_REGISTRATION = 'user_registration',
	PASSWORD_CHANGE = 'password_change',
	PASSWORD_RESET = 'password_reset',

	// Data access events
	DATA_VIEW = 'data_view',
	DATA_CREATE = 'data_create',
	DATA_UPDATE = 'data_update',
	DATA_DELETE = 'data_delete',
	DATA_EXPORT = 'data_export',
	DATA_IMPORT = 'data_import',

	// Administrative events
	USER_ROLE_CHANGE = 'user_role_change',
	USER_ACCOUNT_LOCKED = 'user_account_locked',
	USER_ACCOUNT_UNLOCKED = 'user_account_unlocked',
	SYSTEM_SETTINGS_CHANGE = 'system_settings_change',

	// Security events
	SUSPICIOUS_ACTIVITY = 'suspicious_activity',
	RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
	INVALID_LOGIN_ATTEMPT = 'invalid_login_attempt',
	API_ACCESS_DENIED = 'api_access_denied',

	// Job events
	JOB_CREATED = 'job_created',
	JOB_STARTED = 'job_started',
	JOB_COMPLETED = 'job_completed',
	JOB_FAILED = 'job_failed',
	JOB_CANCELLED = 'job_cancelled'
}

export enum AuditSeverity {
	LOW = 'low',
	MEDIUM = 'medium',
	HIGH = 'high',
	CRITICAL = 'critical'
}

export interface AuditLogEntry {
	id?: string;
	user_id?: string;
	event_type: AuditEventType;
	severity: AuditSeverity;
	description: string;
	ip_address?: string;
	user_agent?: string;
	request_id?: string;
	metadata?: Record<string, unknown>;
	timestamp?: Date;
	created_at?: Date;
	updated_at?: Date;
}

export interface AuditLogFilters {
	user_id?: string;
	event_type?: AuditEventType;
	severity?: AuditSeverity;
	start_date?: Date;
	end_date?: Date;
	limit?: number;
	offset?: number;
}

export interface AuditStatistics {
	total_events: number;
	events_by_type: Record<string, number>;
	events_by_severity: Record<string, number>;
	unique_users: number;
}

/**
 * Stubbed Audit Logger Service
 * All methods are no-ops since Fluxbase handles audit logging
 */
class AuditLoggerService {
	// Initialization (no-op)
	async initialize(): Promise<void> {
		// No-op: Fluxbase handles audit logging
	}

	// Logging methods (all no-ops)
	async logLogin(userId: string, metadata?: Record<string, unknown>): Promise<void> {
		// No-op
	}

	async logLogout(userId: string, metadata?: Record<string, unknown>): Promise<void> {
		// No-op
	}

	async logRegistration(userId: string, metadata?: Record<string, unknown>): Promise<void> {
		// No-op
	}

	async logDataAccess(
		eventType: AuditEventType,
		userId: string,
		resource: string,
		metadata?: Record<string, unknown>
	): Promise<void> {
		// No-op
	}

	async logRoleChange(
		adminUserId: string,
		targetUserId: string,
		oldRole: string,
		newRole: string,
		metadata?: Record<string, unknown>
	): Promise<void> {
		// No-op
	}

	async logSuspiciousActivity(
		userId: string | undefined,
		description: string,
		metadata?: Record<string, unknown>
	): Promise<void> {
		// No-op
	}

	async logRateLimitExceeded(
		userId: string | undefined,
		endpoint: string,
		metadata?: Record<string, unknown>
	): Promise<void> {
		// No-op
	}

	async logJobEvent(
		eventType: AuditEventType,
		userId: string,
		jobId: string,
		metadata?: Record<string, unknown>
	): Promise<void> {
		// No-op
	}

	async log(
		eventType: AuditEventType,
		severity: AuditSeverity,
		description: string,
		userId?: string,
		metadata?: Record<string, unknown>
	): Promise<void> {
		// No-op
	}

	// Query methods (return empty results)
	async getAuditLogs(filters: AuditLogFilters = {}): Promise<AuditLogEntry[]> {
		return [];
	}

	async getAuditStatistics(startDate?: Date, endDate?: Date): Promise<AuditStatistics> {
		return {
			total_events: 0,
			events_by_type: {},
			events_by_severity: {},
			unique_users: 0
		};
	}

	async cleanupOldLogs(retentionDays: number = 90): Promise<number> {
		return 0;
	}
}

// Export singleton instance
export const auditLogger = new AuditLoggerService();

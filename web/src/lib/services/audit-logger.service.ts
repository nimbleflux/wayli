import { createWorkerClient } from '../../worker/client';

import type { FluxbaseClient } from '@fluxbase/sdk';

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
	timestamp?: string;
	created_at?: string;
}

export interface AuditLogFilter {
	user_id?: string;
	event_type?: AuditEventType;
	severity?: AuditSeverity;
	start_date?: string;
	end_date?: string;
	limit?: number;
	offset?: number;
}

export class AuditLoggerService {
	private fluxbase: FluxbaseClient;
	private isDevelopment: boolean;

	constructor() {
		this.fluxbase = createWorkerClient();
		this.isDevelopment = process.env.NODE_ENV === 'development';
	}

	/**
	 * Log an audit event
	 */
	async logEvent(
		eventType: AuditEventType,
		description: string,
		severity: AuditSeverity = AuditSeverity.LOW,
		metadata?: Record<string, unknown>,
		request?: Request,
		userId?: string
	): Promise<void> {
		try {
			const entry: AuditLogEntry = {
				user_id: userId,
				event_type: eventType,
				severity,
				description,
				ip_address: this.extractClientIP(request),
				user_agent: request?.headers.get('user-agent') || undefined,
				request_id: request?.headers.get('x-request-id') || undefined,
				metadata,
				timestamp: new Date().toISOString()
			};

			// Console logging for development
			if (this.isDevelopment) {
				console.log('🔍 [AUDIT]', {
					type: entry.event_type,
					severity: entry.severity,
					description: entry.description,
					user: entry.user_id,
					ip: entry.ip_address,
					metadata: entry.metadata
				});
			}

			// Database logging for production
			if (!this.isDevelopment) {
				await this.fluxbase.from('audit_logs').insert({
					user_id: entry.user_id,
					event_type: entry.event_type,
					severity: entry.severity,
					description: entry.description,
					ip_address: entry.ip_address,
					user_agent: entry.user_agent,
					request_id: entry.request_id,
					metadata: entry.metadata,
					timestamp: entry.timestamp
				});
			}
		} catch (error) {
			console.error('Failed to log audit event:', error);
			// Don't throw - audit logging should not break the application
		}
	}

	/**
	 * Log authentication events
	 */
	async logLogin(
		userId: string,
		success: boolean,
		request?: Request,
		metadata?: Record<string, unknown>
	): Promise<void> {
		const eventType = success ? AuditEventType.USER_LOGIN : AuditEventType.INVALID_LOGIN_ATTEMPT;
		const severity = success ? AuditSeverity.LOW : AuditSeverity.MEDIUM;
		const description = success ? 'User logged in successfully' : 'Invalid login attempt';

		await this.logEvent(
			eventType,
			description,
			severity,
			{
				...metadata,
				success,
				user_id: userId
			},
			request,
			userId
		);
	}

	async logLogout(
		userId: string,
		request?: Request,
		metadata?: Record<string, unknown>
	): Promise<void> {
		await this.logEvent(
			AuditEventType.USER_LOGOUT,
			'User logged out',
			AuditSeverity.LOW,
			metadata,
			request,
			userId
		);
	}

	async logRegistration(
		userId: string,
		request?: Request,
		metadata?: Record<string, unknown>
	): Promise<void> {
		await this.logEvent(
			AuditEventType.USER_REGISTRATION,
			'New user registration',
			AuditSeverity.MEDIUM,
			metadata,
			request,
			userId
		);
	}

	/**
	 * Log data access events
	 */
	async logDataAccess(
		userId: string,
		action: 'view' | 'create' | 'update' | 'delete' | 'export' | 'import',
		resource: string,
		resourceId?: string,
		request?: Request,
		metadata?: Record<string, unknown>
	): Promise<void> {
		const eventTypeMap = {
			view: AuditEventType.DATA_VIEW,
			create: AuditEventType.DATA_CREATE,
			update: AuditEventType.DATA_UPDATE,
			delete: AuditEventType.DATA_DELETE,
			export: AuditEventType.DATA_EXPORT,
			import: AuditEventType.DATA_IMPORT
		};

		const eventType = eventTypeMap[action];
		const description = `Data ${action}: ${resource}${resourceId ? ` (ID: ${resourceId})` : ''}`;
		const severity = action === 'delete' ? AuditSeverity.HIGH : AuditSeverity.LOW;

		await this.logEvent(
			eventType,
			description,
			severity,
			{
				...metadata,
				resource,
				resource_id: resourceId,
				action
			},
			request,
			userId
		);
	}

	/**
	 * Log administrative events
	 */
	async logRoleChange(
		adminUserId: string,
		targetUserId: string,
		oldRole: string,
		newRole: string,
		request?: Request,
		metadata?: Record<string, unknown>
	): Promise<void> {
		await this.logEvent(
			AuditEventType.USER_ROLE_CHANGE,
			`User role changed from ${oldRole} to ${newRole}`,
			AuditSeverity.HIGH,
			{
				...metadata,
				admin_user_id: adminUserId,
				target_user_id: targetUserId,
				old_role: oldRole,
				new_role: newRole
			},
			request,
			adminUserId
		);
	}

	/**
	 * Log security events
	 */
	async logSuspiciousActivity(
		userId: string,
		activity: string,
		request?: Request,
		metadata?: Record<string, unknown>
	): Promise<void> {
		await this.logEvent(
			AuditEventType.SUSPICIOUS_ACTIVITY,
			`Suspicious activity detected: ${activity}`,
			AuditSeverity.HIGH,
			metadata,
			request,
			userId
		);
	}

	async logRateLimitExceeded(
		userId: string,
		endpoint: string,
		request?: Request,
		metadata?: Record<string, unknown>
	): Promise<void> {
		await this.logEvent(
			AuditEventType.RATE_LIMIT_EXCEEDED,
			`Rate limit exceeded for endpoint: ${endpoint}`,
			AuditSeverity.MEDIUM,
			{
				...metadata,
				endpoint
			},
			request,
			userId
		);
	}

	/**
	 * Log job events
	 */
	async logJobEvent(
		jobId: string,
		eventType:
			| AuditEventType.JOB_CREATED
			| AuditEventType.JOB_STARTED
			| AuditEventType.JOB_COMPLETED
			| AuditEventType.JOB_FAILED
			| AuditEventType.JOB_CANCELLED,
		userId: string,
		metadata?: Record<string, unknown>
	): Promise<void> {
		const descriptions = {
			[AuditEventType.JOB_CREATED]: 'Background job created',
			[AuditEventType.JOB_STARTED]: 'Background job started',
			[AuditEventType.JOB_COMPLETED]: 'Background job completed',
			[AuditEventType.JOB_FAILED]: 'Background job failed',
			[AuditEventType.JOB_CANCELLED]: 'Background job cancelled'
		};

		const severity =
			eventType === AuditEventType.JOB_FAILED ? AuditSeverity.MEDIUM : AuditSeverity.LOW;

		await this.logEvent(
			eventType,
			descriptions[eventType],
			severity,
			{
				...metadata,
				job_id: jobId
			},
			undefined,
			userId
		);
	}

	/**
	 * Query audit logs
	 */
	async getAuditLogs(filter: AuditLogFilter = {}): Promise<AuditLogEntry[]> {
		try {
			let query = this.fluxbase
				.from('audit_logs')
				.select('*')
				.order('timestamp', { ascending: false });

			if (filter.user_id) {
				query = query.eq('user_id', filter.user_id);
			}

			if (filter.event_type) {
				query = query.eq('event_type', filter.event_type);
			}

			if (filter.severity) {
				query = query.eq('severity', filter.severity);
			}

			if (filter.start_date) {
				query = query.gte('timestamp', filter.start_date);
			}

			if (filter.end_date) {
				query = query.lte('timestamp', filter.end_date);
			}

			if (filter.limit) {
				query = query.limit(filter.limit);
			}

			if (filter.offset) {
				query = query.range(filter.offset, filter.offset + (filter.limit || 50) - 1);
			}

			const { data, error } = await query;

			if (error) {
				console.error('Error fetching audit logs:', error);
				return [];
			}

			return data || [];
		} catch (error) {
			console.error('Failed to fetch audit logs:', error);
			return [];
		}
	}

	/**
	 * Get audit statistics
	 */
	async getAuditStatistics(
		startDate?: string,
		endDate?: string
	): Promise<{
		totalEvents: number;
		eventsByType: Record<string, number>;
		eventsBySeverity: Record<string, number>;
		eventsByUser: Record<string, number>;
	}> {
		try {
			let query = this.fluxbase.from('audit_logs').select('*');

			if (startDate) {
				query = query.gte('timestamp', startDate);
			}

			if (endDate) {
				query = query.lte('timestamp', endDate);
			}

			const { data, error } = await query;

			if (error || !data) {
				return {
					totalEvents: 0,
					eventsByType: {},
					eventsBySeverity: {},
					eventsByUser: {}
				};
			}

			const eventsByType: Record<string, number> = {};
			const eventsBySeverity: Record<string, number> = {};
			const eventsByUser: Record<string, number> = {};

			data.forEach((event) => {
				// Count by type
				eventsByType[event.event_type] = (eventsByType[event.event_type] || 0) + 1;

				// Count by severity
				eventsBySeverity[event.severity] = (eventsBySeverity[event.severity] || 0) + 1;

				// Count by user
				if (event.user_id) {
					eventsByUser[event.user_id] = (eventsByUser[event.user_id] || 0) + 1;
				}
			});

			return {
				totalEvents: data.length,
				eventsByType,
				eventsBySeverity,
				eventsByUser
			};
		} catch (error) {
			console.error('Failed to get audit statistics:', error);
			return {
				totalEvents: 0,
				eventsByType: {},
				eventsBySeverity: {},
				eventsByUser: {}
			};
		}
	}

	/**
	 * Clean up old audit logs
	 */
	async cleanupOldLogs(retentionDays: number = 90): Promise<void> {
		try {
			const cutoffDate = new Date();
			cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

			const { error } = await this.fluxbase
				.from('audit_logs')
				.delete()
				.lt('timestamp', cutoffDate.toISOString());

			if (error) {
				console.error('Error cleaning up old audit logs:', error);
			} else {
				console.log(`Cleaned up audit logs older than ${retentionDays} days`);
			}
		} catch (error) {
			console.error('Failed to cleanup old audit logs:', error);
		}
	}

	private extractClientIP(request?: Request): string | undefined {
		if (!request) return undefined;

		return (
			request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
			request.headers.get('x-real-ip') ||
			request.headers.get('cf-connecting-ip') ||
			undefined
		);
	}
}

// Export singleton instance
export const auditLogger = new AuditLoggerService();

import type { FluxbaseClient } from '@nimbleflux/fluxbase-sdk';

export enum LogLevel {
	DEBUG = 0,
	INFO = 1,
	WARN = 2,
	ERROR = 3,
	FATAL = 4
}

export interface LogEntry {
	timestamp: string;
	level: LogLevel;
	message: string;
	context?: Record<string, unknown>;
	userId?: string;
	requestId?: string;
	userAgent?: string;
	ip?: string;
	stack?: string;
	service?: string;
	version?: string;
}

export interface LogConfig {
	level: LogLevel;
	service: string;
	version: string;
	enableConsole: boolean;
	enableDatabase: boolean;
	enableFile: boolean;
	filePath?: string;
	maxFileSize?: number;
	maxFiles?: number;
}

class LoggingService {
	private config: LogConfig;
	private fluxbase: FluxbaseClient | null = null;
	private isDevelopment = process.env.NODE_ENV === 'development';

	constructor(config: Partial<LogConfig> = {}) {
		this.config = {
			level: LogLevel.INFO,
			service: 'nimbleflux',
			version: process.env.npm_package_version || '1.0.0',
			enableConsole: true,
			enableDatabase: false,
			enableFile: false,
			maxFileSize: 10 * 1024 * 1024, // 10MB
			maxFiles: 5,
			...config
		};
	}

	setFluxbaseClient(client: FluxbaseClient) {
		this.fluxbase = client;
		this.config.enableDatabase = true;
	}

	private shouldLog(level: LogLevel): boolean {
		if (level === LogLevel.DEBUG && process.env.NODE_ENV === 'development') return true;
		return level >= this.config.level;
	}

	private formatMessage(
		level: LogLevel,
		message: string,
		context?: Record<string, unknown>
	): string {
		const timestamp = new Date().toISOString();
		const levelName = LogLevel[level];
		const contextStr = context ? ` ${JSON.stringify(context)}` : '';
		return `[${timestamp}] ${levelName}: ${message}${contextStr}`;
	}

	private getLogEntry(
		level: LogLevel,
		message: string,
		context?: Record<string, unknown>,
		request?: Request,
		userId?: string
	): LogEntry {
		return {
			timestamp: new Date().toISOString(),
			level,
			message,
			context,
			userId,
			requestId: request?.headers.get('x-request-id') || undefined,
			userAgent: request?.headers.get('user-agent') || undefined,
			ip: this.extractClientIP(request),
			service: this.config.service,
			version: this.config.version
		};
	}

	private extractClientIP(request?: Request): string | undefined {
		if (!request) return undefined;

		const forwarded = request.headers.get('x-forwarded-for');
		const realIp = request.headers.get('x-real-ip');
		const cfConnectingIp = request.headers.get('cf-connecting-ip');

		return forwarded?.split(',')[0] || realIp || cfConnectingIp || undefined;
	}

	private async writeToConsole(entry: LogEntry): Promise<void> {
		if (!this.config.enableConsole) return;

		const formattedMessage = this.formatMessage(entry.level, entry.message, entry.context);

		switch (entry.level) {
			case LogLevel.DEBUG: {
				if (entry.context) console.log(formattedMessage, entry.context);
				else console.log(formattedMessage);
				break;
			}
			case LogLevel.INFO: {
				if (entry.context) console.log(formattedMessage, entry.context);
				else console.log(formattedMessage);
				break;
			}
			case LogLevel.WARN:
				console.warn(formattedMessage);
				break;
			case LogLevel.ERROR:
			case LogLevel.FATAL:
				console.error(formattedMessage);
				if (entry.stack) {
					console.error(entry.stack);
				}
				break;
		}
	}

	private async writeToDatabase(entry: LogEntry): Promise<void> {
		if (!this.config.enableDatabase || !this.fluxbase) return;

		try {
			await this.fluxbase.from('application_logs').insert({
				timestamp: entry.timestamp,
				level: LogLevel[entry.level],
				message: entry.message,
				context: entry.context,
				user_id: entry.userId,
				request_id: entry.requestId,
				user_agent: entry.userAgent,
				ip_address: entry.ip,
				stack: entry.stack,
				service: entry.service,
				version: entry.version
			});
		} catch (error) {
			// Fallback to console if database logging fails
			console.error('Failed to write log to database:', error);
		}
	}

	private async writeToFile(): Promise<void> {
		if (!this.config.enableFile || !this.config.filePath) return;

		// In a real implementation, you would use a proper file logging library
		// like winston or pino for file rotation and management
		console.warn('File logging not implemented - use a proper logging library for production');
	}

	async log(
		level: LogLevel,
		message: string,
		context?: Record<string, unknown>,
		request?: Request,
		userId?: string
	): Promise<void> {
		if (!this.shouldLog(level)) return;

		const entry = this.getLogEntry(level, message, context, request, userId);

		// Write to all configured outputs in parallel
		const writePromises: Promise<void>[] = [];

		if (this.config.enableConsole) {
			writePromises.push(this.writeToConsole(entry));
		}

		if (this.config.enableDatabase) {
			writePromises.push(this.writeToDatabase(entry));
		}

		if (this.config.enableFile) {
			writePromises.push(this.writeToFile());
		}

		await Promise.allSettled(writePromises);
	}

	// Convenience methods for different log levels
	async debug(
		message: string,
		context?: Record<string, unknown>,
		request?: Request,
		userId?: string
	): Promise<void> {
		return this.log(LogLevel.DEBUG, message, context, request, userId);
	}

	async info(
		message: string,
		context?: Record<string, unknown>,
		request?: Request,
		userId?: string
	): Promise<void> {
		return this.log(LogLevel.INFO, message, context, request, userId);
	}

	async warn(
		message: string,
		context?: Record<string, unknown>,
		request?: Request,
		userId?: string
	): Promise<void> {
		return this.log(LogLevel.WARN, message, context, request, userId);
	}

	async error(
		message: string,
		context?: Record<string, unknown>,
		request?: Request,
		userId?: string
	): Promise<void> {
		return this.log(LogLevel.ERROR, message, context, request, userId);
	}

	async fatal(
		message: string,
		context?: Record<string, unknown>,
		request?: Request,
		userId?: string
	): Promise<void> {
		return this.log(LogLevel.FATAL, message, context, request, userId);
	}

	// Specialized logging methods
	async logRequest(
		method: string,
		url: string,
		statusCode: number,
		duration: number,
		request?: Request,
		userId?: string
	): Promise<void> {
		const context = {
			method,
			url,
			statusCode,
			duration: `${duration}ms`,
			userAgent: request?.headers.get('user-agent'),
			ip: this.extractClientIP(request)
		};

		const level = statusCode >= 400 ? LogLevel.ERROR : LogLevel.INFO;
		const message = `${method} ${url} - ${statusCode} (${duration}ms)`;

		await this.log(level, message, context, request, userId);
	}

	async logDatabaseQuery(
		query: string,
		duration: number,
		table?: string,
		operation?: string,
		userId?: string
	): Promise<void> {
		const context = {
			query: query.substring(0, 200) + (query.length > 200 ? '...' : ''),
			duration: `${duration}ms`,
			table,
			operation
		};

		const level = duration > 1000 ? LogLevel.WARN : LogLevel.DEBUG;
		const message = `Database query${table ? ` on ${table}` : ''} took ${duration}ms`;

		await this.log(level, message, context, undefined, userId);
	}

	async logExternalServiceCall(
		service: string,
		endpoint: string,
		method: string,
		statusCode: number,
		duration: number,
		userId?: string
	): Promise<void> {
		const context = {
			service,
			endpoint,
			method,
			statusCode,
			duration: `${duration}ms`
		};

		const level = statusCode >= 400 ? LogLevel.ERROR : LogLevel.INFO;
		const message = `${service} ${method} ${endpoint} - ${statusCode} (${duration}ms)`;

		await this.log(level, message, context, undefined, userId);
	}

	async logUserAction(
		action: string,
		resource: string,
		resourceId?: string,
		userId?: string,
		request?: Request
	): Promise<void> {
		const context = {
			action,
			resource,
			resourceId,
			userAgent: request?.headers.get('user-agent'),
			ip: this.extractClientIP(request)
		};

		const message = `User ${action} ${resource}${resourceId ? ` (${resourceId})` : ''}`;
		await this.log(LogLevel.INFO, message, context, request, userId);
	}

	async logSecurityEvent(
		event: string,
		details: Record<string, unknown>,
		userId?: string,
		request?: Request
	): Promise<void> {
		const context = {
			...details,
			userAgent: request?.headers.get('user-agent'),
			ip: this.extractClientIP(request)
		};

		await this.log(LogLevel.WARN, `Security event: ${event}`, context, request, userId);
	}

	// Performance logging
	async logPerformance(
		operation: string,
		duration: number,
		context?: Record<string, unknown>,
		userId?: string
	): Promise<void> {
		const level = duration > 5000 ? LogLevel.WARN : LogLevel.DEBUG;
		const message = `${operation} took ${duration}ms`;

		await this.log(level, message, { duration, ...context }, undefined, userId);
	}

	// Error logging with stack trace
	async logError(
		error: Error,
		context?: Record<string, unknown>,
		request?: Request,
		userId?: string
	): Promise<void> {
		const errorContext = {
			...context,
			errorName: error.name,
			errorMessage: error.message,
			stack: error.stack
		};

		await this.log(LogLevel.ERROR, error.message, errorContext, request, userId);
	}

	// Configuration methods
	setLogLevel(level: LogLevel): void {
		this.config.level = level;
	}

	enableConsole(enabled: boolean): void {
		this.config.enableConsole = enabled;
	}

	enableDatabase(enabled: boolean): void {
		this.config.enableDatabase = enabled;
	}

	enableFile(enabled: boolean, filePath?: string): void {
		this.config.enableFile = enabled;
		if (filePath) {
			this.config.filePath = filePath;
		}
	}
}

// Export singleton instance
export const logger = new LoggingService({
	level: process.env.NODE_ENV === 'development' ? LogLevel.DEBUG : LogLevel.INFO,
	service: 'nimbleflux',
	version: process.env.npm_package_version || '1.0.0',
	enableConsole: true,
	enableDatabase: process.env.NODE_ENV === 'production',
	enableFile: false
});

// Alias for backward compatibility
export const loggingService = logger;

// Helper function to create a request logger
export function createRequestLogger(request: Request, userId?: string) {
	return {
		debug: (message: string, context?: Record<string, unknown>) =>
			logger.debug(message, context, request, userId),
		info: (message: string, context?: Record<string, unknown>) =>
			logger.info(message, context, request, userId),
		warn: (message: string, context?: Record<string, unknown>) =>
			logger.warn(message, context, request, userId),
		error: (message: string, context?: Record<string, unknown>) =>
			logger.error(message, context, request, userId),
		fatal: (message: string, context?: Record<string, unknown>) =>
			logger.fatal(message, context, request, userId)
	};
}

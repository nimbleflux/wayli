/**
 * Service Layer Architecture
 * Provides a clean separation between business logic and UI components
 */

// Service interface definitions
export interface IService {
	initialize(): Promise<void>;
	destroy(): Promise<void>;
}

export interface ICacheService extends IService {
	get<T>(key: string): T | null;
	set<T>(key: string, value: T, ttl?: number): void;
	delete(key: string): void;
	clear(): void;
}

export interface ILoggerService extends IService {
	log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void;
	debug(message: string, data?: unknown): void;
	info(message: string, data?: unknown): void;
	warn(message: string, data?: unknown): void;
	error(message: string, data?: unknown): void;
}

export interface IAuthService extends IService {
	getUser(): Promise<unknown | null>;
	login(credentials: { email: string; password: string }): Promise<unknown>;
	logout(): Promise<void>;
	refreshToken(): Promise<void>;
}

// Service container for dependency injection
class ServiceContainer {
	private services = new Map<string, IService>();
	private singletons = new Map<string, IService>();

	// Register a service
	register<T extends IService>(name: string, service: T, singleton = false): void {
		if (singleton) {
			this.singletons.set(name, service);
		} else {
			this.services.set(name, service);
		}
	}

	// Get a service instance
	get<T extends IService>(name: string): T | null {
		return (this.singletons.get(name) || this.services.get(name)) as T | null;
	}

	// Initialize all services
	async initialize(): Promise<void> {
		const allServices = [...this.services.values(), ...this.singletons.values()];

		for (const service of allServices) {
			try {
				await service.initialize();
			} catch (error) {
				console.error(`Failed to initialize service:`, error);
			}
		}
	}

	// Destroy all services
	async destroy(): Promise<void> {
		const allServices = [...this.services.values(), ...this.singletons.values()];

		for (const service of allServices) {
			try {
				await service.destroy();
			} catch (error) {
				console.error(`Failed to destroy service:`, error);
			}
		}

		this.services.clear();
		this.singletons.clear();
	}
}

// Global service container instance
export const serviceContainer = new ServiceContainer();

// Service factory for creating services with dependencies
export class ServiceFactory {
	static create<T extends IService>(
		ServiceClass: new (...args: unknown[]) => T,
		dependencies: string[] = []
	): T {
		const resolvedDependencies = dependencies.map((dep) => serviceContainer.get(dep));
		return new ServiceClass(...resolvedDependencies);
	}
}

// Base service class with common functionality
export abstract class BaseService implements IService {
	protected logger: ILoggerService | null = null;
	protected cacheService: ICacheService | null = null;

	constructor() {
		this.logger = serviceContainer.get<ILoggerService>('logger');
		this.cacheService = serviceContainer.get<ICacheService>('cache');
	}

	async initialize(): Promise<void> {
		this.logger?.info(`${this.constructor.name} initialized`);
	}

	async destroy(): Promise<void> {
		this.logger?.info(`${this.constructor.name} destroyed`);
	}

	protected log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void {
		this.logger?.[level](`[${this.constructor.name}] ${message}`, data);
	}
}

// Enhanced cache service with TTL and memory management
export class EnhancedCacheService extends BaseService implements ICacheService {
	private cache = new Map<string, { value: unknown; expires: number }>();
	private maxSize = 1000;
	private cleanupInterval: NodeJS.Timeout | null = null;

	async initialize(): Promise<void> {
		await super.initialize();

		// Start cleanup interval
		this.cleanupInterval = setInterval(() => {
			this.cleanup();
		}, 60000); // Clean up every minute
	}

	async destroy(): Promise<void> {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}

		this.clear();
		await super.destroy();
	}

	get<T>(key: string): T | null {
		const item = this.cache.get(key);

		if (!item) return null;

		if (Date.now() > item.expires) {
			this.cache.delete(key);
			return null;
		}

		return item.value as T;
	}

	set<T>(key: string, value: T, ttl = 300000): void {
		// Default 5 minutes
		// Check cache size
		if (this.cache.size >= this.maxSize) {
			this.evictOldest();
		}

		this.cache.set(key, {
			value,
			expires: Date.now() + ttl
		});
	}

	delete(key: string): void {
		this.cache.delete(key);
	}

	clear(): void {
		this.cache.clear();
	}

	private cleanup(): void {
		const now = Date.now();
		let cleaned = 0;

		for (const [key, item] of this.cache.entries()) {
			if (now > item.expires) {
				this.cache.delete(key);
				cleaned++;
			}
		}

		if (cleaned > 0) {
			this.log('debug', `Cleaned up ${cleaned} expired cache entries`);
		}
	}

	private evictOldest(): void {
		let oldestKey: string | null = null;
		let oldestTime = Date.now();

		for (const [key, item] of this.cache.entries()) {
			if (item.expires < oldestTime) {
				oldestTime = item.expires;
				oldestKey = key;
			}
		}

		if (oldestKey) {
			this.cache.delete(oldestKey);
			this.log('debug', `Evicted oldest cache entry: ${oldestKey}`);
		}
	}
}

// Enhanced logger service with structured logging
export class EnhancedLoggerService extends BaseService implements ILoggerService {
	private logLevel: 'debug' | 'info' | 'warn' | 'error' = 'info';
	private logBuffer: Array<{ level: string; message: string; data?: unknown; timestamp: number }> =
		[];
	private maxBufferSize = 100;

	async initialize(): Promise<void> {
		await super.initialize();

		// Set log level - use default for client-side
		this.logLevel = 'info';
	}

	log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void {
		const timestamp = Date.now();
		const logEntry = { level, message, data, timestamp };

		// Add to buffer
		this.logBuffer.push(logEntry);
		if (this.logBuffer.length > this.maxBufferSize) {
			this.logBuffer.shift();
		}

		// Check log level
		const levels = { debug: 0, info: 1, warn: 2, error: 3 };
		if (levels[level] < levels[this.logLevel]) {
			return;
		}

		// Format and output log
		const formattedMessage = `[${new Date(timestamp).toISOString()}] [${level.toUpperCase()}] ${message}`;

		switch (level) {
			case 'debug':
				console.debug(formattedMessage, data);
				break;
			case 'info':
				console.info(formattedMessage, data);
				break;
			case 'warn':
				console.warn(formattedMessage, data);
				break;
			case 'error':
				console.error(formattedMessage, data);
				break;
		}
	}

	debug(message: string, data?: unknown): void {
		this.log('debug', message, data);
	}

	info(message: string, data?: unknown): void {
		this.log('info', message, data);
	}

	warn(message: string, data?: unknown): void {
		this.log('warn', message, data);
	}

	error(message: string, data?: unknown): void {
		this.log('error', message, data);
	}

	// Get recent logs
	getRecentLogs(
		count = 10
	): Array<{ level: string; message: string; data?: unknown; timestamp: number }> {
		return this.logBuffer.slice(-count);
	}

	// Clear log buffer
	clearBuffer(): void {
		this.logBuffer = [];
	}
}

// Service manager for coordinating service lifecycle
export class ServiceManager {
	private static instance: ServiceManager;
	private initialized = false;

	static getInstance(): ServiceManager {
		if (!ServiceManager.instance) {
			ServiceManager.instance = new ServiceManager();
		}
		return ServiceManager.instance;
	}

	async initialize(): Promise<void> {
		if (this.initialized) return;

		// Register core services
		serviceContainer.register('logger', new EnhancedLoggerService(), true);
		serviceContainer.register('cache', new EnhancedCacheService(), true);

		// Initialize all services
		await serviceContainer.initialize();

		this.initialized = true;
	}

	async destroy(): Promise<void> {
		await serviceContainer.destroy();
		this.initialized = false;
		console.log('🛑 Service layer destroyed');
	}

	getService<T extends IService>(name: string): T | null {
		return serviceContainer.get<T>(name);
	}

	/**
	 * Get a service with proper typing
	 */
	getTypedService<T extends IService>(name: string): T {
		const service = this.getService<T>(name);
		if (!service) {
			throw new Error(`Service ${name} not found`);
		}
		return service;
	}
}

// Export service manager instance
export const serviceManager = ServiceManager.getInstance();

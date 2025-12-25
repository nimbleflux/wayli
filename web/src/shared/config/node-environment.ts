// src/shared/config/node-environment.ts
// Node.js/worker/server environment configuration using dotenv and process.env
// This file should ONLY be imported in Node.js/worker/server code (not in client-side/browser code).
// Never import this in client-side or SvelteKit load functions.

import dotenv from 'dotenv';

// Load environment variables from .env file (optional)
// Look for .env file in the project root (web/ directory)
// Then load .env.local as override (for local development)
let result: dotenv.DotenvConfigOutput = { parsed: {} };
try {
	const envPath = new URL('../../../.env', import.meta.url).pathname;
	result = dotenv.config({ path: envPath });

	// Load .env.local as override (local dev can override Docker URLs with localhost)
	const envLocalPath = new URL('../../../.env.local', import.meta.url).pathname;
	const localResult = dotenv.config({ path: envLocalPath, override: true });
	if (localResult.parsed) {
		result.parsed = { ...result.parsed, ...localResult.parsed };
	}
} catch (error) {
	// .env file is optional - environment variables can be set via Kubernetes, Docker, etc.
	console.log('ℹ️ No .env file found - using environment variables from system');
}

export interface NodeEnvironmentConfig {
	// Fluxbase Configuration
	fluxbase: {
		url: string;
		anonKey: string;
		serviceRoleKey: string;
	};

	// Worker Configuration
	workers: {
		maxWorkers: number;
		pollInterval: number;
		jobTimeout: number;
		retryAttempts: number;
		retryDelay: number;
	};

	// External Services
	pelias: {
		endpoint: string;
		rateLimit: number;
	};

	// Application Configuration
	app: {
		nodeEnv: string;
		port: number;
		host: string;
		logLevel: string;
		corsOrigin: string;
		rateLimitWindow: number;
		rateLimitMax: number;
	};

	// Database Configuration
	database: {
		url: string;
		poolSize: number;
		ssl: boolean;
		connectionTimeout: number;
		queryTimeout: number;
		retryAttempts: number;
		retryDelay: number;
	};

	// Security Configuration
	security: {
		jwtSecret: string;
		sessionSecret: string;
		cookieSecret: string;
		bcryptRounds: number;
	};

	// Cache Configuration
	cache: {
		redisUrl: string;
		ttl: number;
		maxSize: number;
	};

	// File Upload Configuration
	uploads: {
		maxSize: number;
		allowedTypes: string[];
		storagePath: string;
	};

	// Monitoring Configuration
	monitoring: {
		enabled: boolean;
		endpoint: string;
		apiKey: string;
	};
}

/**
 * Validates the Node.js environment configuration
 * @param config - The configuration object to validate
 * @returns The validated configuration
 */
export function validateNodeEnvironmentConfig(
	config: NodeEnvironmentConfig,
	strict: boolean = false
): NodeEnvironmentConfig {
	const isDev = config.app.nodeEnv === 'development';
	const errors: string[] = [];

	// Always validate Fluxbase configuration (required for workers)
	if (!config.fluxbase.url) {
		errors.push('FLUXBASE_BASE_URL is required');
	}
	if (!config.fluxbase.anonKey) {
		errors.push('FLUXBASE_ANON_KEY is required');
	}
	if (!config.fluxbase.serviceRoleKey) {
		errors.push('FLUXBASE_SERVICE_ROLE_KEY is required');
	}

	// Only validate other configs if strict mode is enabled
	if (strict) {
		// Validate application configuration
		if (!config.app.nodeEnv) {
			errors.push('NODE_ENV is required');
		}

		// Validate security configuration (more lenient in development)
		if (!config.security.jwtSecret) {
			errors.push('JWT_SECRET is required');
		}
		if (!config.security.sessionSecret && !isDev) {
			errors.push('SESSION_SECRET is required');
		}
		if (!config.security.cookieSecret && !isDev) {
			errors.push('COOKIE_SECRET is required');
		}
	}

	// Report errors
	if (errors.length > 0) {
		if (isDev && !strict) {
			console.warn('⚠️  Development mode - some environment variables are missing:', errors);
		} else {
			throw new Error(`Configuration errors: ${errors.join(', ')}`);
		}
	}

	return config;
}

/**
 * Get the Node.js environment configuration (dotenv + process.env).
 * Throws if required variables are missing in production.
 * @returns {NodeEnvironmentConfig}
 */
export function getNodeEnvironmentConfig(): NodeEnvironmentConfig {
	// Use the merged environment variables (env vars take precedence over .env file)
	const mergedEnv = { ...result.parsed, ...process.env };

	// Fluxbase Configuration - prioritize internal URLs for workers
	const fluxbaseUrl = mergedEnv.FLUXBASE_BASE_URL || mergedEnv.FLUXBASE_PUBLIC_BASE_URL || '';
	const fluxbaseAnonKey = mergedEnv.FLUXBASE_ANON_KEY || mergedEnv.PUBLIC_FLUXBASE_ANON_KEY || '';
	const fluxbaseServiceRoleKey = mergedEnv.FLUXBASE_SERVICE_ROLE_KEY || '';

	// Worker Configuration
	const maxWorkers = parseInt(mergedEnv.MAX_WORKERS || '2', 10);
	const pollInterval = parseInt(mergedEnv.WORKER_POLL_INTERVAL || '5000', 10);
	const jobTimeout = parseInt(mergedEnv.JOB_TIMEOUT || '300000', 10);
	const retryAttempts = parseInt(mergedEnv.RETRY_ATTEMPTS || '3', 10);
	const retryDelay = parseInt(mergedEnv.RETRY_DELAY || '1000', 10);

	// External Services
	const peliasEndpoint = mergedEnv.PELIAS_ENDPOINT || 'https://pelias.wayli.app';
	const peliasRateLimit = parseInt(mergedEnv.PELIAS_RATE_LIMIT || '1000', 10);

	// Application Configuration
	const nodeEnv = mergedEnv.NODE_ENV || 'development';
	const port = parseInt(mergedEnv.PORT || '3000', 10);
	const host = mergedEnv.HOST || 'localhost';
	const logLevel = mergedEnv.LOG_LEVEL || 'info';
	const corsOrigin = mergedEnv.CORS_ORIGIN || '*';
	const rateLimitWindow = parseInt(mergedEnv.RATE_LIMIT_WINDOW || '900000', 10);
	const rateLimitMax = parseInt(mergedEnv.RATE_LIMIT_MAX || '100', 10);

	// Database Configuration
	const databaseUrl = mergedEnv.FLUXBASE_DB_URL || mergedEnv.DATABASE_URL || '';
	const poolSize = parseInt(mergedEnv.FLUXBASE_DB_POOL_SIZE || mergedEnv.DB_POOL_SIZE || '10', 10);
	const ssl = mergedEnv.FLUXBASE_DB_SSL === 'true' || mergedEnv.DB_SSL === 'true';
	const connectionTimeout = parseInt(
		mergedEnv.FLUXBASE_DB_CONNECTION_TIMEOUT || mergedEnv.DB_CONNECTION_TIMEOUT || '30000',
		10
	);
	const queryTimeout = parseInt(
		mergedEnv.FLUXBASE_DB_QUERY_TIMEOUT || mergedEnv.DB_QUERY_TIMEOUT || '30000',
		10
	);
	const dbRetryAttempts = parseInt(
		mergedEnv.FLUXBASE_DB_RETRY_ATTEMPTS || mergedEnv.DB_RETRY_ATTEMPTS || '3',
		10
	);
	const dbRetryDelay = parseInt(
		mergedEnv.FLUXBASE_DB_RETRY_DELAY || mergedEnv.DB_RETRY_DELAY || '1000',
		10
	);

	// Security Configuration
	const jwtSecret = mergedEnv.JWT_SECRET || '';
	const sessionSecret =
		mergedEnv.SESSION_SECRET || (nodeEnv === 'development' ? 'dev-session-secret' : '');
	const cookieSecret =
		mergedEnv.COOKIE_SECRET || (nodeEnv === 'development' ? 'dev-cookie-secret' : '');
	const bcryptRounds = parseInt(mergedEnv.BCRYPT_ROUNDS || '12', 10);

	// Cache Configuration
	const redisUrl = mergedEnv.REDIS_URL || '';
	const cacheTtl = parseInt(mergedEnv.CACHE_TTL || '3600', 10);
	const cacheMaxSize = parseInt(mergedEnv.CACHE_MAX_SIZE || '1000', 10);

	// File Upload Configuration
	const uploadMaxSize = parseInt(mergedEnv.UPLOAD_MAX_SIZE || '5242880', 10);
	const uploadAllowedTypes = mergedEnv.UPLOAD_ALLOWED_TYPES?.split(',') || [
		'image/jpeg',
		'image/png'
	];
	const uploadStoragePath = mergedEnv.UPLOAD_STORAGE_PATH || './uploads';

	// Monitoring Configuration
	const monitoringEnabled = mergedEnv.MONITORING_ENABLED === 'true';
	const monitoringEndpoint = mergedEnv.MONITORING_ENDPOINT || '';
	const monitoringApiKey = mergedEnv.MONITORING_API_KEY || '';

	const config: NodeEnvironmentConfig = {
		fluxbase: {
			url: fluxbaseUrl,
			anonKey: fluxbaseAnonKey,
			serviceRoleKey: fluxbaseServiceRoleKey
		},
		workers: {
			maxWorkers,
			pollInterval,
			jobTimeout,
			retryAttempts,
			retryDelay
		},
		pelias: {
			endpoint: peliasEndpoint,
			rateLimit: peliasRateLimit
		},
		app: {
			nodeEnv,
			port,
			host,
			logLevel,
			corsOrigin,
			rateLimitWindow,
			rateLimitMax
		},
		database: {
			url: databaseUrl,
			poolSize,
			ssl,
			connectionTimeout,
			queryTimeout,
			retryAttempts: dbRetryAttempts,
			retryDelay: dbRetryDelay
		},
		security: {
			jwtSecret,
			sessionSecret,
			cookieSecret,
			bcryptRounds
		},
		cache: {
			redisUrl,
			ttl: cacheTtl,
			maxSize: cacheMaxSize
		},
		uploads: {
			maxSize: uploadMaxSize,
			allowedTypes: uploadAllowedTypes,
			storagePath: uploadStoragePath
		},
		monitoring: {
			enabled: monitoringEnabled,
			endpoint: monitoringEndpoint,
			apiKey: monitoringApiKey
		}
	};

	return validateNodeEnvironmentConfig(config, false); // Non-strict validation for workers
}

/**
 * Gets the Fluxbase configuration
 * @returns The Fluxbase configuration
 */
export function getFluxbaseConfig() {
	return getNodeEnvironmentConfig().fluxbase;
}

/**
 * Gets the worker configuration
 * @returns The worker configuration
 */
export function getWorkerConfig() {
	return getNodeEnvironmentConfig().workers;
}

/**
 * Gets the Fluxbase configuration with minimal validation (for workers)
 * Only validates Fluxbase connection details, ignores other configs
 * @returns The Fluxbase configuration
 */
export function getWorkerFluxbaseConfig() {
	// Environment variables should take precedence over .env file
	const mergedEnv = { ...result.parsed, ...process.env };

	// For workers, prioritize internal URLs over public URLs
	// This ensures workers use cluster-internal communication in Kubernetes
	const fluxbaseUrl = mergedEnv.FLUXBASE_BASE_URL || mergedEnv.FLUXBASE_PUBLIC_BASE_URL || '';

	const fluxbaseAnonKey = mergedEnv.FLUXBASE_ANON_KEY || mergedEnv.PUBLIC_FLUXBASE_ANON_KEY || '';
	const fluxbaseServiceRoleKey = mergedEnv.FLUXBASE_SERVICE_ROLE_KEY || '';

	// Log which URL is being used for debugging
	const urlSource = mergedEnv.FLUXBASE_BASE_URL
		? 'FLUXBASE_BASE_URL'
		: mergedEnv.FLUXBASE_PUBLIC_BASE_URL
			? 'FLUXBASE_PUBLIC_BASE_URL'
			: 'none';
	console.log(`🔧 Worker Fluxbase URL source: ${urlSource}`);
	console.log(`🔧 Worker Fluxbase URL: ${fluxbaseUrl}`);

	// Only validate Fluxbase config for workers
	if (!fluxbaseUrl) {
		throw new Error('FLUXBASE_BASE_URL is required for worker');
	}
	if (!fluxbaseServiceRoleKey) {
		throw new Error('FLUXBASE_SERVICE_ROLE_KEY is required for worker');
	}

	return {
		url: fluxbaseUrl,
		anonKey: fluxbaseAnonKey,
		serviceRoleKey: fluxbaseServiceRoleKey
	};
}

/**
 * Gets the Pelias configuration
 * @returns The Pelias configuration
 */
export function getPeliasConfig() {
	return getNodeEnvironmentConfig().pelias;
}

/**
 * Checks if the application is running in development mode
 * @returns True if in development mode
 */
export function isDevelopment(): boolean {
	return getNodeEnvironmentConfig().app.nodeEnv === 'development';
}

/**
 * Checks if the application is running in production mode
 * @returns True if in production mode
 */
export function isProduction(): boolean {
	return getNodeEnvironmentConfig().app.nodeEnv === 'production';
}

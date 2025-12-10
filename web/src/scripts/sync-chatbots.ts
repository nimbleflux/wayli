/**
 * Fluxbase Chatbot Sync Script
 *
 * Syncs chatbot definitions to Fluxbase on Wayli startup.
 * Reads chatbot files from fluxbase/chatbots/ and syncs them to the Fluxbase AI platform.
 * Runs in both development and production environments.
 */

import { config } from 'dotenv';
import { createClient } from '@fluxbase/sdk';
import type { ChatbotSpec } from '@fluxbase/sdk';
import { readFile, readdir } from 'fs/promises';
import { join, basename, extname } from 'path';

// Load environment variables from .env files
// Priority: existing env vars > .env.local > .env
// This allows Docker env vars to take precedence
config({ path: join(process.cwd(), '.env.local'), override: false });
config({ path: join(process.cwd(), '.env'), override: false });

interface ChatbotConfig {
	name: string;
	filePath: string;
	enabled: boolean;
	allowed_tables: string[];
	allowed_operations: string[];
	allowed_schemas: string[];
	max_tokens: number;
	temperature: number;
	persist_conversations: boolean;
	rate_limit_per_minute: number;
	daily_request_limit: number;
	daily_token_budget: number;
	allow_unauthenticated: boolean;
	is_public: boolean;
	http_allowed_domains: string[];
}

/**
 * Parse JSDoc comments from chatbot file to extract Fluxbase annotations
 * Supports:
 * - @fluxbase:allowed-tables <table1,table2>
 * - @fluxbase:allowed-operations <SELECT,INSERT>
 * - @fluxbase:allowed-schemas <public,custom>
 * - @fluxbase:max-tokens <number>
 * - @fluxbase:temperature <0.0-1.0>
 * - @fluxbase:persist-conversations <true|false>
 * - @fluxbase:rate-limit <number>/min
 * - @fluxbase:daily-limit <number>
 * - @fluxbase:token-budget <number>/day
 * - @fluxbase:allow-unauthenticated
 * - @fluxbase:public
 * - @fluxbase:disabled
 * - @fluxbase:http-allowed-domains <domain1,domain2> (supports ${ENV_VAR:-default} syntax)
 */
function parseChatbotAnnotations(code: string): Omit<ChatbotConfig, 'name' | 'filePath'> {
	const annotations: Omit<ChatbotConfig, 'name' | 'filePath'> = {
		enabled: true,
		allowed_tables: [],
		allowed_operations: ['SELECT'],
		allowed_schemas: ['public'],
		max_tokens: 4096,
		temperature: 0.7,
		persist_conversations: true,
		rate_limit_per_minute: 10,
		daily_request_limit: 500,
		daily_token_budget: 100000,
		allow_unauthenticated: false,
		is_public: false,
		http_allowed_domains: []
	};

	// Match JSDoc comment at the start of the file
	const jsdocMatch = code.match(/^\/\*\*[\s\S]*?\*\//);
	if (!jsdocMatch) {
		return annotations;
	}

	const jsdoc = jsdocMatch[0];

	// Parse @fluxbase:disabled
	if (jsdoc.includes('@fluxbase:disabled')) annotations.enabled = false;

	// Parse @fluxbase:allow-unauthenticated
	if (jsdoc.includes('@fluxbase:allow-unauthenticated')) annotations.allow_unauthenticated = true;

	// Parse @fluxbase:public
	if (jsdoc.includes('@fluxbase:public')) annotations.is_public = true;

	// Parse @fluxbase:persist-conversations
	const persistMatch = jsdoc.match(/@fluxbase:persist-conversations\s+(true|false)/);
	if (persistMatch) {
		annotations.persist_conversations = persistMatch[1] === 'true';
	}

	// Parse @fluxbase:allowed-tables
	const tablesMatch = jsdoc.match(/@fluxbase:allowed-tables\s+([^\s\n@]+)/);
	if (tablesMatch) {
		annotations.allowed_tables = tablesMatch[1].split(',').map((t) => t.trim());
	}

	// Parse @fluxbase:allowed-operations
	const operationsMatch = jsdoc.match(/@fluxbase:allowed-operations\s+([^\s\n@]+)/);
	if (operationsMatch) {
		annotations.allowed_operations = operationsMatch[1].split(',').map((o) => o.trim());
	}

	// Parse @fluxbase:allowed-schemas
	const schemasMatch = jsdoc.match(/@fluxbase:allowed-schemas\s+([^\s\n@]+)/);
	if (schemasMatch) {
		annotations.allowed_schemas = schemasMatch[1].split(',').map((s) => s.trim());
	}

	// Parse @fluxbase:max-tokens
	const maxTokensMatch = jsdoc.match(/@fluxbase:max-tokens\s+(\d+)/);
	if (maxTokensMatch) {
		annotations.max_tokens = parseInt(maxTokensMatch[1], 10);
	}

	// Parse @fluxbase:temperature
	const temperatureMatch = jsdoc.match(/@fluxbase:temperature\s+([\d.]+)/);
	if (temperatureMatch) {
		annotations.temperature = parseFloat(temperatureMatch[1]);
	}

	// Parse @fluxbase:rate-limit (e.g., "10/min" or "20/min")
	const rateLimitMatch = jsdoc.match(/@fluxbase:rate-limit\s+(\d+)\/min/);
	if (rateLimitMatch) {
		annotations.rate_limit_per_minute = parseInt(rateLimitMatch[1], 10);
	}

	// Parse @fluxbase:daily-limit
	const dailyLimitMatch = jsdoc.match(/@fluxbase:daily-limit\s+(\d+)/);
	if (dailyLimitMatch) {
		annotations.daily_request_limit = parseInt(dailyLimitMatch[1], 10);
	}

	// Parse @fluxbase:token-budget (e.g., "100000/day")
	const tokenBudgetMatch = jsdoc.match(/@fluxbase:token-budget\s+(\d+)\/day/);
	if (tokenBudgetMatch) {
		annotations.daily_token_budget = parseInt(tokenBudgetMatch[1], 10);
	}

	// Parse @fluxbase:http-allowed-domains with env var substitution
	const httpDomainsMatch = jsdoc.match(/@fluxbase:http-allowed-domains\s+([^\n@]+)/);
	if (httpDomainsMatch) {
		const rawValue = httpDomainsMatch[1].trim();
		annotations.http_allowed_domains = parseHttpAllowedDomains(rawValue);
	}

	return annotations;
}

/**
 * Parse http-allowed-domains annotation with env var substitution.
 * Supports syntax: ${ENV_VAR:-default} or ${ENV_VAR} or plain value
 * Extracts hostname from URLs (e.g., https://pelias.wayli.app -> pelias.wayli.app)
 */
function parseHttpAllowedDomains(value: string): string[] {
	return value
		.split(',')
		.map((domain) => {
			domain = domain.trim();

			// Check for env var syntax: ${VAR:-default} or ${VAR}
			const envVarMatch = domain.match(/\$\{(\w+)(?::-([^}]+))?\}/);
			if (envVarMatch) {
				const [, envVarName, defaultValue] = envVarMatch;
				const envValue = process.env[envVarName];
				domain = envValue || defaultValue || domain;
			}

			// Extract hostname from URL if it's a full URL
			if (domain.startsWith('http://') || domain.startsWith('https://')) {
				try {
					const url = new URL(domain);
					return url.hostname;
				} catch {
					// If URL parsing fails, return as-is
					return domain;
				}
			}

			return domain;
		})
		.filter(Boolean);
}

/**
 * Substitute environment variable placeholders in chatbot code.
 * Supports two syntaxes:
 * - {{ENV_VAR}} - replaced with full env var value (for URLs in prompt)
 * - ${ENV_VAR:-default} - replaced with hostname extracted from env var, or default (for domain annotations)
 * Falls back to default values for known placeholders.
 */
function substituteEnvVars(code: string): string {
	const defaults: Record<string, string> = {
		PELIAS_ENDPOINT: 'https://pelias.wayli.app'
	};

	// First, handle {{VAR}} syntax (full value substitution for prompt URLs)
	let result = code.replace(/\{\{(\w+)\}\}/g, (match, envVar) => {
		return process.env[envVar] || defaults[envVar] || match;
	});

	// Then, handle ${VAR:-default} syntax in JSDoc annotations (hostname extraction for domains)
	result = result.replace(/\$\{(\w+):-([^}]+)\}/g, (_match, envVar, defaultValue) => {
		const envValue = process.env[envVar] || defaults[envVar];
		const value = envValue || defaultValue;

		// Extract hostname if it's a URL
		if (value.startsWith('http://') || value.startsWith('https://')) {
			try {
				const url = new URL(value);
				return url.hostname;
			} catch {
				return value;
			}
		}
		return value;
	});

	return result;
}

/**
 * Extract description from JSDoc comment
 */
function extractDescription(code: string): string | undefined {
	const jsdocMatch = code.match(/^\/\*\*\s*\n\s*\*\s*([^\n@*]+)/);
	if (jsdocMatch) {
		return jsdocMatch[1].trim();
	}
	return undefined;
}

/**
 * Auto-discover chatbot definitions from the chatbots directory
 * Excludes: type definitions, config files, test files, README, etc.
 */
async function discoverChatbots(basePath: string): Promise<ChatbotConfig[]> {
	const chatbotsDir = join(basePath, 'fluxbase/chatbots');

	// Files to exclude from auto-discovery
	const excludePatterns = [
		'types.d.ts',
		'deno.json',
		'deno.dev.json',
		'deno.lock',
		'README.md',
		'ARCHITECTURE.md'
	];

	try {
		const files = await readdir(chatbotsDir);
		const chatbots: ChatbotConfig[] = [];

		for (const file of files) {
			// Skip if not a .ts file
			if (extname(file) !== '.ts') continue;

			// Skip excluded files
			if (excludePatterns.includes(file)) continue;

			// Skip test files
			if (file.endsWith('.test.ts') || file.startsWith('test-')) continue;

			// Skip _shared directory (if it exists)
			if (file.startsWith('_')) continue;

			const chatbotName = basename(file, '.ts');
			const filePath = join(chatbotsDir, file);

			// Read file and parse annotations
			const code = await readFile(filePath, 'utf-8');
			const annotations = parseChatbotAnnotations(code);

			// Validate that chatbot has default export (system prompt)
			if (!code.includes('export default')) {
				console.warn(
					`⚠️  ${chatbotName}: Missing 'export default' (system prompt) - skipping`
				);
				continue;
			}

			chatbots.push({
				name: chatbotName,
				filePath: `fluxbase/chatbots/${file}`,
				...annotations
			});

			const settings: string[] = [];
			if (annotations.allowed_tables.length > 0)
				settings.push(`tables=${annotations.allowed_tables.join(',')}`);
			if (annotations.max_tokens !== 4096) settings.push(`tokens=${annotations.max_tokens}`);
			if (annotations.temperature !== 0.7) settings.push(`temp=${annotations.temperature}`);
			if (annotations.rate_limit_per_minute !== 10)
				settings.push(`rate=${annotations.rate_limit_per_minute}/min`);
			if (annotations.http_allowed_domains.length > 0)
				settings.push(`http_domains=${annotations.http_allowed_domains.join(',')}`);
			if (!annotations.enabled) settings.push('disabled');

			console.log(
				`📦 Discovered: ${chatbotName} [${settings.join(', ') || 'default settings'}]`
			);
		}

		return chatbots.sort((a, b) => a.name.localeCompare(b.name));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			console.warn(`⚠️  Chatbots directory not found: ${chatbotsDir}`);
			return [];
		}
		console.error(`❌ Failed to discover chatbots in ${chatbotsDir}:`, error);
		throw error;
	}
}

async function syncChatbots() {
	console.log('🤖 Starting Fluxbase chatbot sync...');

	// Get configuration from environment
	const fluxbaseUrl = process.env.FLUXBASE_BASE_URL || process.env.PUBLIC_FLUXBASE_BASE_URL;
	const serviceRoleKey = process.env.FLUXBASE_SERVICE_ROLE_KEY;
	const namespace = process.env.FLUXBASE_CHATBOTS_NAMESPACE || 'wayli';
	const deleteMissing = process.env.FLUXBASE_CHATBOTS_DELETE_MISSING !== 'false';

	// Validate required environment variables
	if (!fluxbaseUrl) {
		console.error('❌ Error: FLUXBASE_BASE_URL is not set');
		process.exit(1);
	}

	if (!serviceRoleKey) {
		console.error('❌ Error: FLUXBASE_SERVICE_ROLE_KEY is not set');
		process.exit(1);
	}

	console.log(`📡 Fluxbase URL: ${fluxbaseUrl}`);
	console.log(`📦 Namespace: ${namespace}`);
	console.log(`🗑️  Delete missing chatbots: ${deleteMissing}`);

	try {
		// Determine base path (different in dev vs production)
		// In dev: /workspace/ (repo root, fluxbase is at root level)
		// In production: /app/
		const isProduction = process.env.NODE_ENV === 'production';
		const basePath = isProduction ? '/app' : join(process.cwd(), '..');

		console.log(`📁 Base path: ${basePath}`);
		console.log('🔍 Auto-discovering chatbot definitions...\n');

		// Auto-discover chatbots from the chatbots directory
		const discoveredChatbots = await discoverChatbots(basePath);

		if (discoveredChatbots.length === 0) {
			console.warn('⚠️  No chatbot definitions discovered. Check the chatbots directory.');
			return;
		}

		console.log(`\n✅ Discovered ${discoveredChatbots.length} chatbot definitions\n`);

		// Read and prepare chatbot code
		const chatbotsToSync: ChatbotSpec[] = await Promise.all(
			discoveredChatbots.map(async (config) => {
				const filePath = join(basePath, config.filePath);
				console.log(`📖 Reading: ${config.name} from ${filePath}`);

				try {
					const rawCode = await readFile(filePath, 'utf-8');
					const code = substituteEnvVars(rawCode);
					const description = extractDescription(code);
					console.log(`✅ Read ${config.name}: ${rawCode.length} bytes`);

					return {
						name: config.name,
						description,
						code,
						enabled: config.enabled,
						allowed_tables: config.allowed_tables,
						allowed_operations: config.allowed_operations,
						allowed_schemas: config.allowed_schemas,
						max_tokens: config.max_tokens,
						temperature: config.temperature,
						persist_conversations: config.persist_conversations,
						rate_limit_per_minute: config.rate_limit_per_minute,
						daily_request_limit: config.daily_request_limit,
						daily_token_budget: config.daily_token_budget,
						allow_unauthenticated: config.allow_unauthenticated,
						is_public: config.is_public,
						http_allowed_domains: config.http_allowed_domains
					};
				} catch (error) {
					console.error(`❌ Failed to read ${config.name}:`, error);
					throw error;
				}
			})
		);

		console.log(
			`\n🚀 Preparing to sync ${chatbotsToSync.length} chatbot definitions to namespace "${namespace}"...`
		);

		// Create Fluxbase client
		const client = createClient(fluxbaseUrl, serviceRoleKey, {
			auth: {
				autoRefresh: false,
				persist: false
			}
		});

		console.log('\n📦 Syncing chatbots...\n');

		// Sync chatbots using admin AI API
		const { data, error } = await client.admin.ai.sync({
			namespace,
			chatbots: chatbotsToSync,
			options: {
				delete_missing: deleteMissing
			}
		});

		if (error) {
			console.error('❌ Chatbot sync failed:', error);
			process.exit(1);
		}

		if (data) {
			console.log('\n📊 Sync results:');
			console.log(JSON.stringify(data, null, 2));

			// Check for errors in the response
			if (data.summary?.errors && data.summary.errors > 0) {
				console.error(
					`\n❌ Chatbot sync failed: ${data.summary.errors} chatbot(s) had errors`
				);

				if (data.errors && data.errors.length > 0) {
					console.error('\n📋 Failed chatbots:');
					for (const err of data.errors) {
						console.error(`   • ${err.name}: ${err.error}`);
					}
				}

				process.exit(1);
			}

			const successCount = (data.summary?.created || 0) + (data.summary?.updated || 0);
			console.log(`\n✅ Chatbot sync completed: ${successCount} chatbot(s) synced successfully`);
		} else {
			console.log('✅ Chatbot sync completed successfully!');
		}

		// Summary
		console.log('\n📋 Chatbot definitions:');
		chatbotsToSync.forEach((chatbot) => {
			const details: string[] = [];
			if (chatbot.allowed_tables && chatbot.allowed_tables.length > 0)
				details.push(`tables=${chatbot.allowed_tables.join(',')}`);
			if (chatbot.max_tokens) details.push(`tokens=${chatbot.max_tokens}`);
			if (chatbot.temperature) details.push(`temp=${chatbot.temperature}`);
			if (chatbot.rate_limit_per_minute) details.push(`rate=${chatbot.rate_limit_per_minute}/min`);
			if (chatbot.http_allowed_domains && chatbot.http_allowed_domains.length > 0)
				details.push(`http_domains=${chatbot.http_allowed_domains.join(',')}`);

			console.log(
				`   • ${chatbot.name} (${chatbot.enabled ? 'enabled' : 'disabled'}) [${details.join(', ') || 'default settings'}]`
			);
		});

		console.log('\n✨ Sync complete!');
	} catch (error) {
		console.error('❌ Unexpected error during chatbot sync:', error);
		process.exit(1);
	}
}

// Run the sync
syncChatbots().catch((error) => {
	console.error('❌ Fatal error:', error);
	process.exit(1);
});

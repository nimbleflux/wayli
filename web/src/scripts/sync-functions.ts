/**
 * Fluxbase Function Sync Script
 *
 * Syncs edge functions to Fluxbase on Wayli startup.
 * Runs in both development and production environments.
 */

import { config } from 'dotenv';
import { createClient } from '@fluxbase/sdk';
import { readFile, readdir } from 'fs/promises';
import { join, basename, extname } from 'path';

// Load environment variables from .env files
// Priority: existing env vars > .env.local > .env
// This allows Docker env vars to take precedence
config({ path: join(process.cwd(), '.env.local'), override: false });
config({ path: join(process.cwd(), '.env'), override: false });

interface FunctionConfig {
	name: string;
	filePath: string;
	enabled: boolean;
	allow_net?: boolean;
	allow_env?: boolean;
	allow_read?: boolean;
}

/**
 * Parse JSDoc comments from function file to extract Fluxbase annotations
 * Supports: @fluxbase:allow-net, @fluxbase:allow-env, @fluxbase:allow-read, @fluxbase:disabled
 */
function parseFunctionAnnotations(code: string): {
	allow_net: boolean;
	allow_env: boolean;
	allow_read: boolean;
	enabled: boolean;
} {
	const annotations = {
		allow_net: true,
		allow_env: true,
		allow_read: true,
		enabled: true
	};

	// Match JSDoc comment at the start of the file
	const jsdocMatch = code.match(/^\/\*\*[\s\S]*?\*\//);
	if (!jsdocMatch) {
		return annotations;
	}

	const jsdoc = jsdocMatch[0];

	// Parse @fluxbase annotations
	if (jsdoc.includes('@fluxbase:allow-net')) annotations.allow_net = true;
	if (jsdoc.includes('@fluxbase:allow-env')) annotations.allow_env = true;
	if (jsdoc.includes('@fluxbase:allow-read')) annotations.allow_read = true;
	if (jsdoc.includes('@fluxbase:disabled')) annotations.enabled = false;

	return annotations;
}

/**
 * Auto-discover edge functions from the functions directory
 * Excludes: type definitions, config files, test files, README, etc.
 */
async function discoverFunctions(basePath: string): Promise<FunctionConfig[]> {
	const functionsDir = join(basePath, 'fluxbase/functions');

	// Files to exclude from auto-discovery
	const excludePatterns = [
		'types.d.ts',
		'deno.json',
		'deno.dev.json',
		'deno.lock',
		'README.md',
		'test-function.ts'
	];

	try {
		const files = await readdir(functionsDir);
		const functions: FunctionConfig[] = [];

		for (const file of files) {
			// Skip if not a .ts file
			if (extname(file) !== '.ts') continue;

			// Skip excluded files
			if (excludePatterns.includes(file)) continue;

			// Skip test files
			if (file.endsWith('.test.ts') || file.startsWith('test-')) continue;

			const functionName = basename(file, '.ts');
			const filePath = join(functionsDir, file);

			// Read file and parse annotations
			const code = await readFile(filePath, 'utf-8');
			const annotations = parseFunctionAnnotations(code);

			functions.push({
				name: functionName,
				filePath: `fluxbase/functions/${file}`,
				enabled: annotations.enabled,
				allow_net: annotations.allow_net,
				allow_env: annotations.allow_env,
				allow_read: annotations.allow_read
			});

			console.log(`📦 Discovered: ${functionName} (net=${annotations.allow_net}, env=${annotations.allow_env}, read=${annotations.allow_read})`);
		}

		return functions.sort((a, b) => a.name.localeCompare(b.name));
	} catch (error) {
		console.error(`❌ Failed to discover functions in ${functionsDir}:`, error);
		throw error;
	}
}

async function syncFunctions() {
	console.log('🔄 Starting Fluxbase function sync...');

	// Get configuration from environment
	const fluxbaseUrl = process.env.FLUXBASE_BASE_URL || process.env.PUBLIC_FLUXBASE_BASE_URL;
	const serviceRoleKey = process.env.FLUXBASE_SERVICE_ROLE_KEY;
	const namespace = process.env.FLUXBASE_FUNCTIONS_NAMESPACE || 'wayli';
	const deleteMissing = process.env.FLUXBASE_FUNCTIONS_DELETE_MISSING !== 'false';

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
	console.log(`🗑️  Delete missing functions: ${deleteMissing}`);

	try {
		// Determine base path (different in dev vs production)
		// In dev: /workspace/ (repo root, fluxbase is at root level)
		// In production: /app/
		const isProduction = process.env.NODE_ENV === 'production';
		const basePath = isProduction ? '/app' : join(process.cwd(), '..');

		console.log(`📁 Base path: ${basePath}`);
		console.log('🔍 Auto-discovering edge functions...\n');

		// Auto-discover functions from the functions directory
		const discoveredFunctions = await discoverFunctions(basePath);

		if (discoveredFunctions.length === 0) {
			console.warn('⚠️  No functions discovered. Check the functions directory.');
			return;
		}

		console.log(`\n✅ Discovered ${discoveredFunctions.length} functions\n`);

		// Read and prepare function code
		const functionsToSync = await Promise.all(
			discoveredFunctions.map(async (config: FunctionConfig) => {
				const filePath = join(basePath, config.filePath);
				console.log(`📖 Reading: ${config.name} from ${filePath}`);

				try {
					const code = await readFile(filePath, 'utf-8');
					console.log(`✅ Read ${config.name}: ${code.length} bytes`);

					return {
						name: config.name,
						code,
						enabled: config.enabled,
						allow_net: config.allow_net,
						allow_env: config.allow_env,
						allow_read: config.allow_read
					};
				} catch (error) {
					console.error(`❌ Failed to read ${config.name}:`, error);
					throw error;
				}
			})
		);

		console.log(`\n🚀 Syncing ${functionsToSync.length} functions to namespace "${namespace}"...`);

		// Create Fluxbase client
		const client = createClient(fluxbaseUrl, serviceRoleKey, {
			auth: {
				autoRefresh: false,
				persist: false
			}
		});

		// Sync functions using SDK
		const { data, error } = await client.admin.functions.sync({
			namespace,
			functions: functionsToSync,
			options: {
				delete_missing: deleteMissing
			}
		});

		if (error) {
			console.error('❌ Function sync failed:', error);
			process.exit(1);
		}

		console.log('✅ Function sync completed successfully!');

		if (data) {
			console.log('\n📊 Sync results:');
			console.log(JSON.stringify(data, null, 2));
		}

		// Summary
		console.log('\n📋 Synced functions:');
		functionsToSync.forEach((fn: typeof functionsToSync[0]) => {
			const permissions: string[] = [];
			if (fn.allow_net) permissions.push('net');
			if (fn.allow_env) permissions.push('env');
			if (fn.allow_read) permissions.push('read');

			console.log(`   • ${fn.name} (${fn.enabled ? 'enabled' : 'disabled'}) [${permissions.join(', ')}]`);
		});

		console.log('\n✨ All functions are now deployed and ready!');
	} catch (error) {
		console.error('❌ Unexpected error during function sync:', error);
		process.exit(1);
	}
}

// Run the sync
syncFunctions().catch((error) => {
	console.error('❌ Fatal error:', error);
	process.exit(1);
});

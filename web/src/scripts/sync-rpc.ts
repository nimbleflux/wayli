/**
 * Fluxbase RPC Sync Script
 *
 * Syncs RPC procedures (PostgreSQL functions) to Fluxbase.
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

interface RPCConfig {
	name: string;
	filePath: string;
	enabled: boolean;
	description?: string;
}

/**
 * Parse SQL comments to extract Fluxbase annotations
 * Supports: -- @fluxbase:description, -- @fluxbase:disabled, etc.
 */
function parseRPCAnnotations(code: string): {
	enabled: boolean;
	description?: string;
} {
	const annotations: {
		enabled: boolean;
		description?: string;
	} = {
		enabled: true
	};

	// Match SQL comments at the start of the file
	const lines = code.split('\n');
	for (const line of lines) {
		const trimmed = line.trim();

		// Stop parsing when we hit actual SQL (not a comment)
		if (trimmed && !trimmed.startsWith('--')) {
			break;
		}

		// Parse @fluxbase annotations
		if (trimmed.includes('@fluxbase:disabled')) {
			annotations.enabled = false;
		}

		const descriptionMatch = trimmed.match(/--\s*@fluxbase:description\s+(.+)/);
		if (descriptionMatch) {
			annotations.description = descriptionMatch[1].trim();
		}
	}

	return annotations;
}

/**
 * Auto-discover RPC procedures from the rpc directory
 * Excludes: README files, test files, etc.
 */
async function discoverRPCProcedures(basePath: string): Promise<RPCConfig[]> {
	const rpcDir = join(basePath, 'fluxbase/rpc');

	// Files to exclude from auto-discovery
	const excludePatterns = ['README.md', 'README.txt'];

	try {
		const files = await readdir(rpcDir);
		const procedures: RPCConfig[] = [];

		for (const file of files) {
			// Skip if not a .sql file
			if (extname(file) !== '.sql') continue;

			// Skip excluded files
			if (excludePatterns.includes(file)) continue;

			// Skip test files
			if (file.endsWith('.test.sql') || file.startsWith('test-')) continue;

			const procedureName = basename(file, '.sql');
			const filePath = join(rpcDir, file);

			// Read file and parse annotations
			const code = await readFile(filePath, 'utf-8');
			const annotations = parseRPCAnnotations(code);

			procedures.push({
				name: procedureName,
				filePath: `fluxbase/rpc/${file}`,
				enabled: annotations.enabled,
				description: annotations.description
			});

			console.log(
				`📦 Discovered: ${procedureName} (${annotations.enabled ? 'enabled' : 'disabled'})${annotations.description ? ` - ${annotations.description}` : ''}`
			);
		}

		return procedures.sort((a, b) => a.name.localeCompare(b.name));
	} catch (error: unknown) {
		// Directory might not exist yet
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			console.warn(`⚠️  RPC directory not found: ${rpcDir}`);
			return [];
		}
		console.error(`❌ Failed to discover RPC procedures in ${rpcDir}:`, error);
		throw error;
	}
}

async function syncRPC() {
	console.log('🔄 Starting Fluxbase RPC sync...');

	// Get configuration from environment
	const fluxbaseUrl = process.env.FLUXBASE_BASE_URL || process.env.FLUXBASE_PUBLIC_BASE_URL;
	const serviceRoleKey = process.env.FLUXBASE_SERVICE_ROLE_KEY;
	const namespace = process.env.FLUXBASE_RPC_NAMESPACE || 'wayli';
	const deleteMissing = process.env.FLUXBASE_RPC_DELETE_MISSING !== 'false';

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
	console.log(`🗑️  Delete missing procedures: ${deleteMissing}`);

	try {
		// Determine base path (different in dev vs production)
		// In dev: /workspace/ (repo root, fluxbase is at root level)
		// In production: /app/
		const isProduction = process.env.NODE_ENV === 'production';
		const basePath = isProduction ? '/app' : join(process.cwd(), '..');

		console.log(`📁 Base path: ${basePath}`);
		console.log('🔍 Auto-discovering RPC procedures...\n');

		// Auto-discover procedures from the rpc directory
		const discoveredProcedures = await discoverRPCProcedures(basePath);

		if (discoveredProcedures.length === 0) {
			console.warn('⚠️  No RPC procedures discovered. Check the fluxbase/rpc directory.');
			return;
		}

		console.log(`\n✅ Discovered ${discoveredProcedures.length} RPC procedures\n`);

		// Read and prepare procedure code
		const proceduresToSync = await Promise.all(
			discoveredProcedures.map(async (config: RPCConfig) => {
				const filePath = join(basePath, config.filePath);
				console.log(`📖 Reading: ${config.name} from ${filePath}`);

				try {
					const code = await readFile(filePath, 'utf-8');
					console.log(`✅ Read ${config.name}: ${code.length} bytes`);

					return {
						name: config.name,
						code,
						enabled: config.enabled,
						description: config.description
					};
				} catch (error) {
					console.error(`❌ Failed to read ${config.name}:`, error);
					throw error;
				}
			})
		);

		console.log(`\n🚀 Syncing ${proceduresToSync.length} RPC procedures to namespace "${namespace}"...`);

		// Create Fluxbase client
		const client = createClient(fluxbaseUrl, serviceRoleKey, {
			auth: {
				autoRefresh: false,
				persist: false
			}
		});

		// Sync RPC procedures using SDK
		const { data, error } = await client.admin.rpc.sync({
			namespace,
			procedures: proceduresToSync,
			options: {
				delete_missing: deleteMissing
			}
		});

		if (error) {
			console.error('❌ RPC sync failed:', error);
			process.exit(1);
		}

		console.log('✅ RPC sync completed successfully!');

		if (data) {
			console.log('\n📊 Sync results:');
			console.log(JSON.stringify(data, null, 2));
		}

		// Summary
		console.log('\n📋 Synced RPC procedures:');
		proceduresToSync.forEach((proc: (typeof proceduresToSync)[0]) => {
			console.log(`   • ${proc.name} (${proc.enabled ? 'enabled' : 'disabled'})${proc.description ? ` - ${proc.description}` : ''}`);
		});

		console.log('\n✨ All RPC procedures are now deployed and ready!');
	} catch (error) {
		console.error('❌ Unexpected error during RPC sync:', error);
		process.exit(1);
	}
}

// Run the sync
syncRPC().catch((error) => {
	console.error('❌ Fatal error:', error);
	process.exit(1);
});

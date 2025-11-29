/**
 * Fluxbase Migration Sync Script
 *
 * Syncs SQL migrations to Fluxbase on Wayli startup.
 * Runs in both development and production environments.
 */

import { config } from 'dotenv';
import { createClient } from '@fluxbase/sdk';
import { readFile, readdir } from 'fs/promises';
import { join, basename } from 'path';

// Load environment variables from .env files
// Priority: existing env vars > .env.local > .env
config({ path: join(process.cwd(), '.env.local'), override: false });
config({ path: join(process.cwd(), '.env'), override: false });

interface Migration {
	version: number;
	name: string;
	upSql: string;
	downSql: string;
}

/**
 * Parse migration filename to extract version and name
 * Format: {version}_{name}.{up|down}.sql
 * Example: 001_schemas.up.sql -> { version: 1, name: 'schemas' }
 */
function parseMigrationFilename(filename: string): { version: number; name: string } | null {
	const match = filename.match(/^(\d+)_(.+)\.(up|down)\.sql$/);
	if (!match) return null;

	return {
		version: parseInt(match[1], 10),
		name: match[2]
	};
}

/**
 * Discover and load migrations from the migrations directory
 */
async function discoverMigrations(basePath: string): Promise<Migration[]> {
	const migrationsDir = join(basePath, 'fluxbase/migrations');

	console.log(`📁 Reading migrations from: ${migrationsDir}`);

	try {
		const files = await readdir(migrationsDir);

		// Group migrations by version and name
		const migrationMap = new Map<string, { up?: string; down?: string; version: number }>();

		for (const file of files) {
			// Skip backup files and directories
			if (file.startsWith('.') || !file.endsWith('.sql')) continue;

			const parsed = parseMigrationFilename(file);
			if (!parsed) {
				console.warn(`⚠️  Skipping invalid migration filename: ${file}`);
				continue;
			}

			const key = `${parsed.version.toString().padStart(3, '0')}_${parsed.name}`;
			const filePath = join(migrationsDir, file);
			const content = await readFile(filePath, 'utf-8');

			if (!migrationMap.has(key)) {
				migrationMap.set(key, { version: parsed.version });
			}

			const migration = migrationMap.get(key)!;

			if (file.includes('.up.sql')) {
				migration.up = content;
			} else if (file.includes('.down.sql')) {
				migration.down = content;
			}
		}

		// Convert to Migration array
		const migrations: Migration[] = [];

		for (const [key, migration] of migrationMap.entries()) {
			const name = key.replace(/^\d+_/, '');

			if (!migration.up) {
				console.warn(`⚠️  Migration ${key} missing .up.sql file, skipping`);
				continue;
			}

			migrations.push({
				version: migration.version,
				name,
				upSql: migration.up,
				downSql: migration.down || '' // down migration is optional
			});

			console.log(
				`📦 Discovered: ${key} (${migration.up.length} bytes up, ${migration.down?.length || 0} bytes down)`
			);
		}

		// Sort by version
		migrations.sort((a, b) => a.version - b.version);

		return migrations;
	} catch (error) {
		console.error(`❌ Failed to discover migrations in ${migrationsDir}:`, error);
		throw error;
	}
}

async function syncMigrations() {
	console.log('🔄 Starting Fluxbase migration sync...');

	// Get configuration from environment
	const fluxbaseUrl = process.env.FLUXBASE_BASE_URL || process.env.PUBLIC_FLUXBASE_BASE_URL;
	const serviceRoleKey =
		process.env.FLUXBASE_MIGRATIONS_SERVICE_KEY || process.env.FLUXBASE_SERVICE_ROLE_KEY;
	const namespace = process.env.FLUXBASE_MIGRATIONS_NAMESPACE || 'wayli';
	const autoApply = process.env.FLUXBASE_MIGRATIONS_AUTO_APPLY !== 'false';

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
	console.log(`🔧 Auto-apply: ${autoApply}`);

	try {
		// Determine base path (different in dev vs production)
		// In dev: /workspace/ (repo root, fluxbase is at root level)
		// In production: /app/
		const isProduction = process.env.NODE_ENV === 'production';
		const basePath = isProduction ? '/app' : join(process.cwd(), '..');

		console.log(`📁 Base path: ${basePath}`);
		console.log('🔍 Discovering migrations...\n');

		// Discover migrations
		const migrations = await discoverMigrations(basePath);

		if (migrations.length === 0) {
			console.warn('⚠️  No migrations discovered. Check the migrations directory.');
			return;
		}

		console.log(`\n✅ Discovered ${migrations.length} migrations\n`);

		// Create Fluxbase client
		const client = createClient(fluxbaseUrl, serviceRoleKey, {
			auth: {
				autoRefresh: false,
				persist: false
			}
		});

		// Register each migration
		console.log('📝 Registering migrations with Fluxbase...');

		for (const migration of migrations) {
			const migrationName = `${migration.version.toString().padStart(3, '0')}_${migration.name}`;

			try {
				await client.admin.migrations.register({
					namespace,
					name: migrationName,
					up_sql: migration.upSql,
					down_sql: migration.downSql
				});

				console.log(`✅ Registered: ${migrationName}`);
			} catch (error) {
				console.error(`❌ Error registering migration ${migrationName}:`, error);
				throw error;
			}
		}

		console.log('\n🚀 Syncing migrations...');

		// Sync migrations (apply new ones)
		const { data, error } = await client.admin.migrations.sync({
			auto_apply: autoApply
		});

		if (error) {
			console.error('❌ Migration sync failed:', JSON.stringify(error, null, 2));
			process.exit(1);
		}

		// Check for errors in the sync result
		const syncResult = data as {
			summary?: { errors?: number };
			details?: { errors?: Array<{ name: string; error: string }> };
			warnings?: string[];
		};

		if (syncResult?.summary?.errors && syncResult.summary.errors > 0) {
			console.error('\n❌ Migration sync completed with errors:');
			console.error(JSON.stringify(data, null, 2));

			// Show detailed error messages
			if (syncResult.details?.errors && syncResult.details.errors.length > 0) {
				console.error('\n📋 Failed migrations:');
				for (const err of syncResult.details.errors) {
					console.error(`   • ${err.name}: ${err.error}`);
				}
			}

			// Show warnings
			if (syncResult.warnings && syncResult.warnings.length > 0) {
				console.error('\n⚠️  Warnings:');
				for (const warning of syncResult.warnings) {
					console.error(`   • ${warning}`);
				}
			}

			process.exit(1);
		}

		console.log('✅ Migration sync completed successfully!');

		if (data) {
			console.log('\n📊 Sync results:');
			console.log(JSON.stringify(data, null, 2));
		}

		// Summary
		console.log('\n📋 Registered migrations:');
		migrations.forEach((migration) => {
			const migrationName = `${migration.version.toString().padStart(3, '0')}_${migration.name}`;
			const hasDown = migration.downSql.length > 0;
			console.log(`   • ${migrationName} (${hasDown ? 'bidirectional' : 'forward-only'})`);
		});

		console.log('\n✨ Schema is now up to date and cache refreshed!');
	} catch (error) {
		console.error('❌ Unexpected error during migration sync:');
		// Use JSON.stringify to properly display nested objects/arrays
		if (error instanceof Error) {
			console.error(`   Message: ${error.message}`);
			// Check if error has additional properties (like syncResult)
			const errorWithData = error as Error & { syncResult?: unknown; details?: unknown };
			if (errorWithData.syncResult) {
				console.error('   Sync Result:', JSON.stringify(errorWithData.syncResult, null, 2));
			}
			if (errorWithData.details) {
				console.error('   Details:', JSON.stringify(errorWithData.details, null, 2));
			}
		} else {
			console.error(JSON.stringify(error, null, 2));
		}
		process.exit(1);
	}
}

// Run the sync
syncMigrations().catch((error) => {
	console.error('❌ Fatal error:');
	if (error instanceof Error) {
		console.error(`   Message: ${error.message}`);
		const errorWithData = error as Error & { syncResult?: unknown; details?: unknown };
		if (errorWithData.syncResult) {
			console.error('   Sync Result:', JSON.stringify(errorWithData.syncResult, null, 2));
		}
		if (errorWithData.details) {
			console.error('   Details:', JSON.stringify(errorWithData.details, null, 2));
		}
	} else {
		console.error(JSON.stringify(error, null, 2));
	}
	process.exit(1);
});

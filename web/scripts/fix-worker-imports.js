#!/usr/bin/env node

/**
 * 🔧 Worker Import Path Fixer
 *
 * This script fixes all $lib import paths in worker files to use relative paths
 * since workers run as standalone Node.js processes and don't have access to SvelteKit aliases.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WORKER_DIR = path.join(__dirname, '..', 'src', 'worker');
const SHARED_DIR = path.join(__dirname, '..', 'src', 'shared');

// Import path mappings from $lib to relative paths
const IMPORT_MAPPINGS = [
	// Core config
	{ from: '$lib/core/config/worker-environment', to: '../shared/config/worker-environment' },
	{ from: '$lib/core/config/node-environment', to: '../shared/config/node-environment' },

	// Fluxbase clients
	{ from: '$lib/core/fluxbase/worker', to: '../shared/fluxbase/worker' },
	{ from: '$lib/core/fluxbase/server', to: '../shared/fluxbase/server' },
	{ from: '$lib/core/fluxbase/worker-client', to: '../shared/fluxbase/worker-client' },

	// Types
	{ from: '$lib/types/job-queue.types', to: '../shared/types/job-queue.types' },
	{ from: '$lib/types/trip-generation.types', to: '../shared/types/trip-generation.types' },

	// Services
	{ from: '$lib/services/queue/job-queue.service.worker', to: '../job-queue.service.worker' },
	{
		from: '$lib/services/external/country-reverse-geocoding.service',
		to: '../shared/services/external/country-reverse-geocoding.service'
	},
	{
		from: '$lib/services/external/nominatim.service',
		to: '../shared/services/external/nominatim.service'
	},

	// Utils
	{ from: '$lib/utils/job-cancellation', to: '../shared/utils/job-cancellation' },
	{ from: '$lib/utils/geocoding-utils', to: '../shared/utils/geocoding-utils' },
	{ from: '$lib/services/queue/helpers/date-ranges', to: './helpers/date-ranges' },

	// Shared
	{ from: '$lib/shared/types', to: '../shared/types' },
	{ from: '$lib/shared/constants', to: '../shared/constants' },
	{ from: '$lib/shared/environment', to: '../shared/environment' }
];

function fixImportsInFile(filePath) {
	console.log(`🔧 Fixing imports in: ${path.relative(process.cwd(), filePath)}`);

	let content = fs.readFileSync(filePath, 'utf8');
	let changed = false;

	for (const mapping of IMPORT_MAPPINGS) {
		const regex = new RegExp(
			`import\\s+.*?from\\s+['"]${mapping.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`,
			'g'
		);
		if (regex.test(content)) {
			content = content.replace(regex, (match) => {
				return match.replace(mapping.from, mapping.to);
			});
			changed = true;
			console.log(`  ✅ Fixed: ${mapping.from} → ${mapping.to}`);
		}
	}

	if (changed) {
		fs.writeFileSync(filePath, content, 'utf8');
		console.log(`  💾 File updated`);
	} else {
		console.log(`  ℹ️  No changes needed`);
	}

	return changed;
}

function findWorkerFiles(dir) {
	const files = [];

	if (!fs.existsSync(dir)) return files;

	const items = fs.readdirSync(dir);

	for (const item of items) {
		const fullPath = path.join(dir, item);
		const stat = fs.statSync(fullPath);

		if (stat.isDirectory()) {
			files.push(...findWorkerFiles(fullPath));
		} else if (stat.isFile() && item.endsWith('.ts')) {
			files.push(fullPath);
		}
	}

	return files;
}

function main() {
	console.log('🔧 Fixing worker import paths...\n');

	const workerFiles = findWorkerFiles(WORKER_DIR);
	let totalFixed = 0;

	for (const file of workerFiles) {
		if (fixImportsInFile(file)) {
			totalFixed++;
		}
		console.log('');
	}

	console.log('📊 Summary:');
	console.log(`  Files processed: ${workerFiles.length}`);
	console.log(`  Files updated: ${totalFixed}`);

	if (totalFixed > 0) {
		console.log('\n🎉 Worker import paths have been fixed!');
		console.log('You can now run the worker with: npm run worker:start');
	} else {
		console.log('\n✅ All worker files already have correct import paths.');
	}
}

// Run the fixer
main().catch((error) => {
	console.error('❌ Error fixing worker imports:', error);
	process.exit(1);
});

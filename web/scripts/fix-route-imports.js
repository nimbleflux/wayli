#!/usr/bin/env node

/**
 * 🔧 Route Import Path Fixer
 *
 * This script fixes all import paths in route files to use the new environment structure
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROUTES_DIR = path.join(__dirname, '..', 'src', 'routes');

// Import path mappings from old $lib paths to new environment-specific paths
const IMPORT_MAPPINGS = [
	// i18n - routes are client-side, so import from client
	{ from: '$lib/i18n', to: '$lib/client/i18n' },

	// Core fluxbase - routes are client-side, so import from shared
	{ from: '$lib/core/fluxbase/client', to: '$lib/shared/fluxbase/client' },

	// Services - routes are client-side, so import from client
	{ from: '$lib/services', to: '$lib/client/services' },

	// Utils - routes are client-side, so import from client
	{ from: '$lib/utils', to: '$lib/client/utils' },

	// Components - routes are client-side, so import from client
	{ from: '$lib/components', to: '$lib/client/components' },

	// Stores - routes are client-side, so import from client
	{ from: '$lib/stores', to: '$lib/client/stores' },

	// Types - safe to import from shared
	{ from: '$lib/types', to: '$lib/shared/types' },

	// Constants - safe to import from shared
	{ from: '$lib/constants', to: '$lib/shared/constants' }
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

function findRouteFiles(dir) {
	const files = [];

	if (!fs.existsSync(dir)) return files;

	const items = fs.readdirSync(dir);

	for (const item of items) {
		const fullPath = path.join(dir, item);
		const stat = fs.statSync(fullPath);

		if (stat.isDirectory()) {
			files.push(...findRouteFiles(fullPath));
		} else if (stat.isFile() && (item.endsWith('.svelte') || item.endsWith('.ts'))) {
			files.push(fullPath);
		}
	}

	return files;
}

function main() {
	console.log('🔧 Fixing route import paths...\n');

	const routeFiles = findRouteFiles(ROUTES_DIR);
	let totalFixed = 0;

	for (const file of routeFiles) {
		if (fixImportsInFile(file)) {
			totalFixed++;
		}
		console.log('');
	}

	console.log('📊 Summary:');
	console.log(`  Files processed: ${routeFiles.length}`);
	console.log(`  Files updated: ${totalFixed}`);

	if (totalFixed > 0) {
		console.log('\n🎉 Route import paths have been fixed!');
		console.log('You can now try building the project again.');
	} else {
		console.log('\n✅ All route files already have correct import paths.');
	}
}

// Run the fixer
main().catch((error) => {
	console.error('❌ Error fixing route imports:', error);
	process.exit(1);
});

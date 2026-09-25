#!/usr/bin/env node

/**
 * 🔍 Environment Separation Checker
 *
 * This script checks SvelteKit's real client/server boundary:
 * - `src/lib` and `src/shared` are treated as client-safe code.
 * - Files under `src/routes` and `src/shared` must NOT import from
 *   `$lib/server/*` or the `server-only` module.
 * - SvelteKit server files (`+server.ts`, `*.server.ts`) are excluded —
 *   they run on the server by definition and may use `$lib/server`.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SRC_DIR = path.join(__dirname, '..', 'src');

// Directories to check (src/lib is treated as client-safe and is not scanned)
const ENVIRONMENTS = {
	client: path.join(SRC_DIR, 'routes'),
	shared: path.join(SRC_DIR, 'shared')
};

// Import patterns that indicate cross-environment violations.
// Files in `client` (routes) and `shared` must not reach server-only code.
const VIOLATION_PATTERNS = [
	{ from: 'client', pattern: /\$lib\/server|['"]server-only['"]/ },
	{ from: 'shared', pattern: /\$lib\/server|['"]server-only['"]/ }
];

// File extensions to check
const FILE_EXTENSIONS = ['.ts', '.js', '.svelte'];

// SvelteKit files that run on the server and may legitimately import $lib/server
const SERVER_FILE_PATTERN = /(\.server\.(ts|js)$|^\+server\.(ts|js)$)/;

function findFiles(dir, extensions = []) {
	const files = [];

	if (!fs.existsSync(dir)) return files;

	const items = fs.readdirSync(dir);

	for (const item of items) {
		const fullPath = path.join(dir, item);
		const stat = fs.statSync(fullPath);

		if (stat.isDirectory()) {
			files.push(...findFiles(fullPath, extensions));
		} else if (stat.isFile() && extensions.some((ext) => item.endsWith(ext))) {
			files.push(fullPath);
		}
	}

	return files;
}

function checkFileForViolations(filePath, environment) {
	// Skip SvelteKit server files — they are allowed to import $lib/server
	if (SERVER_FILE_PATTERN.test(path.basename(filePath))) return [];

	const content = fs.readFileSync(filePath, 'utf8');
	const violations = [];

	for (const pattern of VIOLATION_PATTERNS) {
		if (pattern.from === environment) {
			const regex = new RegExp(pattern.pattern.source, 'g');
			let match;
			while ((match = regex.exec(content)) !== null) {
				violations.push({
					type: 'cross-environment-import',
					message: `${environment} code importing server-only module`,
					match: match[0],
					line: content.substring(0, match.index).split('\n').length
				});
			}
		}
	}

	return violations;
}

function main() {
	console.log('🔍 Checking environment separation...\n');

	let totalViolations = 0;
	let filesChecked = 0;

	for (const [env, envPath] of Object.entries(ENVIRONMENTS)) {
		if (!fs.existsSync(envPath)) {
			console.log(`⚠️  ${env.toUpperCase()} directory not found: ${envPath}`);
			continue;
		}

		console.log(`📁 Checking ${env.toUpperCase()} environment...`);
		const files = findFiles(envPath, FILE_EXTENSIONS);
		let envViolations = 0;

		for (const file of files) {
			const relativePath = path.relative(SRC_DIR, file);
			const violations = checkFileForViolations(file, env);

			if (violations.length > 0) {
				console.log(`  ❌ ${relativePath}:`);
				for (const violation of violations) {
					console.log(`     - ${violation.message} (line ~${violation.line})`);
					console.log(`       Found: ${violation.match}`);
				}
				envViolations += violations.length;
			}

			filesChecked++;
		}

		if (envViolations === 0) {
			console.log(`  ✅ No violations found in ${env} environment`);
		} else {
			console.log(`  ❌ Found ${envViolations} violations in ${env} environment`);
		}

		totalViolations += envViolations;
		console.log('');
	}

	// Summary
	console.log('📊 Summary:');
	console.log(`  Files checked: ${filesChecked}`);
	console.log(`  Total violations: ${totalViolations}`);

	if (totalViolations === 0) {
		console.log('\n🎉 All environments are properly separated!');
		process.exit(0);
	} else {
		console.log('\n❌ Environment separation violations found!');
		console.log('Please fix these violations to maintain proper code separation.');
		process.exit(1);
	}
}

// Run the check
main().catch((error) => {
	console.error('❌ Error during environment separation check:', error);
	process.exit(1);
});

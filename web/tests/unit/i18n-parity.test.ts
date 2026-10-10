import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Every locale must carry the full en.json key set — new features ship
// translated or the fallback leaks English mid-sentence (this exact gap hit
// the running mode + Immich picker keys). The reference set is en.json.

const messagesDir = resolve(process.cwd(), 'static/messages');

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
	const keys: string[] = [];
	for (const [k, v] of Object.entries(obj)) {
		const path = prefix ? `${prefix}.${k}` : k;
		if (v && typeof v === 'object') keys.push(...flatten(v as Record<string, unknown>, path));
		else keys.push(path);
	}
	return keys;
}

const en = JSON.parse(readFileSync(resolve(messagesDir, 'en.json'), 'utf8'));
const enKeys = new Set(flatten(en));
const locales = readdirSync(messagesDir).filter((f) => /^\w\w\.json$/.test(f) && f !== 'en.json');

describe('i18n locale key parity', () => {
	test.each(locales)('%s carries the full en.json key set', (file) => {
		const locale = JSON.parse(readFileSync(resolve(messagesDir, file), 'utf8'));
		const keys = new Set(flatten(locale));
		const missing = [...enKeys].filter((k) => !keys.has(k));
		expect(missing, `${file} is missing: ${missing.join(', ')}`).toEqual([]);
	});

	test('no locale invents keys that en.json does not have', () => {
		for (const file of locales) {
			const locale = JSON.parse(readFileSync(resolve(messagesDir, file), 'utf8'));
			const extra = flatten(locale).filter((k) => !enKeys.has(k));
			expect(extra, `${file} has stale keys: ${extra.join(', ')}`).toEqual([]);
		}
	});
});

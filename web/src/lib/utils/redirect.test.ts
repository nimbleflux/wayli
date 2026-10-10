import { describe, it, expect } from 'vitest';

import { safeRedirectTo } from './redirect';

describe('safeRedirectTo', () => {
	it('allows single-rooted relative paths', () => {
		expect(safeRedirectTo('/dashboard', '/home')).toBe('/dashboard');
		expect(safeRedirectTo('/dashboard/account-settings?onboarding=true', '/home')).toBe(
			'/dashboard/account-settings?onboarding=true'
		);
	});

	it('falls back on empty or missing values', () => {
		expect(safeRedirectTo(null, '/home')).toBe('/home');
		expect(safeRedirectTo('', '/home')).toBe('/home');
		expect(safeRedirectTo('   ', '/home')).toBe('/home');
	});

	it('rejects absolute URLs and protocol relatives', () => {
		expect(safeRedirectTo('https://evil.example/phish', '/home')).toBe('/home');
		expect(safeRedirectTo('http://evil.example', '/home')).toBe('/home');
		expect(safeRedirectTo('//evil.example', '/home')).toBe('/home');
		expect(safeRedirectTo('//\\evil.example', '/home')).toBe('/home');
	});

	it('rejects backslash tricks', () => {
		expect(safeRedirectTo('/\\evil.example', '/home')).toBe('/home');
	});

	it('allows odd same-origin paths — they are just 404s, not cross-origin', () => {
		// A path is same-origin by construction; SvelteKit renders a 404 for
		// unknown routes. Only leaving the origin is the threat.
		expect(safeRedirectTo('/javascript:alert(1)', '/home')).toBe('/javascript:alert(1)');
	});
});

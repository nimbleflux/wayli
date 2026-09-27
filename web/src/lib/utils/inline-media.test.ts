// Unit tests for the media-reference resolution contract (inline-media.ts).
// Covers the three stored ref forms (absolute URL, host-relative API path,
// bare bucket path) plus the healing of host-stripped Pexels CDN URLs left
// behind by the pre-2.7.1 host-rename repair.

import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/fluxbase', () => ({
	fluxbase: {
		storage: {
			from: () => ({
				getPublicUrl: (path: string) => ({
					data: { publicUrl: `https://flux.test/api/v1/storage/trip-images/${path}` }
				})
			})
		}
	}
}));

vi.mock('$lib/config', () => ({
	config: { fluxbaseUrl: 'https://flux.test' }
}));

import { storageRefToUrl, mediaToken, inlineMediaRefs } from './inline-media';

describe('storageRefToUrl', () => {
	it('passes absolute URLs through unchanged', () => {
		const url = 'https://images.pexels.com/photos/7582234/pexels-photo-7582234.jpeg?h=650&w=940';
		expect(storageRefToUrl(url)).toBe(url);
	});

	it('prepends only the base URL to host-relative API paths', () => {
		expect(storageRefToUrl('/api/v1/storage/trip-images/user/trip/img.jpg')).toBe(
			'https://flux.test/api/v1/storage/trip-images/user/trip/img.jpg'
		);
	});

	it('heals host-stripped Pexels CDN URLs', () => {
		expect(
			storageRefToUrl(
				'/photos/7582234/pexels-photo-7582234.jpeg?auto=compress&cs=tinysrgb&h=650&w=940'
			)
		).toBe(
			'https://images.pexels.com/photos/7582234/pexels-photo-7582234.jpeg?auto=compress&cs=tinysrgb&h=650&w=940'
		);
	});

	it('heals old-style Pexels paths with descriptive names', () => {
		expect(storageRefToUrl('/photos/2363/france-landmark-lights-night.jpg?auto=compress')).toBe(
			'https://images.pexels.com/photos/2363/france-landmark-lights-night.jpg?auto=compress'
		);
	});

	it('is idempotent for healed refs (absolute form passes through)', () => {
		const healed = storageRefToUrl('/photos/7582234/pexels-photo-7582234.jpeg');
		expect(storageRefToUrl(healed)).toBe(healed);
	});

	it('does not heal bucket paths that merely contain /photos/ deep in the key', () => {
		expect(storageRefToUrl('user/trip/photos/img.jpg')).toBe(
			'https://flux.test/api/v1/storage/trip-images/user/trip/photos/img.jpg'
		);
	});

	it('resolves bare bucket paths via getPublicUrl', () => {
		expect(storageRefToUrl('user-id/trip-id/img.jpg')).toBe(
			'https://flux.test/api/v1/storage/trip-images/user-id/trip-id/img.jpg'
		);
	});

	it('returns empty string for empty refs', () => {
		expect(storageRefToUrl('')).toBe('');
	});
});

describe('mediaToken / inlineMediaRefs round-trip', () => {
	it('round-trips a ref containing parentheses', () => {
		const ref = '/photos/1/pexels-(1).jpeg';
		const refs = inlineMediaRefs(mediaToken(ref, 'cap'));
		expect([...refs]).toEqual([ref]);
	});
});

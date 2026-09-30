// Deno tests for the Immich API client service (#13).
// Run: deno test --no-lock --no-check --sloppy-imports fluxbase/jobs/_shared/services/external/immich.service.test.ts

import assert from 'node:assert/strict';
const { test, mock } = await import('node:test');

const { resolveImmichBase, fetchGeotaggedAssets, testConnection } = await import(
	'./immich.service.ts'
);

const BASE = 'http://immich.local:2283';
const KEY = 'secret-api-key-value';

// Mock global fetch; each handler is [matchUrlPrefix, responseFactory]
let fetchCalls: Array<{ url: string; init: any }> = [];
let responders: Array<(url: string, init: any) => any> = [];

function installFetch() {
	const fake = async (url: any, init?: any) => {
		const urlStr = String(url);
		fetchCalls.push({ url: urlStr, init });
		for (const r of responders) {
			const out = r(urlStr, init);
			if (out) return out;
		}
		return { ok: false, status: 404, text: async () => 'not found', json: async () => ({}) };
	};
	// deno-lint-ignore no-explicit-any
	(globalThis as any).fetch = fake;
}

test('resolveImmichBase trims trailing slashes and rejects bad input', () => {
	assert.equal(resolveImmichBase('http://immich:2283/', null), 'http://immich:2283');
	assert.equal(resolveImmichBase(undefined, 'http://default'), 'http://default');
	assert.equal(resolveImmichBase('   ', null), null);
	assert.equal(resolveImmichBase(undefined, null), null);
	assert.equal(resolveImmichBase('immich:2283', null), null); // no protocol
});

test('fetchGeotaggedAssets posts search/metadata with exif + takenAfter and filters', async () => {
	installFetch();
	responders = [
		(url, init) => {
			if (!url.includes('/api/search/metadata')) return null;
			const body = JSON.parse(init.body);
			// Immich reads the POST body ONLY (its route has no @Query params):
			// page/size must be real numbers in the body, dates strings, and the
			// URL must not carry query params (they are silently ignored).
			assert.equal(body.page, 1);
			assert.equal(body.size, 250);
			assert.equal(body.withExif, true);
			assert.equal(body.takenAfter, '2026-09-01T00:00:00Z');
			assert.ok(!url.includes('?'), 'search/metadata URL must not carry query params');
			return {
				ok: true,
				status: 200,
				json: async () => ({
					assets: {
						items: [
							{
								id: 'a1',
								exifInfo: {
									latitude: -35.04,
									longitude: 150.67,
									dateTimeOriginal: '2026-09-05T10:00:00.000Z',
									city: 'Huskisson',
									state: 'NSW',
									country: 'Australia'
								}
							},
							{ id: 'a2', exifInfo: { latitude: null, longitude: null } }, // no GPS → filtered
							{ id: 'a3', exifInfo: { latitude: 1, longitude: 2 } } // no takenAt → filtered
						],
						nextPage: null
					}
				})
			};
		}
	];
	const result = await fetchGeotaggedAssets(BASE, KEY, { takenAfter: '2026-09-01T00:00:00Z' });
	assert.equal(result.assets.length, 1);
	assert.equal(result.assets[0].id, 'a1');
	assert.equal(result.assets[0].city, 'Huskisson');
	// auth header + no key in URL
	assert.equal(fetchCalls[0].init.headers['x-api-key'], KEY);
	assert.ok(!fetchCalls[0].url.includes(KEY));
});

	test('fetchGeotaggedAssets paginates until nextPage is absent', async () => {
		installFetch();
		let call = 0;
		responders = [
			(url, init) => {
				if (!url.includes('/api/search/metadata')) return null;
				call++;
				const body = JSON.parse(init.body);
				// Pagination also travels in the body — numeric and 1-based.
				assert.equal(body.page, call);
				assert.equal(typeof body.size, 'number');
				return {
					ok: true,
					status: 200,
					json: async () => ({
						assets: {
							items: [
								{
									id: `p${call}`,
									exifInfo: { latitude: 1, longitude: 2, dateTimeOriginal: '2026-01-0' + call + 'T00:00:00Z' }
								}
							],
							nextPage: call < 3 ? call + 1 : null
						}
					})
				};
			}
		];
		const result = await fetchGeotaggedAssets(BASE, KEY, {});
		assert.equal(call, 3);
		assert.deepEqual(result.assets.map((a: any) => a.id), ['p1', 'p2', 'p3']);
	});

test('permission/auth errors are classified and never echo the key', async () => {
	installFetch();
	responders = [
		(url, init) => {
			if (!url.includes('/api/search/metadata')) return null;
			return {
				ok: false,
				status: 403,
				text: async () => `Missing required permission for api key ${KEY}`
			};
		}
	];
	const result = await fetchGeotaggedAssets(BASE, KEY, {});
	assert.equal(result.errorKind, 'permission');
	assert.ok(!JSON.stringify(result).includes(KEY), 'key must not leak into the result');
	assert.ok(!String(result.error).includes(KEY), 'error message must not contain the key');

	responders = [
		(url, init) => {
			if (!url.includes('/api/search/metadata')) return null;
			return { ok: false, status: 401, text: async () => `invalid key ${KEY}` };
		}
	];
	const r2 = await fetchGeotaggedAssets(BASE, KEY, {});
	assert.equal(r2.errorKind, 'auth');
	assert.ok(!String(r2.error).includes(KEY));

	responders = [
		(url, init) => {
			if (!url.includes('/api/search/metadata')) return null;
			return { ok: false, status: 500, text: async () => 'boom' };
		}
	];
	const r3 = await fetchGeotaggedAssets(BASE, KEY, {});
	assert.equal(r3.errorKind, 'other');
});

test('testConnection classifies ok / permission / auth', async () => {
	installFetch();
	responders = [
		(url) => {
			if (!url.includes('/api/users/me')) return null;
			return {
				ok: true,
				status: 200,
				json: async () => ({ name: 'Bart', email: 'bart@example.com' })
			};
		}
	];
	const ok = await testConnection(BASE, KEY);
	assert.equal(ok.ok, true);
	assert.equal(ok.user, 'Bart');

	responders = [
		(url) => {
			if (!url.includes('/api/users/me')) return null;
			return { ok: false, status: 403, text: async () => 'missing permission' };
		}
	];
	const perm = await testConnection(BASE, KEY);
	assert.equal(perm.ok, false);
	assert.equal(perm.errorKind, 'permission');
	assert.ok(!String(perm.error).includes(KEY));
});

// node:test mock helper shim (node:test's mock.fn isn't used; keep import used)
void mock;
void fetchCalls;

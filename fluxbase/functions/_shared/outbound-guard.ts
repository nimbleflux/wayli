/**
 * Outbound-fetch guard for edge functions that fetch user-influenced URLs
 * (#262). Two threat levels:
 *
 * - `assertPublicHttpUrl` — the target is ARBITRARY user input (e.g. a link
 *   to preview). Refuse anything that is not a publicly-routable http(s)
 *   address, and keep validating across redirects (capped).
 * - `assertNotMetadataTarget` — the target is a user-CONFIGURED server URL
 *   that may legitimately live on a private network (self-hosted Immich on
 *   the LAN, or next to the Fluxbase container). Block only the never-
 *   legitimate targets: cloud-metadata endpoints and their hostnames.
 */

const BLOCKED_V4_STRICT = [
	/^0\./, // "this" network
	/^10\./, // private
	/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT
	/^127\./, // loopback
	/^169\.254\./, // link-local (cloud metadata)
	/^172\.(1[6-9]|2\d|3[01])\./, // private
	/^192\.0\.0\./, // IETF protocol assignments
	/^192\.168\./, // private
	/^198\.(1[8-9])\./, // benchmarking
	/^22[4-9]\./, /^2[3-5]\d\./ // multicast + reserved
];

const BLOCKED_HOSTNAMES_STRICT = new Set(['localhost', 'metadata.google.internal', 'metadata']);

function isStrictPrivateV4(addr: string): boolean {
	return BLOCKED_V4_STRICT.some((re) => re.test(addr));
}

function isMetadataV4(addr: string): boolean {
	return /^169\.254\./.test(addr) || /^127\./.test(addr);
}

function isMetadataHostname(hostname: string): boolean {
	const h = hostname.toLowerCase();
	return h === 'metadata.google.internal' || h === 'metadata';
}

function isMetadataV6(addr: string): boolean {
	const a = addr.toLowerCase();
	return a === '::' || a === '::1' || a.startsWith('fe80:');
}

function v6PrefixSuspicious(addr: string): boolean {
	const a = addr.toLowerCase();
	return (
		a.startsWith('fc') ||
		a.startsWith('fd') ||
		a.startsWith('::ffff:127.') ||
		a.startsWith('64:ff9b:1:')
	);
}

function resolveV4(hostname: string): Promise<string[]> {
	if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return Promise.resolve([hostname]);
	return Deno.resolveDns(hostname, 'A').catch(() => []);
}

/** Strict: http(s) + every resolved address publicly routable. */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error('Invalid URL');
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new Error('Unsupported scheme');
	}
	if (BLOCKED_HOSTNAMES_STRICT.has(url.hostname)) {
		throw new Error('Blocked host');
	}
	const addrs = await resolveV4(url.hostname);
	if (addrs.length === 0) throw new Error('Unresolvable host');
	for (const addr of addrs) {
		if (isStrictPrivateV4(addr)) throw new Error('Blocked address');
	}
	return url;
}

/** Loose: refuse only cloud-metadata endpoints and their hostnames. */
export async function assertNotMetadataTarget(raw: string): Promise<URL> {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error('Invalid URL');
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new Error('Unsupported scheme');
	}
	if (isMetadataHostname(url.hostname)) {
		throw new Error('Blocked host');
	}
	const addrs = await resolveV4(url.hostname);
	for (const addr of addrs) {
		if (isMetadataV4(addr) || isMetadataV6(addr) || v6PrefixSuspicious(addr)) {
			throw new Error('Blocked address');
		}
	}
	return url;
}

/**
 * fetch() that re-validates each redirect hop with the given validator
 * (max 3 hops).
 */
export async function guardedFetch(
	raw: string,
	validate: (url: string) => Promise<URL>,
	init?: RequestInit
): Promise<Response> {
	let url = await validate(raw);
	for (let hop = 0; hop < 3; hop++) {
		const response = await fetch(url, { ...init, redirect: 'manual' });
		if (response.status < 300 || response.status >= 400) return response;
		const location = response.headers.get('location');
		if (!location) return response;
		url = await validate(new URL(location, url).toString());
	}
	throw new Error('Too many redirects');
}

/**
 * Signed media URLs for the private trip-images bucket (signed-media
 * migration, #265). Once the bucket flips private, public URLs 404 — every
 * render path must resolve storage refs to short-lived signed URLs instead.
 *
 * `extractObjectPath` handles every stored shape (bare path, host-relative
 * `/api/v1/storage/trip-images/…`, absolute URL of either form); absolute
 * EXTERNAL URLs pass through untouched.
 *
 * Signing is a network call, so results are cached per object path for the
 * session. Prefer resolving once per data load (batch the refs) rather than
 * per render tick.
 */

import { fluxbase } from '$lib/fluxbase';

const TTL_SECONDS = 3600;
/** signed URL → refetch slightly before expiry keeps long-lived pages working. */
const cache = new Map<string, { url: string; expiresAt: number }>();

/** Pull the bucket object path out of any stored trip-images reference. */
export function extractObjectPath(ref: string): string | null {
	if (!ref) return null;
	if (/^https?:\/\//i.test(ref)) {
		const marker = '/storage/trip-images/';
		const idx = ref.indexOf(marker);
		if (idx === -1) return null; // external URL (Pexels CDN, …) — not ours to sign
		return ref.slice(idx + marker.length).split('?')[0];
	}
	if (ref.startsWith('/api/v1/storage/trip-images/')) {
		return ref.slice('/api/v1/storage/trip-images/'.length).split('?')[0];
	}
	// Legacy bare path / host-rename-repair residue: any non-absolute,
	// non-reserved ref is treated as a bucket path. External hotlinks never
	// reach this branch (they are absolute).
	if (ref.startsWith('/photos/')) return null; // Pexels CDN passthrough
	return ref;
}

/**
 * Resolve a stored reference to a loadable URL. External URLs pass through;
 * trip-images refs return a signed URL (cached, re-signed before expiry).
 * Unresolvable refs return ''.
 */
export async function signedMediaUrl(ref: string): Promise<string> {
	if (!ref) return '';
	const path = extractObjectPath(ref);
	if (path === null) return ref; // external passthrough
	if (/^https?:\/\//i.test(ref)) return ref; // absolute external URL

	const cached = cache.get(path);
	if (cached && cached.expiresAt > Date.now()) return cached.url;

	try {
		const { data, error } = await fluxbase.storage
			.from('trip-images')
			.createSignedUrl(path, { expiresIn: TTL_SECONDS });
		if (error || !data?.signedUrl) return '';
		cache.set(path, { url: data.signedUrl, expiresAt: Date.now() + (TTL_SECONDS - 60) * 1000 });
		return data.signedUrl;
	} catch {
		return '';
	}
}

/** Resolve a batch of refs → map from ref to URL (missing entries failed). */
export async function signedMediaUrls(refs: string[]): Promise<Map<string, string>> {
	const resolved = await Promise.all(
		[...new Set(refs)].map(async (ref) => [ref, await signedMediaUrl(ref)] as const)
	);
	return new Map(resolved.filter(([, url]) => url !== ''));
}

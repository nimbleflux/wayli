/**
 * Inline image tokens embedded in entry bodies (markdown image syntax), so
 * photos can sit BETWEEN paragraphs instead of only in the bottom gallery.
 *
 * Form: `![caption](wayli-media:<ref>)` where `<ref>` is whatever the writing
 * platform stores in `trip_media.storage_path` — the full public URL (web
 * uploads) or the raw bucket path (Android uploads, resolved to a signed URL
 * client-side). Renderers strip the `wayli-media:` prefix and turn the ref
 * into a loadable URL before passing the body through the markdown renderer
 * (which already draws `![…](…)` images).
 */

import { fluxbase } from '$lib/fluxbase';

const MEDIA_TOKEN = /!\[([^\]]*)\]\(wayli-media:([^)\s]+)\)/g;

/** Parentheses would end the markdown link early — percent-encode them. */
function encodeRef(ref: string): string {
	return ref.replaceAll('(', '%28').replaceAll(')', '%29');
}

/** Build an inline image token for a stored media reference. */
export function mediaToken(ref: string, caption = 'photo'): string {
	return `![${caption}](wayli-media:${encodeRef(ref)})`;
}

/** Decode a token reference back to the raw storage path / URL form. */
function decodeRef(ref: string): string {
	try {
		return decodeURIComponent(ref);
	} catch {
		return ref;
	}
}

/**
 * Storage references currently placed inline in a body — compare against
 * `trip_media.storage_path` to keep those photos out of the bottom gallery.
 */
export function inlineMediaRefs(body?: string | null): Set<string> {
	if (!body) return new Set();
	const refs = new Set<string>();
	for (const match of body.matchAll(MEDIA_TOKEN)) {
		refs.add(decodeRef(match[2]));
	}
	return refs;
}

/**
 * A raw bucket path becomes its public URL (the trip-images bucket is
 * public-read); absolute URLs pass through unchanged.
 */
export function storageRefToUrl(ref: string): string {
	if (!ref) return '';
	if (/^https?:\/\//i.test(ref)) return ref;
	const { data } = fluxbase.storage.from('trip-images').getPublicUrl(ref);
	return data.publicUrl;
}

/**
 * Replace every inline token with a plain markdown image whose destination is
 * a loadable URL. Unresolvable refs are dropped rather than rendered broken.
 */
export function resolveInlineMedia(body?: string | null): string {
	if (!body) return '';
	return body.replace(MEDIA_TOKEN, (_m, caption: string, ref: string) => {
		return `![${caption}](${storageRefToUrl(decodeRef(ref))})`;
	});
}

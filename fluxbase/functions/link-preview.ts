/**
 * Link Preview Edge Function
 * Fetches Open Graph / Twitter Card metadata from a URL.
 * Returns: { title, description, image, site_name, url, rating? }
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:allow-net true
 * @fluxbase:timeout 10
 */

interface LinkPreview {
	title: string | null;
	description: string | null;
	image: string | null;
	site_name: string | null;
	url: string;
	rating: string | null;
}

import { assertPublicHttpUrl, guardedFetch } from './_shared/outbound-guard.ts';

function extractMeta(html: string, property: string): string | null {
	let match = html.match(
		new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i')
	);
	if (match) return match[1].trim();
	match = html.match(
		new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`, 'i')
	);
	if (match) return match[1].trim();
	return null;
}

function extractRating(html: string): string | null {
	const jsonLdMatch = html.match(
		/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i
	);
	if (jsonLdMatch) {
		try {
			const data = JSON.parse(jsonLdMatch[1].trim());
			const rating = data.aggregateRating?.ratingValue || data.rating?.ratingValue;
			if (rating) return String(rating);
		} catch {}
	}
	return extractMeta(html, 'rating:value') || extractMeta(html, 'rating');
}

export default async function handler(req: Request): Promise<Response> {
	let url: string;
	try {
		const body = await req.json();
		url = body.url;
	} catch {
		const u = new URL(req.url);
		url = u.searchParams.get('url') || '';
	}

	if (!url || !url.startsWith('http')) {
		return new Response(JSON.stringify({ error: 'Invalid URL' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 8000);

		// guardedFetch validates the target (and every redirect hop) resolves
		// to public addresses — this handler fetches arbitrary user URLs.
		const resp = await guardedFetch(url, assertPublicHttpUrl, {
			headers: { 'User-Agent': 'Wayli/1.0 (Link Preview Bot)', Accept: 'text/html' },
			signal: controller.signal
		});
		clearTimeout(timeout);

		if (!resp.ok) {
			return new Response(JSON.stringify({ error: `Fetch failed: ${resp.status}` }), {
				status: 502,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		const html = await resp.text();
		const headEnd = html.indexOf('</head>');
		const head = headEnd > 0 ? html.substring(0, headEnd) : html.substring(0, 10000);

		const preview: LinkPreview = {
			title: extractMeta(head, 'og:title') || extractMeta(head, 'twitter:title'),
			description:
				extractMeta(head, 'og:description') ||
				extractMeta(head, 'twitter:description') ||
				extractMeta(head, 'description'),
			image: extractMeta(head, 'og:image') || extractMeta(head, 'twitter:image'),
			site_name: extractMeta(head, 'og:site_name'),
			url,
			rating: extractRating(html)
		};

		if (!preview.title) {
			const titleMatch = head.match(/<title[^>]*>([^<]+)<\/title>/i);
			if (titleMatch) preview.title = titleMatch[1].trim();
		}

		return new Response(JSON.stringify(preview), {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch {
		return new Response(JSON.stringify({ error: 'Failed to fetch' }), {
			status: 502,
			headers: { 'Content-Type': 'application/json' }
		});
	}
}

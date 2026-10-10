/**
 * Shared markdown rendering utility.
 *
 * Renders markdown to sanitized HTML via `marked` + `DOMPurify`.
 * Used by the chat layer and the travel journal (trip entries).
 */

import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Configure marked once (GitHub-flavored line breaks, no async).
marked.setOptions({
	gfm: true,
	breaks: true,
	async: false
});

/**
 * Render markdown to sanitized HTML.
 *
 * @param content  - Raw markdown source.
 * @param stripImages - Remove markdown image syntax before rendering (chat uses this
 *                      because images are shown in separate cards).
 * @returns Sanitized HTML string (safe for `{@html ...}`).
 */
export function renderMarkdown(content: string, stripImages: boolean = false): string {
	if (!content) return '';
	try {
		let processed = content;

		if (stripImages) {
			processed = processed.replace(/(?:Image:\s*)?!\[([^\]]*)\]\([^)]+\)/gi, '');
			processed = processed.replace(/^(?:Image|Photo|Picture|Cover):\s*$/gim, '');
			processed = processed.replace(/^[\t ]*[-*]\s*$/gm, '');
			processed = processed.replace(/^[\t ]*\d+\.\s*$/gm, '');
			processed = processed.replace(/\n{3,}/g, '\n\n').trim();
		}

		const html = marked.parse(processed, { async: false }) as string;
		return DOMPurify.sanitize(html);
	} catch {
		// Fail closed: never hand unsanitized input to {@html} sinks. Escape
		// instead so the text still renders if the pipeline ever throws.
		return content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}
}

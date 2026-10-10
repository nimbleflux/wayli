import { describe, it, expect, vi } from 'vitest';

// Force the rendering pipeline to throw so the failure path is exercised.
vi.mock('marked', () => ({
	marked: {
		setOptions: vi.fn(),
		parse: vi.fn(() => {
			throw new Error('rendering exploded');
		})
	}
}));

// Pass-through sanitizer: the unit under test is the failure fallback, which
// must return ESCAPED text — assertions below check for entities, not tags.
vi.mock('dompurify', () => ({
	default: { sanitize: (html: string) => html }
}));

import { renderMarkdown } from './markdown';

describe('renderMarkdown failure handling', () => {
	it('fails closed — escapes markup instead of returning raw input', () => {
		const out = renderMarkdown('<img src=x onerror=alert(1)>hello');
		expect(out).not.toContain('<img');
		expect(out).toContain('&lt;img');
		expect(out).toContain('hello');
	});

	it('escapes closing tags too', () => {
		const out = renderMarkdown('</script>bye');
		expect(out).not.toContain('</script>');
		expect(out).toContain('&lt;/script&gt;');
		expect(out).toContain('bye');
	});
});

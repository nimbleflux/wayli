import { test, expect } from '@playwright/test';

test('TripMap + ImmichPhotoStrip rapid mount/unmount should not crash', async ({ page }) => {
	const consoleErrors: string[] = [];
	const consoleWarnings: string[] = [];

	page.on('console', (msg) => {
		if (msg.type() === 'error') consoleErrors.push(msg.text());
		if (msg.type() === 'warning') consoleWarnings.push(msg.text());
	});
	page.on('pageerror', (err) => consoleErrors.push(`PAGE ERROR: ${err.message}`));

	await page.goto('http://localhost:5174/test-tripmap', { waitUntil: 'networkidle' });

	// Wait for the maps to mount + the ImmichPhotoStrip components to load
	await page.waitForTimeout(3000);

	// Toggle all trips to force destroy + remount
	await page.click('button:has-text("Toggle all trips")');
	await page.waitForTimeout(2000);

	// Toggle back
	await page.click('button:has-text("Toggle all trips")');
	await page.waitForTimeout(2000);

	// Check for the specific crash errors
	const crashErrors = consoleErrors.filter(
		(e) =>
			e.includes('Map container not found') ||
			e.includes('Invalid LatLng') ||
			e.includes('invalid date') ||
			e.includes('_glMap is undefined') ||
			e.includes('WebGL context was lost')
	);

	expect(crashErrors).toEqual([]);
	expect(consoleErrors.filter((e) => e.includes('PAGE ERROR'))).toEqual([]);

	// The page should still be rendered (not crashed/unmounted)
	await expect(page.locator('h1')).toContainText('TripMap');
});

import { chromium } from 'playwright';

// Reproduces the exact user-reported crash: open the Travel page as a user
// with a trip + entries (some with dates that crash the old code), expand the
// trip, and assert none of the reported errors occur.
//
// Prereqs: dev server on :5174, test user test-crash@wayli.dev / TestCrash123!
// with trip "Crash Test Trip" containing entries (created via psql).

const BASE = 'http://localhost:5174';
const consoleErrors = [];
const pageErrors = [];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', (m) => {
	if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => pageErrors.push(`${e.name}: ${e.message}`));

// 1. Sign in
await page.goto(`${BASE}/auth/signin`, { waitUntil: 'networkidle' });
await page.locator('input[type="email"], input[name="email"]').first().fill('test-crash@wayli.dev');
await page.locator('input[type="password"]').first().fill('TestCrash123!');
await page.locator('button[type="submit"]').first().click();
await page.waitForURL(/dashboard|travel/, { timeout: 15000 }).catch(() => {});
console.log('after login:', page.url());

// 2. Travel page
await page.goto(`${BASE}/dashboard/travel`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// 3. Expand the trip (click the card/title)
const trip = page.locator('text=Crash Test Trip').first();
if (await trip.isVisible({ timeout: 5000 }).catch(() => false)) {
	await trip.click();
	await page.waitForTimeout(2500); // allow maps + strips to mount
	// toggle a few times to stress the mount/unmount path
	for (let i = 0; i < 2; i++) {
		await trip.click().catch(() => {});
		await page.waitForTimeout(400);
	}
	await page.waitForTimeout(1500);
	console.log('trip expanded');
} else {
	console.log('WARN: trip card not found');
}

// 4. Also exercise the location-data map (TripMap instance)
await page.goto(`${BASE}/dashboard/location-data`, { waitUntil: 'networkidle' }).catch(() => {});
await page.waitForTimeout(2000);

// 5. Verdict — the exact errors from the user's logs
const patterns = [
	'Map container not found',
	'Invalid LatLng',
	'invalid date',
	'RangeError',
	'_glMap is undefined',
	'WebGL context was lost',
	'DOMException',
	'Node.removeChild'
];
const crashes = [...consoleErrors, ...pageErrors].filter((e) =>
	patterns.some((p) => e.includes(p))
);

console.log(`console errors: ${consoleErrors.length}`);
console.log(`page errors: ${pageErrors.length}`);
console.log(`crash-specific: ${crashes.length}`);
crashes.slice(0, 5).forEach((e) => console.log('  CRASH:', e.slice(0, 160)));
pageErrors.slice(0, 5).forEach((e) => console.log('  PAGE :', e));

await browser.close();
if (crashes.length > 0) {
	console.log('RESULT: FAIL');
	process.exit(1);
}
console.log('RESULT: PASS — none of the reported crash errors occurred');

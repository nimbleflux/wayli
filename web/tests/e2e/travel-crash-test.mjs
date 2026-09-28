import { chromium } from 'playwright';

const errors = [];
const pageErrors = [];

const FLUXBASE_URL = 'http://localhost:5174';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', (err) => pageErrors.push(`${err.name}: ${err.message}`));

// 1. Login
console.log('1. Logging in...');
await page.goto(`${FLUXBASE_URL}/auth/signin`, { waitUntil: 'networkidle' });
await page.locator('input[type="email"]').first().fill('test-crash@wayli.dev');
await page.locator('input[type="password"]').first().fill('TestCrash123!');
await page.locator('button[type="submit"], button:has-text("Sign in")').first().click();
await page.waitForTimeout(3000);
console.log('   URL after login:', page.url());

// 2. Navigate to travel page
console.log('2. Loading travel page...');
await page.goto(`${FLUXBASE_URL}/dashboard/travel`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// 3. Open a trip with entries
console.log('3. Opening trip...');
const tripTitle = page.locator('text=Crash Test Trip').first();
if (await tripTitle.isVisible({ timeout: 5000 }).catch(() => false)) {
  await tripTitle.click();
  await page.waitForTimeout(3000);
}

// 4. Screenshot
await page.screenshot({ path: '/tmp/travel_page_test.png', fullPage: true });

// 5. Report
const crashPatterns = [
  'Map container not found',
  'Invalid LatLng',
  'invalid date',
  'RangeError',
  '_glMap is undefined',
  'WebGL context was lost',
  'DOMException',
  'Node.removeChild',
];
const crashErrors = errors.filter((e) => crashPatterns.some((p) => e.includes(p)));

console.log(`\n=== RESULTS ===`);
console.log(`Console errors: ${errors.length}`);
console.log(`Page errors: ${pageErrors.length}`);
console.log(`Crash-specific: ${crashErrors.length}`);
if (crashErrors.length > 0) {
  crashErrors.forEach((e) => console.log('  CRASH:', e.slice(0, 150)));
  process.exit(1);
} else {
  console.log('✅ No crash errors');
}

await browser.close();

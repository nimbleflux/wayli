import { chromium } from 'playwright';

const errors = [];
const warnings = [];

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
  if (msg.type() === 'warning') warnings.push(msg.text());
});
page.on('pageerror', (err) => errors.push(`PAGE ERROR: ${err.message}`));

await page.goto('http://localhost:5174/test-tripmap', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

const toggle = page.locator('button:has-text("Toggle all trips")');
if (await toggle.isVisible()) {
  await toggle.click();
  await page.waitForTimeout(2000);
  await toggle.click();
  await page.waitForTimeout(2000);
}

const crash = errors.filter(
  (e) => e.includes('Map container') || e.includes('Invalid LatLng') ||
         e.includes('invalid date') || e.includes('_glMap') || e.includes('WebGL')
);
console.log(`Console errors: ${errors.length}, warnings: ${warnings.length}`);
console.log(`Crash-specific errors: ${crash.length}`);
crash.forEach((e) => console.log('  CRASH:', e.slice(0, 120)));
errors.slice(0, 5).forEach((e) => console.log('  ERR:', e.slice(0, 120)));

await browser.close();

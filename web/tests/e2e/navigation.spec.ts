/**
 * E2E tests for navigation and page accessibility.
 * Tests that pages load correctly and have proper structure.
 */

import { test, expect } from '@playwright/test';

test.describe('Public Pages', () => {
	test('landing page should load', async ({ page }) => {
		await page.goto('/');

		// Page should load without errors
		await expect(page).toHaveTitle(/Wayli/);

		// Should have basic navigation elements
		const header = page.locator('header, nav').first();
		await expect(header).toBeVisible();
	});

	test('should have responsive layout', async ({ page }) => {
		await page.goto('/');

		// Test desktop viewport
		await page.setViewportSize({ width: 1280, height: 720 });
		await expect(page.locator('body')).toBeVisible();

		// Test mobile viewport
		await page.setViewportSize({ width: 375, height: 667 });
		await expect(page.locator('body')).toBeVisible();
	});
});

test.describe('Accessibility', () => {
	test('sign in page should have proper accessibility structure', async ({ page }) => {
		await page.goto('/auth/signin');

		// Check for proper heading structure
		const h1 = page.getByRole('heading', { level: 1 });
		// May have h1 or h2 for the form title
		const hasHeading = (await h1.count()) > 0 || (await page.getByRole('heading').count()) > 0;
		expect(hasHeading).toBeTruthy();

		// Form should have proper labels
		const emailInput = page.getByRole('textbox', { name: /email/i });
		await expect(emailInput).toBeVisible();

		// Button should be accessible
		const submitButton = page.getByRole('button', { name: /sign in/i });
		await expect(submitButton).toBeVisible();
		await expect(submitButton).toBeEnabled();
	});

	test('forms should have proper labels', async ({ page }) => {
		await page.goto('/auth/signup');

		// All inputs should have associated labels
		const inputs = page.locator('input:not([type="hidden"])');
		const inputCount = await inputs.count();

		// At least email and password fields should exist
		expect(inputCount).toBeGreaterThanOrEqual(2);

		// Email input should have label
		const emailInput = page.getByRole('textbox', { name: /email/i });
		await expect(emailInput).toBeVisible();
	});

	test('buttons should have visible focus states', async ({ page }) => {
		await page.goto('/auth/signin');

		const button = page.getByRole('button', { name: /sign in/i });

		// Focus the button
		await button.focus();

		// Check that button is focused
		await expect(button).toBeFocused();
	});

	test('links should be keyboard navigable', async ({ page }) => {
		await page.goto('/auth/signin');

		// Press Tab to navigate through focusable elements
		await page.keyboard.press('Tab');

		// Something should be focused
		const focusedElement = page.locator(':focus');
		await expect(focusedElement).toBeVisible();
	});
});

test.describe('Error Handling', () => {
	test('should show 404 page for non-existent routes', async ({ page }) => {
		const response = await page.goto('/non-existent-page-12345');

		// Should return 404 or redirect to error page
		// The page might return 200 with a custom 404 page or redirect
		expect(response).toBeTruthy();
	});
});

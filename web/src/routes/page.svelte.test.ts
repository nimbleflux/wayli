import { describe, test, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

// Mock the i18n module
vi.mock('$lib/i18n', () => ({
	translate: {
		subscribe: vi.fn((fn) => {
			fn(vi.fn((key: string) => key)); // Call the callback with a translation function
			return { unsubscribe: vi.fn() };
		})
	},
	messages: {
		subscribe: vi.fn((fn) => {
			// Provide messages with actual content so messagesLoaded becomes true
			fn({
				'landing.welcomeTo': 'Welcome to',
				wayli: 'Wayli',
				wayliSubtitle: 'Your Journey Tracker',
				'landing.yourPersonalTracker': 'Your Personal Journey Tracker',
				'landing.selfHostedTagline': 'Self-hosted location tracking',
				'landing.getStarted': 'Get Started',
				'landing.lightMode': 'Light Mode',
				'landing.darkMode': 'Dark Mode',
				'landing.login': 'Login',
				'landing.dashboard': 'Dashboard',
				'landing.accountSettings': 'Account Settings',
				'landing.signOut': 'Sign Out'
			});
			return { unsubscribe: vi.fn() };
		})
	},
	currentLocale: {
		subscribe: vi.fn((fn) => {
			fn('en'); // Call the callback with 'en'
			return { unsubscribe: vi.fn() };
		})
	}
}));

// Mock stores
vi.mock('$lib/stores/app-state.svelte', () => ({
	setTheme: vi.fn(),
	initializeTheme: vi.fn()
}));

vi.mock('$lib/stores/auth', () => ({
	userStore: {
		subscribe: vi.fn((fn) => {
			fn(null); // Not logged in
			return vi.fn(); // Return unsubscribe function directly
		})
	},
	sessionStore: {
		subscribe: vi.fn((fn) => {
			fn(null);
			return vi.fn(); // Return unsubscribe function directly
		})
	}
}));

// Mock fluxbase
vi.mock('$lib/fluxbase', () => ({
	fluxbase: {
		auth: {
			signOut: vi.fn()
		},
		settings: {
			get: vi.fn().mockResolvedValue({ value: true })
		}
	}
}));

// url-utils is no longer used - removed mock

// Mock fetch to return setup complete
global.fetch = vi.fn(() =>
	Promise.resolve({
		ok: true,
		json: () => Promise.resolve({ data: { is_setup_complete: true } }),
		headers: {
			get: vi.fn().mockReturnValue(null)
		}
	})
) as any;

import Page from './+page.svelte';

describe('/+page.svelte', () => {
	test('should render page component', async () => {
		const { container } = render(Page);

		// Wait for the component to finish loading (checkSetupStatus completes)
		await waitFor(() => {
			// Check that the component renders something
			expect(container.querySelector('div')).toBeInTheDocument();
		});
	});
});

import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Setup and teardown
import { beforeEach, afterEach } from 'vitest';

// Mock environment variables
vi.stubEnv('NODE_ENV', 'test');
vi.stubEnv('FLUXBASE_BASE_URL', 'https://test.fluxbase.eu');
vi.stubEnv('FLUXBASE_ANON_KEY', 'test-anon-key');
vi.stubEnv('FLUXBASE_SERVICE_ROLE_KEY', 'test-service-role-key');
vi.stubEnv('PUBLIC_FLUXBASE_ANON_KEY', 'test-anon-key');
vi.stubEnv('SESSION_SECRET', 'test-session-secret');
vi.stubEnv('COOKIE_SECRET', 'test-cookie-secret');
vi.stubEnv('JWT_SECRET', 'test-jwt-secret');

// Mock Fluxbase client
vi.mock('$lib/fluxbase', () => ({
	fluxbase: {
		auth: {
			getUser: vi.fn(),
			getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
			signInWithPassword: vi.fn(),
			signUp: vi.fn(),
			signOut: vi.fn(),
			onAuthStateChange: vi.fn().mockImplementation((callback: any) => {
				// Immediately invoke callback in tests with a default state
				callback('SIGNED_OUT', null);
				return {
					data: { subscription: { unsubscribe: vi.fn() } },
					error: null
				} as any;
			})
		},
		from: vi.fn(() => ({
			select: vi.fn().mockReturnThis(),
			insert: vi.fn().mockReturnThis(),
			update: vi.fn().mockReturnThis(),
			delete: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			neq: vi.fn().mockReturnThis(),
			gt: vi.fn().mockReturnThis(),
			gte: vi.fn().mockReturnThis(),
			lt: vi.fn().mockReturnThis(),
			lte: vi.fn().mockReturnThis(),
			like: vi.fn().mockReturnThis(),
			ilike: vi.fn().mockReturnThis(),
			in: vi.fn().mockReturnThis(),
			not: vi.fn().mockReturnThis(),
			or: vi.fn().mockReturnThis(),
			order: vi.fn().mockReturnThis(),
			limit: vi.fn().mockReturnThis(),
			range: vi.fn().mockReturnThis(),
			single: vi.fn().mockReturnThis(),
			maybeSingle: vi.fn().mockReturnThis(),
			then: vi.fn().mockResolvedValue({ data: null, error: null })
		})),
		rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
		storage: {
			from: vi.fn(() => ({
				upload: vi.fn().mockResolvedValue({ data: null, error: null }),
				download: vi.fn().mockResolvedValue({ data: null, error: null }),
				remove: vi.fn().mockResolvedValue({ data: null, error: null }),
				getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'test-url' } })
			}))
		}
	}
}));

// Mock SvelteKit modules
vi.mock('$app/environment', () => ({
	browser: false,
	dev: false,
	building: false,
	version: 'test'
}));

// Mock i18n translate store shape to avoid store_invalid_shape
vi.mock('$lib/i18n', async () => {
	const { readable } = await import('svelte/store');
	const translateStore = readable((key: string) => key);
	return {
		translate: translateStore,
		currentLocale: readable('en'),
		getCountryNameReactive: () => 'Country'
	} as any;
});

vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	invalidate: vi.fn(),
	invalidateAll: vi.fn(),
	preloadData: vi.fn(),
	preloadCode: vi.fn()
}));

vi.mock('$app/stores', () => ({
	page: { subscribe: vi.fn() },
	navigating: { subscribe: vi.fn() },
	updated: { subscribe: vi.fn() }
}));

// Mock fetch
global.fetch = vi.fn();

// Mock localStorage
Object.defineProperty(window, 'localStorage', {
	value: {
		getItem: vi.fn(),
		setItem: vi.fn(),
		removeItem: vi.fn(),
		clear: vi.fn()
	},
	writable: true
});

// Mock sessionStorage
Object.defineProperty(window, 'sessionStorage', {
	value: {
		getItem: vi.fn(),
		setItem: vi.fn(),
		removeItem: vi.fn(),
		clear: vi.fn()
	},
	writable: true
});

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
	observe: vi.fn(),
	unobserve: vi.fn(),
	disconnect: vi.fn()
}));

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
	observe: vi.fn(),
	unobserve: vi.fn(),
	disconnect: vi.fn()
}));

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
	writable: true,
	value: vi.fn().mockImplementation((query) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn()
	}))
});

// Mock crypto for UUID generation
Object.defineProperty(global, 'crypto', {
	value: {
		randomUUID: vi.fn(() => 'test-uuid')
	}
});

// Test utilities
export const createMockUser = (overrides = {}) => ({
	id: 'test-user-id',
	email: 'test@example.com',
	first_name: 'Test',
	last_name: 'User',
	full_name: 'Test User',
	role: 'user',
	avatar_url: null,
	home_address: null,
	created_at: '2024-01-01T00:00:00Z',
	updated_at: '2024-01-01T00:00:00Z',
	...overrides
});

export const createMockTrip = (overrides = {}) => ({
	id: 'test-trip-id',
	title: 'Test Trip',
	description: 'Test trip description',
	start_date: '2024-01-01T00:00:00Z',
	end_date: '2024-01-02T00:00:00Z',
	location: {
		type: 'Point',
		coordinates: [0, 0]
	},
	city_name: 'Test City',
	status: 'draft',
	user_id: 'test-user-id',
	created_at: '2024-01-01T00:00:00Z',
	updated_at: '2024-01-01T00:00:00Z',
	...overrides
});

export const createMockJob = (overrides = {}) => ({
	id: 'test-job-id',
	type: 'trip_generation',
	status: 'queued',
	priority: 'normal',
	progress: 0,
	data: {},
	error: null,
	worker_id: null,
	created_by: 'test-user-id',
	started_at: null,
	completed_at: null,
	created_at: '2024-01-01T00:00:00Z',
	updated_at: '2024-01-01T00:00:00Z',
	...overrides
});

export const createMockRequest = (overrides = {}) => ({
	method: 'GET',
	url: 'http://localhost:3000/api/test',
	headers: new Headers({
		'Content-Type': 'application/json',
		Authorization: 'Bearer test-token'
	}),
	body: null,
	...overrides
});

export const createMockResponse = (overrides = {}) => ({
	status: 200,
	statusText: 'OK',
	headers: new Headers({
		'Content-Type': 'application/json'
	}),
	body: JSON.stringify({ success: true }),
	...overrides
});

// Cleanup function
export const cleanup = () => {
	vi.clearAllMocks();
	vi.clearAllTimers();
};

beforeEach(() => {
	cleanup();
});

afterEach(() => {
	cleanup();
});

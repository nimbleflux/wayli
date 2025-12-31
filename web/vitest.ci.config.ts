import path from 'path';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit(), svelteTesting()],
	test: {
		include: ['tests/**/*.{test,spec}.{js,ts}', 'src/**/*.{test,spec}.{js,ts}'],
		exclude: [
			'tests/e2e/**',
			'**/*.server.ts',
			'**/*.worker.ts',
			'**/node_modules/**',
			'**/dist/**',
			'**/.svelte-kit/**',
			'svelte.config.js'
		],
		environment: 'jsdom',
		setupFiles: ['./tests/setup.ts'],
		globals: true,
		css: true,
		tsconfig: './tsconfig.ci.json',
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			thresholds: {
				lines: 0.7,
				functions: 0.7,
				branches: 0.6,
				statements: 0.7
			},
			exclude: [
				'node_modules/',
				'tests/',
				'**/*.d.ts',
				'**/*.config.*',
				'**/coverage/**',
				'**/dist/**',
				'**/.svelte-kit/**',
				'**/*.server.ts',
				'**/*.worker.ts'
			]
		},
		// Separate configuration for component tests
		environmentOptions: {
			jsdom: {
				resources: 'usable'
			}
		}
	},
	resolve: {
		alias: {
			$lib: path.resolve(__dirname, './src/lib'),
			$app: path.resolve(__dirname, './src/app'),
			$routes: path.resolve(__dirname, './src/routes'),
			$components: path.resolve(__dirname, './src/lib/components'),
			$stores: path.resolve(__dirname, './src/lib/stores'),
			$utils: path.resolve(__dirname, './src/lib/utils'),
			$services: path.resolve(__dirname, './src/lib/services'),
			$types: path.resolve(__dirname, './src/lib/types'),
			// Alias @fluxbase/sdk to mock for CI - ensures tests work regardless of npm install
			'@fluxbase/sdk': path.resolve(__dirname, './tests/mocks/fluxbase-sdk.ts')
		}
	}
});

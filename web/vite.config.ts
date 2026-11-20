import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

/**
 * Vite Configuration
 *
 * Environment Variables:
 * - VITE_ALLOWED_HOSTS: Comma-separated list of allowed hosts for preview server
 *   Example: "wayli.app,staging.wayli.app,dev.wayli.app"
 *
 * Note: The preview server's allowedHosts check is a security feature to prevent
 * host header attacks. Since you're using HTTPS in production, this check
 * provides minimal additional security benefit.
 */

export default defineConfig(({ mode }) => {
	// Load env file based on mode (development, production, etc.)
	// The third argument '' means load all env vars, not just VITE_ prefixed ones
	// Note: loadEnv only reads from .env files, not container environment variables
	const fileEnv = loadEnv(mode, process.cwd(), '');

	// Merge: .env file values take precedence, fall back to container env vars
	const env = {
		...process.env,
		...fileEnv
	};

	return {
		plugins: [
			tailwindcss(),
			// SvelteKit 3 moved kit config (formerly svelte.config.js) into the
			// sveltekit() plugin options. trustedOrigins allows cross-origin form
			// submissions from the configured production domains.
			sveltekit({
				// Kit 3 renamed $lib to #lib; keep the $lib alias so existing
				// imports don't need a mechanical rewrite. (TODO: migrate to
				// #lib in a dedicated cleanup.)
				alias: { $lib: 'src/lib' },
				adapter: adapter({
					pages: 'build',
					assets: 'build',
					fallback: 'index.html',
					precompress: false,
					strict: false
				}),
				csrf: {
					trustedOrigins: env.PUBLIC_TRUSTED_ORIGINS?.split(',') || []
				}
			})
		],
		define: {
			// Only expose public environment variables to the client
			// SECURITY: Never expose FLUXBASE_SERVICE_ROLE_KEY or FLUXBASE_BASE_URL to the client!
			// FLUXBASE_BASE_URL is for server-to-server communication (internal cluster URLs)
			// FLUXBASE_PUBLIC_BASE_URL is for browser access (externally accessible URLs)
			'process.env': {
				// Client-side URL for browser access to Fluxbase
				// In production, window.WAYLI_CONFIG (injected at runtime) takes priority over this
				FLUXBASE_PUBLIC_BASE_URL: env.FLUXBASE_PUBLIC_BASE_URL || 'http://localhost:8080',
				PUBLIC_FLUXBASE_ANON_KEY:
					env.PUBLIC_FLUXBASE_ANON_KEY ||
					env.FLUXBASE_ANON_KEY ||
					'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6ImZsdXhiYXNlIiwiaWF0IjoxNjQxNzY5MjAwLCJleHAiOjE3OTk1MzU2MDB9.iPr9o47ALu9iDLqL9rqq7rlvka9Q8ps2XV049R4l67E',
				NODE_ENV: env.NODE_ENV || 'development'
			}
		},
		build: {
			// Enable source maps for debugging (always on so production errors
			// have readable stack traces; the .map files are not served unless
			// explicitly configured, so this doesn't expose source to users).
			sourcemap: true,

			// ponytail: SvelteKit owns rollupOptions.output.{entry,chunk,asset}FileNames
			// for its own chunking strategy (per-route splitting, hashed assets).
			// Overriding them produces a startup warning and gets ignored anyway.

			// Optimize build performance
			target: 'esnext',
			minify: 'esbuild',

			// Chunk size warnings
			chunkSizeWarningLimit: 1000
		},

		// Optimize dependencies. maplibre-gl must NOT be pre-bundled: it
		// locates its web worker via `new URL('./maplibre-gl-worker.mjs',
		// import.meta.url)` relative to the module file, and the optimizer
		// renames modules in .vite/deps so that URL 404s — the GL map then
		// stalls silently (no tiles, no error). Excluded here, the dev server
		// serves the real dist files; map-theme.ts additionally passes an
		// explicit worker URL (Vite's ?worker&url) to maplibre so the
		// production build emits the worker file instead of leaving the
		// relative URL dangling.
		optimizeDeps: {
			include: [
				'svelte',
				'@nimbleflux/fluxbase-sdk',
				'lucide-svelte',
				'date-fns',
				'leaflet',
				'@maplibre/maplibre-gl-leaflet',
				'@turf/turf',
				'qrcode',
				'zod'
			],
			exclude: ['maplibre-gl']
		},

		// Server configuration
		server: {
			// Bind to 0.0.0.0 to allow access from outside the container
			host: true,
			port: 4000,
			// Enable HMR with optimized settings
			hmr: {
				overlay: false
			}
		},

		// Preview configuration
		preview: {
			port: 4173,
			host: true,
			allowedHosts: [
				// Allow localhost for development
				'localhost',
				'127.0.0.1',
				// Allow production domains from environment variable
				...(env.VITE_ALLOWED_HOSTS ? env.VITE_ALLOWED_HOSTS.split(',') : [])
			]
		}
	};
});

import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

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

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	define: {
		// Only expose public environment variables to the client
		// SECURITY: Never expose FLUXBASE_SERVICE_ROLE_KEY or FLUXBASE_BASE_URL to the client!
		// FLUXBASE_BASE_URL is for server-to-server communication (internal cluster URLs)
		// FLUXBASE_PUBLIC_BASE_URL is for browser access (externally accessible URLs)
		'process.env': {
			// Client-side URL: For browser access during development
			// In production, window.WAYLI_CONFIG (injected at runtime) takes priority over this
			FLUXBASE_PUBLIC_BASE_URL: process.env.FLUXBASE_PUBLIC_BASE_URL || 'http://localhost:8080',
			PUBLIC_FLUXBASE_ANON_KEY:
				process.env.PUBLIC_FLUXBASE_ANON_KEY ||
				'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6ImZsdXhiYXNlIiwiaWF0IjoxNjQxNzY5MjAwLCJleHAiOjE3OTk1MzU2MDB9.iPr9o47ALu9iDLqL9rqq7rlvka9Q8ps2XV049R4l67E',
			NODE_ENV: process.env.NODE_ENV || 'development'
		}
	},
	build: {
		// Enable source maps for debugging
		sourcemap: process.env.NODE_ENV === 'development',

		// Optimize chunk splitting
		rollupOptions: {
			output: {
				// Optimize chunk naming
				chunkFileNames: 'js/[name]-[hash].js',
				entryFileNames: 'js/[name]-[hash].js',
				assetFileNames: (assetInfo) => {
					const info = assetInfo.name?.split('.') || [];
					const ext = info[info.length - 1];
					if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(ext)) {
						return `images/[name]-[hash][extname]`;
					}
					if (/css/i.test(ext)) {
						return `css/[name]-[hash][extname]`;
					}
					return `assets/[name]-[hash][extname]`;
				}
			}
		},

		// Optimize build performance
		target: 'esnext',
		minify: 'esbuild',

		// Chunk size warnings
		chunkSizeWarningLimit: 1000
	},

	// Optimize dependencies
	optimizeDeps: {
		include: [
			'svelte',
			'@fluxbase/sdk',
			'lucide-svelte',
			'date-fns',
			'lodash-es',
			'leaflet',
			'@turf/turf',
			'otplib',
			'qrcode',
			'zod'
		]
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
			...(process.env.VITE_ALLOWED_HOSTS ? process.env.VITE_ALLOWED_HOSTS.split(',') : [])
		]
	}
});

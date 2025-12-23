// src/lib/core/config/environment.ts
// Only include public, client-safe config!
// This file should ONLY be imported in client-side/browser code (SvelteKit load functions, client-side stores, etc).
// Never import secrets or private env vars here.

// Note: Pelias configuration is now handled directly in the service
// Client-side can use PUBLIC_PELIAS_ENDPOINT env var (defaults to https://pelias.wayli.app)

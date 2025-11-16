/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly PUBLIC_FLUXBASE_ANON_KEY: string;
	readonly FLUXBASE_SERVICE_ROLE_KEY: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

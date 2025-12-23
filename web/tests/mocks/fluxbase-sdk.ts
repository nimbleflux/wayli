/**
 * Mock implementation of @fluxbase/sdk for CI testing
 * This file is used as an alias in vitest.ci.config.ts to ensure
 * tests work even if the npm package isn't properly installed
 */

export function createClient(_url: string, _key: string) {
	const createChainableMock = () => {
		const chain: any = {
			select: () => chain,
			insert: () => chain,
			update: () => chain,
			delete: () => chain,
			eq: () => chain,
			neq: () => chain,
			gt: () => chain,
			gte: () => chain,
			lt: () => chain,
			lte: () => chain,
			like: () => chain,
			ilike: () => chain,
			in: () => chain,
			not: () => chain,
			or: () => chain,
			order: () => chain,
			limit: () => chain,
			range: () => chain,
			single: () => chain,
			maybeSingle: () => chain,
			count: () => chain,
			then: (resolve: (value: any) => void) => {
				resolve({ data: null, error: null });
				return Promise.resolve({ data: null, error: null });
			}
		};
		return chain;
	};

	return {
		auth: {
			getUser: () => Promise.resolve({ data: { user: null }, error: null }),
			getSession: () => Promise.resolve({ data: { session: null }, error: null }),
			signInWithPassword: () => Promise.resolve({ data: null, error: null }),
			signUp: () => Promise.resolve({ data: null, error: null }),
			signOut: () => Promise.resolve({ error: null }),
			onAuthStateChange: (callback: any) => {
				callback('SIGNED_OUT', null);
				return { data: { subscription: { unsubscribe: () => {} } }, error: null };
			}
		},
		from: (_table: string) => createChainableMock(),
		storage: {
			from: (_bucket: string) => ({
				upload: () => Promise.resolve({ error: null }),
				download: () => Promise.resolve({ data: null, error: null }),
				remove: () => Promise.resolve({ data: null, error: null }),
				getPublicUrl: () => ({ data: { publicUrl: 'https://storage.example.com/image.jpg' } })
			})
		},
		rpc: () => Promise.resolve({ data: null, error: null })
	};
}

// Re-export types that might be imported
export type FluxbaseClient = ReturnType<typeof createClient>;

// web/tests/utils/fluxbase-mocks.ts
import type { FluxbaseClient } from '@fluxbase/sdk';

type TableApi = {
	select: ReturnType<typeof vi.fn>;
	insert: ReturnType<typeof vi.fn>;
	update: ReturnType<typeof vi.fn>;
	upsert: ReturnType<typeof vi.fn>;
	delete: ReturnType<typeof vi.fn>;
	range: ReturnType<typeof vi.fn>;
	order: ReturnType<typeof vi.fn>;
	eq: ReturnType<typeof vi.fn>;
	not: ReturnType<typeof vi.fn>;
	neq: ReturnType<typeof vi.fn>;
	in: ReturnType<typeof vi.fn>;
	single: ReturnType<typeof vi.fn>;
	head?: unknown;
};

export function createMockFluxbase(overrides: Partial<FluxbaseClient> = {}): FluxbaseClient {
	const tableImpl = (): TableApi => {
		const api: any = {
			select: vi.fn().mockReturnThis(),
			insert: vi.fn().mockResolvedValue({ data: null, error: null }),
			update: vi.fn().mockResolvedValue({ data: null, error: null }),
			upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
			delete: vi.fn().mockResolvedValue({ data: null, error: null }),
			range: vi.fn().mockReturnThis(),
			order: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			not: vi.fn().mockReturnThis(),
			neq: vi.fn().mockReturnThis(),
			in: vi.fn().mockReturnThis(),
			single: vi.fn().mockResolvedValue({ data: null, error: null })
		};
		return api as TableApi;
	};

	const storage = {
		from: vi.fn().mockReturnValue({ download: vi.fn(), remove: vi.fn() })
	} as any;

	const functions = { invoke: vi.fn() } as any;

	const client: any = {
		from: vi.fn().mockImplementation(() => tableImpl()),
		rpc: vi.fn(),
		storage,
		functions,
		...overrides
	};

	return client as FluxbaseClient;
}

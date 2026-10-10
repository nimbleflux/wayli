//
// Unit tests for chat.service.ts — focuses on the Phase-2 surface: the SDK
// snake_case → camelCase callback mapping (onDone usage/extras), the quota
// helpers' error paths, and the pure helpers. Uses two mocks:
//   - vi.mock('$lib/fluxbase') for getAuthToken + ai.getUsage/lookupChatbot
//   - vi.mock('@nimbleflux/fluxbase-sdk') to replace FluxbaseAIChat's WebSocket
//     with a fake that captures the AIChatOptions, so callbacks fire by hand.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted so the objects exist when the hoisted vi.mock factories run.
const mocks = vi.hoisted(() => {
	let lastOptions: Record<string, ((...args: unknown[]) => void) | undefined> | undefined;
	const fakeChat = {
		connect: vi.fn(),
		disconnect: vi.fn(),
		isConnected: vi.fn(),
		startChat: vi.fn(),
		sendMessage: vi.fn(),
		cancel: vi.fn(),
		getAccumulatedContent: vi.fn()
	};
	const mockFluxbase = {
		getAuthToken: vi.fn(),
		ai: {
			getUsage: vi.fn(),
			lookupChatbot: vi.fn(),
			listConversations: vi.fn(),
			getConversation: vi.fn(),
			deleteConversation: vi.fn(),
			updateConversation: vi.fn()
		}
	};
	return {
		fakeChat,
		mockFluxbase,
		getLastOptions: () => lastOptions,
		setLastOptions: (o: typeof lastOptions) => {
			lastOptions = o;
		}
	};
});

vi.mock('@nimbleflux/fluxbase-sdk', () => ({
	// A regular function (not arrow) so `new FluxbaseAIChat(...)` works.
	FluxbaseAIChat: vi.fn().mockImplementation(function (opts: unknown) {
		mocks.setLastOptions(opts as Parameters<typeof mocks.setLastOptions>[0]);
		return mocks.fakeChat;
	})
}));
vi.mock('$lib/fluxbase', () => ({ fluxbase: mocks.mockFluxbase }));

import { ChatService } from '$lib/services/chat.service';

let service: InstanceType<typeof ChatService>;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.setLastOptions(undefined);
	// Defaults for the happy path.
	mocks.mockFluxbase.getAuthToken.mockReturnValue('test-token');
	mocks.fakeChat.connect.mockResolvedValue(undefined);
	mocks.fakeChat.isConnected.mockReturnValue(true);
	mocks.fakeChat.startChat.mockResolvedValue('conv-123');
	mocks.fakeChat.getAccumulatedContent.mockReturnValue('');
	service = new ChatService();
});

describe('onDone wrapper — usage mapping', () => {
	it('maps snake_case usage tokens to camelCase', async () => {
		const onDone = vi.fn();
		await service.connect({ onDone });
		mocks.getLastOptions()!.onDone!(
			{ prompt_tokens: 10, completion_tokens: 20, total_tokens: 30, cached_tokens: 5 },
			'conv-123',
			undefined
		);
		expect(onDone).toHaveBeenCalledWith(
			{ promptTokens: 10, completionTokens: 20, totalTokens: 30, cachedTokens: 5 },
			undefined
		);
	});

	it('passes cached_tokens through (undefined when absent)', async () => {
		const onDone = vi.fn();
		await service.connect({ onDone });
		mocks.getLastOptions()!.onDone!({ prompt_tokens: 1, completion_tokens: 2 }, 'c', undefined);
		expect(onDone).toHaveBeenCalledWith(
			{ promptTokens: 1, completionTokens: 2, totalTokens: undefined, cachedTokens: undefined },
			undefined
		);
	});

	it('passes undefined usage straight through', async () => {
		const onDone = vi.fn();
		await service.connect({ onDone });
		mocks.getLastOptions()!.onDone!(undefined, 'c', undefined);
		expect(onDone).toHaveBeenCalledWith(undefined, undefined);
	});
});

describe('onDone wrapper — extras.dailyQuota', () => {
	it('maps daily_quota.{requests,tokens,resets_at} to camelCase', async () => {
		const onDone = vi.fn();
		await service.connect({ onDone });
		mocks.getLastOptions()!.onDone!(undefined, 'c', {
			daily_quota: {
				requests: { used: 5, limit: 500 },
				tokens: { used: 1000, limit: 100000 },
				resets_at: '2026-07-06T00:00:00Z'
			}
		});
		expect(onDone).toHaveBeenCalledWith(undefined, {
			dailyQuota: {
				requests: { used: 5, limit: 500 },
				tokens: { used: 1000, limit: 100000 },
				resetsAt: '2026-07-06T00:00:00Z'
			},
			matchedIntentRules: undefined
		});
	});

	it('omits dailyQuota when extras present but daily_quota absent', async () => {
		const onDone = vi.fn();
		await service.connect({ onDone });
		mocks.getLastOptions()!.onDone!(undefined, 'c', { matched_intent_rules: [] });
		expect(onDone).toHaveBeenCalledWith(undefined, {
			dailyQuota: undefined,
			matchedIntentRules: []
		});
	});
});

describe('onDone wrapper — matchedIntentRules', () => {
	it('maps each rule snake_case table/tool field to camelCase', async () => {
		const onDone = vi.fn();
		await service.connect({ onDone });
		mocks.getLastOptions()!.onDone!(undefined, 'c', {
			matched_intent_rules: [
				{
					keyword: 'restaurant',
					required_table: 'my_place_visits',
					forbidden_table: 'my_trips',
					required_tool: 'execute_sql',
					forbidden_tool: 'http_request'
				}
			]
		});
		expect(onDone).toHaveBeenCalledWith(undefined, {
			dailyQuota: undefined,
			matchedIntentRules: [
				{
					keyword: 'restaurant',
					requiredTable: 'my_place_visits',
					forbiddenTable: 'my_trips',
					requiredTool: 'execute_sql',
					forbiddenTool: 'http_request'
				}
			]
		});
	});

	it('omits turnExtras entirely when extras is undefined', async () => {
		const onDone = vi.fn();
		await service.connect({ onDone });
		mocks.getLastOptions()!.onDone!({ prompt_tokens: 1, completion_tokens: 2 }, 'c', undefined);
		expect(onDone).toHaveBeenLastCalledWith(expect.anything(), undefined);
	});
});

describe('other callback wrappers', () => {
	it('onContent accumulates deltas and forwards (delta, accumulated)', async () => {
		const onContent = vi.fn();
		await service.connect({ onContent });
		mocks.getLastOptions()!.onContent!('Hello ', 'c');
		mocks.getLastOptions()!.onContent!('world', 'c');
		expect(onContent).toHaveBeenNthCalledWith(1, 'Hello ', 'Hello ');
		expect(onContent).toHaveBeenNthCalledWith(2, 'world', 'Hello world');
	});

	it('onQueryResult reshapes positional args into an object', async () => {
		const onQueryResult = vi.fn();
		await service.connect({ onQueryResult });
		mocks.getLastOptions()!.onQueryResult!('SELECT 1', 'summary', 1, [{ a: 1 }], 'c');
		expect(onQueryResult).toHaveBeenCalledWith({
			query: 'SELECT 1',
			summary: 'summary',
			rowCount: 1,
			data: [{ a: 1 }]
		});
	});

	it('onError forwards error and code unchanged', async () => {
		const onError = vi.fn();
		await service.connect({ onError });
		mocks.getLastOptions()!.onError!('boom', 'E1', 'c');
		expect(onError).toHaveBeenCalledWith('boom', 'E1');
	});
});

describe('getDailyUsage(chatbotId)', () => {
	it('maps {requests,tokens,resets_at} to camelCase on success', async () => {
		mocks.mockFluxbase.ai.getUsage.mockResolvedValue({
			data: {
				requests: { used: 1, limit: 500 },
				tokens: { used: 2, limit: 100000 },
				resets_at: '2026-07-06T00:00:00Z'
			},
			error: null
		});
		await expect(service.getDailyUsage('bot-1')).resolves.toEqual({
			requests: { used: 1, limit: 500 },
			tokens: { used: 2, limit: 100000 },
			resetsAt: '2026-07-06T00:00:00Z'
		});
	});

	it('returns null when getUsage returns an error', async () => {
		mocks.mockFluxbase.ai.getUsage.mockResolvedValue({ data: null, error: new Error('nope') });
		await expect(service.getDailyUsage('bot-1')).resolves.toBeNull();
	});

	it('returns null when data is null', async () => {
		mocks.mockFluxbase.ai.getUsage.mockResolvedValue({ data: null, error: null });
		await expect(service.getDailyUsage('bot-1')).resolves.toBeNull();
	});

	it('returns null when getUsage throws', async () => {
		mocks.mockFluxbase.ai.getUsage.mockRejectedValue(new Error('network'));
		await expect(service.getDailyUsage('bot-1')).resolves.toBeNull();
	});
});

describe('getDailyUsageForName(name)', () => {
	it('resolves the chatbot via lookupChatbot then maps the snapshot', async () => {
		mocks.mockFluxbase.ai.lookupChatbot.mockResolvedValue({
			data: { chatbot: { id: 'bot-uuid' } },
			error: null
		});
		mocks.mockFluxbase.ai.getUsage.mockResolvedValue({
			data: { requests: { used: 7, limit: 500 }, tokens: { used: 0, limit: 0 } },
			error: null
		});
		await expect(service.getDailyUsageForName('wayli-assistant')).resolves.toEqual({
			requests: { used: 7, limit: 500 },
			tokens: { used: 0, limit: 0 },
			resetsAt: undefined
		});
		expect(mocks.mockFluxbase.ai.getUsage).toHaveBeenCalledWith('bot-uuid');
	});

	it('returns null when lookupChatbot returns an error', async () => {
		mocks.mockFluxbase.ai.lookupChatbot.mockResolvedValue({ data: null, error: new Error('404') });
		await expect(service.getDailyUsageForName('x')).resolves.toBeNull();
		expect(mocks.mockFluxbase.ai.getUsage).not.toHaveBeenCalled();
	});

	it('returns null when lookupChatbot data has no chatbot.id', async () => {
		mocks.mockFluxbase.ai.lookupChatbot.mockResolvedValue({ data: { chatbot: {} }, error: null });
		await expect(service.getDailyUsageForName('x')).resolves.toBeNull();
	});

	it('returns null when lookupChatbot throws', async () => {
		mocks.mockFluxbase.ai.lookupChatbot.mockRejectedValue(new Error('network'));
		await expect(service.getDailyUsageForName('x')).resolves.toBeNull();
	});
});

describe('connect() + helpers', () => {
	it('throws "Not authenticated" when getAuthToken() returns null', async () => {
		mocks.mockFluxbase.getAuthToken.mockReturnValue(null);
		await expect(service.connect()).rejects.toThrow(/Not authenticated/);
	});

	it('isConnected returns false before connect', () => {
		expect(service.isConnected()).toBe(false);
	});

	it('disconnect() is a safe no-op when never connected', () => {
		expect(() => service.disconnect()).not.toThrow();
		expect(service.isConnected()).toBe(false);
	});

	it('generates monotonically-numbered msg_ ids', () => {
		const a = service.generateMessageId();
		const b = service.generateMessageId();
		expect(a).toMatch(/^msg_\d+_\d+$/);
		expect(b).toMatch(/^msg_\d+_\d+$/);
		expect(a).not.toBe(b);
	});
});

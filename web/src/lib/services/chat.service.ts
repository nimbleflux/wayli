/**
 * Chat Service
 *
 * Frontend service for interacting with Fluxbase AI chatbots.
 * Uses WebSocket-based streaming for real-time chat interactions.
 */

import { FluxbaseAIChat, type AIChatOptions, type AIChatEvent } from '@fluxbase/sdk';
import { config } from '$lib/config';
import { fluxbase } from '$lib/fluxbase';

// Types
export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	timestamp: Date;
	queryResult?: QueryResultData;
	usage?: UsageStats;
	isStreaming?: boolean;
}

export interface QueryResultData {
	query: string;
	summary: string;
	rowCount: number;
	data: Record<string, unknown>[];
}

export interface UsageStats {
	promptTokens: number;
	completionTokens: number;
	totalTokens?: number;
}

export interface ChatCallbacks {
	onContent?: (delta: string, fullContent: string) => void;
	onProgress?: (step: string, message: string) => void;
	onQueryResult?: (result: QueryResultData) => void;
	onDone?: (usage: UsageStats | undefined) => void;
	onError?: (error: string, code?: string) => void;
}

export interface ConversationState {
	id: string | null;
	chatbot: string;
	messages: ChatMessage[];
	isConnected: boolean;
	isLoading: boolean;
}

class ChatService {
	private chat: FluxbaseAIChat | null = null;
	private conversationId: string | null = null;
	private currentCallbacks: ChatCallbacks | null = null;
	private accumulatedContent: string = '';
	private messageIdCounter: number = 0;

	/**
	 * Connect to the chat WebSocket
	 */
	async connect(callbacks?: ChatCallbacks): Promise<void> {
		// Disconnect existing connection if any
		if (this.chat) {
			this.disconnect();
		}

		this.currentCallbacks = callbacks || null;
		this.accumulatedContent = '';

		// Get the access token
		const token = fluxbase.getAuthToken();
		if (!token) {
			throw new Error('Not authenticated. Please sign in to use the chat.');
		}

		// Build WebSocket URL from config
		const wsUrl = this.buildWsUrl();

		// Create chat instance with callbacks
		const chatOptions: AIChatOptions = {
			wsUrl,
			token,
			onContent: (delta, conversationId) => {
				this.accumulatedContent += delta;
				this.currentCallbacks?.onContent?.(delta, this.accumulatedContent);
			},
			onProgress: (step, message, conversationId) => {
				this.currentCallbacks?.onProgress?.(step, message);
			},
			onQueryResult: (query, summary, rowCount, data, conversationId) => {
				this.currentCallbacks?.onQueryResult?.({
					query,
					summary,
					rowCount,
					data
				});
			},
			onDone: (usage, conversationId) => {
				const usageStats = usage
					? {
							promptTokens: usage.prompt_tokens,
							completionTokens: usage.completion_tokens,
							totalTokens: usage.total_tokens
						}
					: undefined;
				this.currentCallbacks?.onDone?.(usageStats);
			},
			onError: (error, code, conversationId) => {
				this.currentCallbacks?.onError?.(error, code);
			},
			reconnectAttempts: 3,
			reconnectDelay: 1000
		};

		this.chat = new FluxbaseAIChat(chatOptions);
		await this.chat.connect();
	}

	/**
	 * Disconnect from the chat WebSocket
	 */
	disconnect(): void {
		if (this.chat) {
			this.chat.disconnect();
			this.chat = null;
		}
		this.conversationId = null;
		this.currentCallbacks = null;
		this.accumulatedContent = '';
	}

	/**
	 * Check if connected to the chat
	 */
	isConnected(): boolean {
		return this.chat?.isConnected() ?? false;
	}

	/**
	 * Start a new chat session with a chatbot
	 */
	async startChat(
		chatbot: string = 'location-assistant',
		namespace: string = 'wayli',
		existingConversationId?: string
	): Promise<string> {
		if (!this.chat || !this.isConnected()) {
			throw new Error('Not connected. Call connect() first.');
		}

		this.conversationId = await this.chat.startChat(chatbot, namespace, existingConversationId);
		return this.conversationId;
	}

	/**
	 * Send a message in the current conversation
	 */
	async sendMessage(content: string, callbacks?: ChatCallbacks): Promise<void> {
		if (!this.chat || !this.isConnected()) {
			throw new Error('Not connected. Call connect() first.');
		}

		if (!this.conversationId) {
			throw new Error('No active conversation. Call startChat() first.');
		}

		// Update callbacks if provided
		if (callbacks) {
			this.currentCallbacks = callbacks;
		}

		// Reset accumulated content for new message
		this.accumulatedContent = '';

		// Send the message
		this.chat.sendMessage(this.conversationId, content);
	}

	/**
	 * Cancel the current message generation
	 */
	cancel(): void {
		if (this.chat && this.conversationId) {
			this.chat.cancel(this.conversationId);
		}
	}

	/**
	 * Get the accumulated response content
	 */
	getAccumulatedContent(): string {
		if (this.chat && this.conversationId) {
			return this.chat.getAccumulatedContent(this.conversationId);
		}
		return this.accumulatedContent;
	}

	/**
	 * Get the current conversation ID
	 */
	getConversationId(): string | null {
		return this.conversationId;
	}

	/**
	 * Generate a unique message ID
	 */
	generateMessageId(): string {
		return `msg_${Date.now()}_${++this.messageIdCounter}`;
	}

	/**
	 * Build WebSocket URL from config
	 */
	private buildWsUrl(): string {
		const baseUrl = config.fluxbaseUrl;

		// Convert HTTP(S) to WS(S)
		const wsProtocol = baseUrl.startsWith('https') ? 'wss' : 'ws';
		const wsUrl = baseUrl.replace(/^https?:/, wsProtocol + ':');

		return `${wsUrl}/ai/ws`;
	}
}

// Export singleton instance
export const chatService = new ChatService();

// Also export the class for testing
export { ChatService };

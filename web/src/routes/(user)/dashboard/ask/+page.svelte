<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import {
		Search,
		Loader2,
		Sparkles,
		MapPin,
		Clock,
		AlertCircle,
		Send,
		Bot,
		User,
		Coffee,
		Utensils,
		StopCircle,
		Settings,
		ExternalLink
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { format } from 'date-fns';

	import { translate } from '$lib/i18n';
	import {
		chatService,
		type ChatMessage,
		type QueryResultData
	} from '$lib/services/chat.service';
	import { sessionStore } from '$lib/stores/auth';
	import { ServiceAdapter } from '$lib/services/api/service-adapter';

	let t = $derived($translate);

	// State
	let question = $state('');
	let isConnected = $state(false);
	let isLoading = $state(false);
	let messages = $state<ChatMessage[]>([]);
	let currentStreamingContent = $state('');
	let currentQueryResult = $state<QueryResultData | null>(null);
	let error = $state<string | null>(null);

	// Configuration error state
	let configurationError = $state(false);
	let isAdmin = $state(false);
	let allowUserOverride = $state(false);
	let isCheckingConfig = $state(true);

	// Example suggestions
	const suggestions = [
		{
			question: 'Which restaurants did I visit in Vietnam?',
			description: 'Find all restaurant visits in a specific country'
		},
		{
			question: 'What vegan places did I go to last month?',
			description: 'Filter by cuisine type and date range'
		},
		{
			question: 'Show me cafes I visited in Tokyo',
			description: 'Find cafes in a specific city'
		},
		{
			question: 'Where did I spend the most time eating?',
			description: 'Find longest restaurant visits'
		},
		{
			question: 'List all museums I visited in 2024',
			description: 'Find cultural venues by year'
		},
		{
			question: 'Which bars did I visit in Barcelona in summer?',
			description: 'Combine location, venue type, and season'
		}
	];

	// Connect to chat on mount
	onMount(async () => {
		await checkConfigAndConnect();
	});

	// Disconnect on destroy
	onDestroy(() => {
		chatService.disconnect();
	});

	// Check configuration and connect to chat service
	async function checkConfigAndConnect() {
		isCheckingConfig = true;

		try {
			const session = $sessionStore;
			if (session) {
				// Check user role
				isAdmin = session.user?.app_metadata?.role === 'admin';

				// Check if user override is allowed
				const serviceAdapter = new ServiceAdapter({ session });
				const result = await serviceAdapter.getAllSettings();
				if (result?.app?.ai) {
					allowUserOverride = result.app.ai.allow_user_provider_override ?? false;
				}
			}
		} catch (err) {
			console.warn('Failed to load AI settings:', err);
		}

		isCheckingConfig = false;

		// Now try to connect
		await connectToChat();
	}

	// Connect to chat service
	async function connectToChat() {
		try {
			await chatService.connect({
				onContent: (delta, fullContent) => {
					currentStreamingContent = fullContent;
				},
				onProgress: (step, message) => {
					// Could show progress indicators here
					console.log(`[${step}] ${message}`);
				},
				onQueryResult: (result) => {
					currentQueryResult = result;
				},
				onDone: (usage) => {
					// Add the completed assistant message
					if (currentStreamingContent || currentQueryResult) {
						const assistantMessage: ChatMessage = {
							id: chatService.generateMessageId(),
							role: 'assistant',
							content: currentStreamingContent,
							timestamp: new Date(),
							queryResult: currentQueryResult ?? undefined
						};
						messages = [...messages, assistantMessage];
					}
					currentStreamingContent = '';
					currentQueryResult = null;
					isLoading = false;
				},
				onError: (errorMsg, code) => {
					error = errorMsg;
					isLoading = false;
					toast.error(errorMsg);
				}
			});

			// Start a chat session
			await chatService.startChat('location-assistant', 'wayli');
			isConnected = true;
			configurationError = false;
		} catch (err) {
			console.error('Failed to connect to chat:', err);
			const errorMessage = (err as Error).message;

			// Check if this is a configuration error
			if (
				errorMessage.includes('Chatbot not found') ||
				errorMessage.includes('disabled') ||
				errorMessage.includes('not configured')
			) {
				configurationError = true;
				error = null; // Don't show as runtime error
			} else {
				error = errorMessage;
			}
		}
	}

	// Send a message
	async function sendMessage() {
		if (!question.trim() || isLoading || !isConnected) return;

		const userQuestion = question.trim();
		question = '';
		error = null;
		isLoading = true;
		currentStreamingContent = '';
		currentQueryResult = null;

		// Add user message
		const userMessage: ChatMessage = {
			id: chatService.generateMessageId(),
			role: 'user',
			content: userQuestion,
			timestamp: new Date()
		};
		messages = [...messages, userMessage];

		try {
			await chatService.sendMessage(userQuestion);
		} catch (err) {
			error = (err as Error).message;
			isLoading = false;
			toast.error('Failed to send message');
		}
	}

	// Cancel current message
	function cancelMessage() {
		chatService.cancel();
		isLoading = false;
	}

	// Use a suggestion
	function useSuggestion(suggestion: { question: string }) {
		question = suggestion.question;
		sendMessage();
	}

	// Format date for display
	function formatDate(dateStr: string): string {
		try {
			return format(new Date(dateStr), 'MMM d, yyyy h:mm a');
		} catch {
			return dateStr;
		}
	}

	// Get amenity display name
	function getAmenityLabel(amenity: string | null | undefined): string {
		if (!amenity) return 'Place';
		return amenity.charAt(0).toUpperCase() + amenity.slice(1);
	}
</script>

<svelte:head>
	<title>Ask About Your Travels | Wayli</title>
</svelte:head>

<div class="mx-auto flex h-[calc(100vh-4rem)] max-w-4xl flex-col px-4 py-4">
	<!-- Header -->
	<div class="mb-4 text-center">
		<div class="mb-2 flex items-center justify-center gap-2">
			<Sparkles class="h-6 w-6 text-purple-500" />
			<h1 class="text-2xl font-bold text-gray-900 dark:text-gray-100">
				Ask About Your Travels
			</h1>
		</div>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Use natural language to explore your travel history
		</p>
	</div>

	<!-- Messages Area -->
	<div class="flex-1 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
		{#if isCheckingConfig}
			<!-- Loading configuration -->
			<div class="flex h-full flex-col items-center justify-center p-6">
				<Loader2 class="mb-4 h-12 w-12 animate-spin text-gray-400" />
				<p class="text-sm text-gray-500 dark:text-gray-400">
					{t('ask.connectingToChat')}
				</p>
			</div>
		{:else if configurationError}
			<!-- Configuration Error State -->
			<div class="flex h-full flex-col items-center justify-center p-6">
				<div class="max-w-md text-center">
					<div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/30">
						<AlertCircle class="h-8 w-8 text-orange-600 dark:text-orange-400" />
					</div>
					<h3 class="mb-2 text-xl font-semibold text-gray-900 dark:text-gray-100">
						{t('ask.notConfigured')}
					</h3>
					<p class="mb-4 text-sm text-gray-600 dark:text-gray-400">
						{t('ask.notConfiguredDescription')}
					</p>
					<ul class="mb-6 text-left text-sm text-gray-500 dark:text-gray-400">
						<li class="flex items-start gap-2 py-1">
							<span class="text-gray-400">•</span>
							<span>{t('ask.notConfiguredReasons.disabled')}</span>
						</li>
						<li class="flex items-start gap-2 py-1">
							<span class="text-gray-400">•</span>
							<span>{t('ask.notConfiguredReasons.notSynced')}</span>
						</li>
						<li class="flex items-start gap-2 py-1">
							<span class="text-gray-400">•</span>
							<span>{t('ask.notConfiguredReasons.configError')}</span>
						</li>
					</ul>

					{#if isAdmin}
						<!-- Admin can configure settings -->
						<a
							href="/dashboard/server-admin-settings"
							class="inline-flex items-center gap-2 rounded-lg bg-[rgb(34,51,95)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[rgb(34,51,95)]/90"
						>
							<Settings class="h-4 w-4" />
							{t('ask.configureAsAdmin')}
						</a>
					{:else if allowUserOverride}
						<!-- User can configure their own provider -->
						<a
							href="/dashboard/account-settings"
							class="inline-flex items-center gap-2 rounded-lg bg-[rgb(34,51,95)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[rgb(34,51,95)]/90"
						>
							<Settings class="h-4 w-4" />
							{t('ask.configureAsUser')}
						</a>
					{:else}
						<!-- User cannot configure, contact admin -->
						<p class="text-sm text-gray-500 dark:text-gray-400">
							{t('ask.contactAdmin')}
						</p>
					{/if}
				</div>
			</div>
		{:else if messages.length === 0 && !isLoading}
			<!-- Empty State with Suggestions -->
			<div class="flex h-full flex-col items-center justify-center p-6">
				<Bot class="mb-4 h-12 w-12 text-gray-400" />
				<h3 class="mb-2 text-lg font-medium text-gray-700 dark:text-gray-300">
					{t('ask.startConversation')}
				</h3>
				<p class="mb-6 text-center text-sm text-gray-500 dark:text-gray-400">
					{t('ask.askAnything')}
				</p>
				<div class="grid w-full max-w-2xl gap-2 sm:grid-cols-2">
					{#each suggestions.slice(0, 4) as suggestion (suggestion.question)}
						<button
							onclick={() => useSuggestion(suggestion)}
							class="rounded-lg border border-gray-200 bg-white p-3 text-left text-sm transition-all hover:border-purple-300 hover:shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:hover:border-purple-600"
						>
							<div class="font-medium text-gray-700 dark:text-gray-300">
								{suggestion.question}
							</div>
						</button>
					{/each}
				</div>
			</div>
		{:else}
			<!-- Messages -->
			<div class="space-y-4 p-4">
				{#each messages as message (message.id)}
					<div class="flex gap-3 {message.role === 'user' ? 'justify-end' : ''}">
						{#if message.role === 'assistant'}
							<div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900/30">
								<Bot class="h-5 w-5 text-purple-600 dark:text-purple-400" />
							</div>
						{/if}
						<div
							class="max-w-[80%] rounded-xl px-4 py-3 {message.role === 'user'
								? 'bg-purple-500 text-white'
								: 'bg-white dark:bg-gray-800'}"
						>
							{#if message.role === 'assistant'}
								<div class="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
									{message.content}
								</div>

								<!-- Query Results -->
								{#if message.queryResult}
									<div class="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900">
										<div class="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
											Query Results ({message.queryResult.rowCount} rows)
										</div>
										{#if message.queryResult.summary}
											<div class="text-sm text-gray-700 dark:text-gray-300">
												{message.queryResult.summary}
											</div>
										{/if}
										{#if message.queryResult.data && message.queryResult.data.length > 0}
											<div class="mt-2 max-h-48 overflow-y-auto">
												{#each message.queryResult.data.slice(0, 5) as row, idx (idx)}
													<div class="border-t border-gray-200 py-2 first:border-t-0 dark:border-gray-700">
														<div class="flex items-center gap-2">
															<span class="font-medium text-gray-900 dark:text-gray-100">
																{row.poi_name || 'Unknown Place'}
															</span>
															{#if row.poi_amenity}
																<span class="text-xs text-gray-500">
																	({getAmenityLabel(row.poi_amenity as string)})
																</span>
															{/if}
														</div>
														{#if row.city || row.country}
															<div class="flex items-center gap-1 text-xs text-gray-500">
																<MapPin class="h-3 w-3" />
																{row.city}{row.country ? `, ${row.country}` : ''}
															</div>
														{/if}
														{#if row.started_at}
															<div class="flex items-center gap-1 text-xs text-gray-400">
																<Clock class="h-3 w-3" />
																{formatDate(row.started_at as string)}
															</div>
														{/if}
													</div>
												{/each}
												{#if message.queryResult.data.length > 5}
													<div class="mt-2 text-center text-xs text-gray-400">
														... and {message.queryResult.data.length - 5} more results
													</div>
												{/if}
											</div>
										{/if}
									</div>
								{/if}
							{:else}
								<div>{message.content}</div>
							{/if}
						</div>
						{#if message.role === 'user'}
							<div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700">
								<User class="h-5 w-5 text-gray-600 dark:text-gray-400" />
							</div>
						{/if}
					</div>
				{/each}

				<!-- Streaming Response -->
				{#if isLoading && (currentStreamingContent || currentQueryResult)}
					<div class="flex gap-3">
						<div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900/30">
							<Bot class="h-5 w-5 text-purple-600 dark:text-purple-400" />
						</div>
						<div class="max-w-[80%] rounded-xl bg-white px-4 py-3 dark:bg-gray-800">
							{#if currentStreamingContent}
								<div class="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
									{currentStreamingContent}
									<span class="inline-block h-4 w-2 animate-pulse bg-gray-400"></span>
								</div>
							{/if}

							{#if currentQueryResult}
								<div class="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900">
									<div class="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
										Query Results ({currentQueryResult.rowCount} rows)
									</div>
									{#if currentQueryResult.summary}
										<div class="text-sm text-gray-700 dark:text-gray-300">
											{currentQueryResult.summary}
										</div>
									{/if}
								</div>
							{/if}
						</div>
					</div>
				{:else if isLoading}
					<div class="flex gap-3">
						<div class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900/30">
							<Bot class="h-5 w-5 text-purple-600 dark:text-purple-400" />
						</div>
						<div class="rounded-xl bg-white px-4 py-3 dark:bg-gray-800">
							<Loader2 class="h-5 w-5 animate-spin text-gray-400" />
						</div>
					</div>
				{/if}

				<!-- Error -->
				{#if error}
					<div class="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
						<AlertCircle class="h-4 w-4 flex-shrink-0" />
						{error}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Input Area -->
	<div class="mt-4">
		<div class="relative flex items-center gap-2">
			<input
				type="text"
				bind:value={question}
				onkeydown={(e) => e.key === 'Enter' && sendMessage()}
				placeholder={isConnected ? "Ask about your travels..." : "Connecting..."}
				disabled={isLoading || !isConnected}
				class="flex-1 rounded-xl border border-gray-300 bg-white py-3 pl-4 pr-12 shadow-sm transition-all focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:focus:border-purple-400"
			/>
			{#if isLoading}
				<button
					onclick={cancelMessage}
					class="absolute right-3 rounded-lg bg-red-500 p-2 text-white transition-colors hover:bg-red-600"
					title="Cancel"
				>
					<StopCircle class="h-5 w-5" />
				</button>
			{:else}
				<button
					onclick={sendMessage}
					disabled={!question.trim() || !isConnected}
					class="absolute right-3 rounded-lg bg-purple-500 p-2 text-white transition-colors hover:bg-purple-600 disabled:cursor-not-allowed disabled:opacity-50"
				>
					<Send class="h-5 w-5" />
				</button>
			{/if}
		</div>

		<!-- Connection Status -->
		{#if !isConnected && !configurationError && !isCheckingConfig}
			<div class="mt-2 flex items-center justify-center gap-2 text-sm text-gray-500">
				<Loader2 class="h-4 w-4 animate-spin" />
				{t('ask.connectingToChat')}
			</div>
		{/if}
	</div>
</div>

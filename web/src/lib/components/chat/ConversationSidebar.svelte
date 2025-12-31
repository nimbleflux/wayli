<script lang="ts">
	import { Plus, Search, Trash2, MessageSquare, Loader2 } from 'lucide-svelte';
	import { formatDistanceToNow, isToday, isYesterday, isThisWeek } from 'date-fns';
	import type { AIUserConversationSummary } from '$lib/services/chat.service';

	interface Props {
		conversations: AIUserConversationSummary[];
		activeConversationId: string | null;
		isLoading?: boolean;
		hasMore?: boolean;
		isLoadingMore?: boolean;
		onSelect: (id: string) => void;
		onNewConversation: () => void;
		onDelete: (id: string) => void;
		onLoadMore?: () => void;
	}

	let {
		conversations,
		activeConversationId,
		isLoading = false,
		hasMore = false,
		isLoadingMore = false,
		onSelect,
		onNewConversation,
		onDelete,
		onLoadMore
	}: Props = $props();

	let searchQuery = $state('');
	let sentinelEl: HTMLDivElement | undefined = $state();

	// Intersection Observer for infinite scroll
	$effect(() => {
		if (!sentinelEl || !hasMore || !onLoadMore) return;

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
					onLoadMore();
				}
			},
			{ threshold: 0.1 }
		);

		observer.observe(sentinelEl);
		return () => observer.disconnect();
	});

	// Filter conversations based on search
	const filteredConversations = $derived(
		searchQuery.trim()
			? conversations.filter(
					(c) =>
						c.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
						c.preview?.toLowerCase().includes(searchQuery.toLowerCase())
				)
			: conversations
	);

	// Group conversations by date
	interface GroupedConversations {
		today: AIUserConversationSummary[];
		yesterday: AIUserConversationSummary[];
		thisWeek: AIUserConversationSummary[];
		older: AIUserConversationSummary[];
	}

	const groupedConversations = $derived.by(() => {
		const groups: GroupedConversations = {
			today: [],
			yesterday: [],
			thisWeek: [],
			older: []
		};

		for (const conv of filteredConversations) {
			const date = new Date(conv.updated_at);
			if (isToday(date)) {
				groups.today.push(conv);
			} else if (isYesterday(date)) {
				groups.yesterday.push(conv);
			} else if (isThisWeek(date)) {
				groups.thisWeek.push(conv);
			} else {
				groups.older.push(conv);
			}
		}

		return groups;
	});

	function handleConversationClick(conversationId: string) {
		onSelect(conversationId);
	}

	function handleDeleteClick(e: MouseEvent, conversationId: string) {
		e.stopPropagation();
		onDelete(conversationId);
	}

	function formatTime(dateStr: string): string {
		try {
			return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
		} catch {
			return '';
		}
	}
</script>

<aside
	class="flex h-full w-72 flex-shrink-0 flex-col border-r border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
>
	<!-- Header with New Conversation button -->
	<div class="flex-shrink-0 border-b border-gray-200 p-4 dark:border-gray-700">
		<button
			type="button"
			onclick={onNewConversation}
			class="bg-primary hover:bg-primary/90 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-medium text-white transition-colors"
		>
			<Plus class="h-5 w-5" />
			New Conversation
		</button>
	</div>

	<!-- Search -->
	<div class="flex-shrink-0 border-b border-gray-200 p-3 dark:border-gray-700">
		<div class="relative">
			<Search class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
			<input
				type="text"
				placeholder="Search conversations..."
				bind:value={searchQuery}
				class="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pr-3 pl-9 text-sm transition-colors placeholder:text-gray-400 focus:border-[rgb(34,51,95)] focus:ring-1 focus:ring-[rgb(34,51,95)] focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
			/>
		</div>
	</div>

	<!-- Conversation List -->
	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if isLoading}
			<div class="flex h-32 items-center justify-center">
				<Loader2 class="h-6 w-6 animate-spin text-gray-400" />
			</div>
		{:else if filteredConversations.length === 0}
			<div class="flex h-32 flex-col items-center justify-center p-4 text-center">
				<MessageSquare class="mb-2 h-8 w-8 text-gray-300 dark:text-gray-600" />
				<p class="text-sm text-gray-500 dark:text-gray-400">
					{searchQuery ? 'No conversations found' : 'No conversations yet'}
				</p>
			</div>
		{:else}
			<!-- Today -->
			{#if groupedConversations.today.length > 0}
				<div class="px-3 pt-3">
					<h3
						class="mb-1 text-xs font-semibold tracking-wider text-gray-400 uppercase dark:text-gray-500"
					>
						Today
					</h3>
				</div>
				{#each groupedConversations.today as conv (conv.id)}
					<div
						role="button"
						tabindex="0"
						onclick={() => handleConversationClick(conv.id)}
						onkeydown={(e) => e.key === 'Enter' && handleConversationClick(conv.id)}
						class="group flex w-full cursor-pointer items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 {activeConversationId ===
						conv.id
							? 'bg-primary/10 dark:bg-primary/20'
							: ''}"
					>
						<div class="min-w-0 flex-1">
							<h4
								class="truncate text-sm font-medium text-gray-900 dark:text-gray-100 {activeConversationId ===
								conv.id
									? 'text-primary dark:text-blue-300'
									: ''}"
							>
								{conv.title || 'Untitled Conversation'}
							</h4>
							{#if conv.preview}
								<p class="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
									{conv.preview}
								</p>
							{/if}
							<p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
								{formatTime(conv.updated_at)}
							</p>
						</div>
						<button
							type="button"
							onclick={(e) => handleDeleteClick(e, conv.id)}
							class="flex-shrink-0 rounded p-1 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
							title="Delete conversation"
						>
							<Trash2 class="h-4 w-4" />
						</button>
					</div>
				{/each}
			{/if}

			<!-- Yesterday -->
			{#if groupedConversations.yesterday.length > 0}
				<div class="px-3 pt-4">
					<h3
						class="mb-1 text-xs font-semibold tracking-wider text-gray-400 uppercase dark:text-gray-500"
					>
						Yesterday
					</h3>
				</div>
				{#each groupedConversations.yesterday as conv (conv.id)}
					<div
						role="button"
						tabindex="0"
						onclick={() => handleConversationClick(conv.id)}
						onkeydown={(e) => e.key === 'Enter' && handleConversationClick(conv.id)}
						class="group flex w-full cursor-pointer items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 {activeConversationId ===
						conv.id
							? 'bg-primary/10 dark:bg-primary/20'
							: ''}"
					>
						<div class="min-w-0 flex-1">
							<h4
								class="truncate text-sm font-medium text-gray-900 dark:text-gray-100 {activeConversationId ===
								conv.id
									? 'text-primary dark:text-blue-300'
									: ''}"
							>
								{conv.title || 'Untitled Conversation'}
							</h4>
							{#if conv.preview}
								<p class="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
									{conv.preview}
								</p>
							{/if}
							<p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
								{formatTime(conv.updated_at)}
							</p>
						</div>
						<button
							type="button"
							onclick={(e) => handleDeleteClick(e, conv.id)}
							class="flex-shrink-0 rounded p-1 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
							title="Delete conversation"
						>
							<Trash2 class="h-4 w-4" />
						</button>
					</div>
				{/each}
			{/if}

			<!-- This Week -->
			{#if groupedConversations.thisWeek.length > 0}
				<div class="px-3 pt-4">
					<h3
						class="mb-1 text-xs font-semibold tracking-wider text-gray-400 uppercase dark:text-gray-500"
					>
						This Week
					</h3>
				</div>
				{#each groupedConversations.thisWeek as conv (conv.id)}
					<div
						role="button"
						tabindex="0"
						onclick={() => handleConversationClick(conv.id)}
						onkeydown={(e) => e.key === 'Enter' && handleConversationClick(conv.id)}
						class="group flex w-full cursor-pointer items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 {activeConversationId ===
						conv.id
							? 'bg-primary/10 dark:bg-primary/20'
							: ''}"
					>
						<div class="min-w-0 flex-1">
							<h4
								class="truncate text-sm font-medium text-gray-900 dark:text-gray-100 {activeConversationId ===
								conv.id
									? 'text-primary dark:text-blue-300'
									: ''}"
							>
								{conv.title || 'Untitled Conversation'}
							</h4>
							{#if conv.preview}
								<p class="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
									{conv.preview}
								</p>
							{/if}
							<p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
								{formatTime(conv.updated_at)}
							</p>
						</div>
						<button
							type="button"
							onclick={(e) => handleDeleteClick(e, conv.id)}
							class="flex-shrink-0 rounded p-1 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
							title="Delete conversation"
						>
							<Trash2 class="h-4 w-4" />
						</button>
					</div>
				{/each}
			{/if}

			<!-- Older -->
			{#if groupedConversations.older.length > 0}
				<div class="px-3 pt-4">
					<h3
						class="mb-1 text-xs font-semibold tracking-wider text-gray-400 uppercase dark:text-gray-500"
					>
						Older
					</h3>
				</div>
				{#each groupedConversations.older as conv (conv.id)}
					<div
						role="button"
						tabindex="0"
						onclick={() => handleConversationClick(conv.id)}
						onkeydown={(e) => e.key === 'Enter' && handleConversationClick(conv.id)}
						class="group flex w-full cursor-pointer items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 {activeConversationId ===
						conv.id
							? 'bg-primary/10 dark:bg-primary/20'
							: ''}"
					>
						<div class="min-w-0 flex-1">
							<h4
								class="truncate text-sm font-medium text-gray-900 dark:text-gray-100 {activeConversationId ===
								conv.id
									? 'text-primary dark:text-blue-300'
									: ''}"
							>
								{conv.title || 'Untitled Conversation'}
							</h4>
							{#if conv.preview}
								<p class="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
									{conv.preview}
								</p>
							{/if}
							<p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
								{formatTime(conv.updated_at)}
							</p>
						</div>
						<button
							type="button"
							onclick={(e) => handleDeleteClick(e, conv.id)}
							class="flex-shrink-0 rounded p-1 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
							title="Delete conversation"
						>
							<Trash2 class="h-4 w-4" />
						</button>
					</div>
				{/each}
			{/if}

			<!-- Infinite scroll sentinel and loading indicator -->
			{#if hasMore}
				<div bind:this={sentinelEl} class="flex items-center justify-center py-4">
					{#if isLoadingMore}
						<Loader2 class="h-5 w-5 animate-spin text-gray-400" />
					{/if}
				</div>
			{:else}
				<!-- Bottom padding -->
				<div class="h-4"></div>
			{/if}
		{/if}
	</div>
</aside>

<script lang="ts">
	import { storageRefToUrl } from '$lib/utils/inline-media';
	import { onMount } from 'svelte';
	import { userStore } from '$lib/stores/auth';
	import {
		searchUsers,
		sendFriendRequest,
		acceptFriendRequest,
		rejectFriendRequest,
		getFriends,
		getPendingRequests,
		type UserConnection
	} from '$lib/services/friend.service';
	import { translate } from '$lib/i18n';
	import { Users, UserPlus, Search, Check, X, Loader2, UserCheck } from 'lucide-svelte';
	import { pendingFriendRequestCount } from '$lib/stores/friends.svelte';
	import { toast } from 'svelte-sonner';

	let t = $derived($translate);

	let searchQuery = $state('');
	let searchResults = $state<
		Array<{ id: string; username: string; full_name: string | null; avatar_url: string | null }>
	>([]);
	let isSearching = $state(false);
	let searchTimer: ReturnType<typeof setTimeout> | null = null;

	let friends = $state<UserConnection[]>([]);
	let pendingRequests = $state<UserConnection[]>([]);
	let isLoading = $state(true);
	let sendingTo = $state<Set<string>>(new Set());

	onMount(async () => {
		await loadData();
	});

	async function loadData() {
		if (!$userStore?.id) return;
		isLoading = true;
		try {
			[friends, pendingRequests] = await Promise.all([
				getFriends($userStore.id),
				getPendingRequests($userStore.id)
			]);
			pendingFriendRequestCount.set(pendingRequests.length);
		} catch (err) {
			console.error('Failed to load friends:', err);
		} finally {
			isLoading = false;
		}
	}

	function handleSearch() {
		if (searchTimer) clearTimeout(searchTimer);
		if (!searchQuery.trim() || searchQuery.trim().length < 2) {
			searchResults = [];
			return;
		}
		searchTimer = setTimeout(async () => {
			isSearching = true;
			try {
				searchResults = await searchUsers(searchQuery.trim(), $userStore?.id);
				// Filter out existing friends and self
				const friendIds = new Set(
					friends.map((f) => (f.user_id === $userStore?.id ? f.friend_id : f.user_id))
				);
				const pendingIds = new Set(pendingRequests.map((r) => r.user_id));
				searchResults = searchResults.filter(
					(u) => u.id !== $userStore?.id && !friendIds.has(u.id) && !pendingIds.has(u.id)
				);
			} finally {
				isSearching = false;
			}
		}, 300);
	}

	async function handleSendRequest(userId: string) {
		if (!$userStore?.id) return;
		sendingTo = new Set([...sendingTo, userId]);
		try {
			await sendFriendRequest($userStore.id, userId);
			toast.success(
				`Friend request sent to @${searchResults.find((u) => u.id === userId)?.username}`
			);
			searchResults = searchResults.filter((u) => u.id !== userId);
		} catch (err) {
			toast.error('Failed to send request');
		} finally {
			const next = new Set(sendingTo);
			next.delete(userId);
			sendingTo = next;
		}
	}

	async function handleAccept(connectionId: string) {
		try {
			await acceptFriendRequest(connectionId);
			toast.success('Friend added');
			await loadData();
		} catch {
			toast.error('Failed to accept request');
		}
	}

	async function handleReject(connectionId: string) {
		try {
			await rejectFriendRequest(connectionId);
			await loadData();
		} catch {
			toast.error('Failed to reject request');
		}
	}
</script>

<svelte:head>
	<title>Friends · Wayli</title>
</svelte:head>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex items-center gap-3">
		<Users class="text-primary h-6 w-6" />
		<div>
			<h1 class="text-foreground text-xl font-bold">Friends</h1>
			<p class="text-muted-foreground text-sm">Manage your connections and share trips</p>
		</div>
	</div>

	{#if isLoading}
		<div class="flex justify-center py-12">
			<Loader2 class="text-muted-foreground h-8 w-8 animate-spin" />
		</div>
	{:else}
		<!-- Search -->
		<div class="relative">
			<Search class="text-muted-foreground absolute top-3 left-3 h-4 w-4" />
			<input
				type="text"
				bind:value={searchQuery}
				oninput={handleSearch}
				placeholder="Search by username..."
				class="border-border focus:ring-primary w-full rounded-xl border bg-transparent py-2.5 pr-4 pl-10 text-sm focus:ring-2 focus:outline-none"
			/>
			{#if isSearching}
				<Loader2 class="text-muted-foreground absolute top-3 right-3 h-4 w-4 animate-spin" />
			{/if}
		</div>

		<!-- Search results -->
		{#if searchResults.length > 0}
			<div class="space-y-2">
				{#each searchResults as user (user.id)}
					<div class="bg-card border-border flex items-center gap-3 rounded-xl border p-3">
						{#if user.avatar_url}
							<img
								src={storageRefToUrl(user.avatar_url)}
								alt=""
								class="h-10 w-10 rounded-full object-cover"
							/>
						{:else}
							<div
								class="bg-muted flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold"
							>
								{user.username[0]?.toUpperCase()}
							</div>
						{/if}
						<div class="flex-1">
							<p class="text-foreground text-sm font-medium">@{user.username}</p>
							{#if user.full_name}
								<p class="text-muted-foreground text-xs">{user.full_name}</p>
							{/if}
						</div>
						<button
							type="button"
							onclick={() => handleSendRequest(user.id)}
							disabled={sendingTo.has(user.id)}
							class="bg-primary hover:bg-primary/90 text-primary-foreground inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
						>
							{#if sendingTo.has(user.id)}
								<Loader2 class="h-3 w-3 animate-spin" />
							{:else}
								<UserPlus class="h-3 w-3" />
							{/if}
							Add
						</button>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Pending requests -->
		{#if pendingRequests.length > 0}
			<div>
				<h2 class="text-foreground mb-3 text-sm font-bold tracking-wide uppercase">
					Pending requests ({pendingRequests.length})
				</h2>
				<div class="space-y-2">
					{#each pendingRequests as req (req.id)}
						<div class="bg-card border-border flex items-center gap-3 rounded-xl border p-3">
							{#if req.avatar_url}
								<img
									src={storageRefToUrl(req.avatar_url)}
									alt=""
									class="h-10 w-10 rounded-full object-cover"
								/>
							{:else}
								<div
									class="bg-muted flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold"
								>
									{req.username?.[0]?.toUpperCase() ?? '?'}
								</div>
							{/if}
							<div class="flex-1">
								<p class="text-foreground text-sm font-medium">@{req.username}</p>
							</div>
							<button
								type="button"
								onclick={() => handleAccept(req.id)}
								class="bg-primary hover:bg-primary/90 text-primary-foreground inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium"
							>
								<Check class="h-3 w-3" />
								Accept
							</button>
							<button
								type="button"
								onclick={() => handleReject(req.id)}
								class="border-border text-muted-foreground hover:text-destructive inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-medium"
							>
								<X class="h-3 w-3" />
							</button>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Friends list -->
		<div>
			<h2 class="text-foreground mb-3 text-sm font-bold tracking-wide uppercase">
				Your friends ({friends.length})
			</h2>
			{#if friends.length === 0}
				<div class="text-muted-foreground py-8 text-center text-sm">
					No friends yet. Search for users above to send a friend request.
				</div>
			{:else}
				<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
					{#each friends as friend (friend.id)}
						<div class="bg-card border-border flex items-center gap-3 rounded-xl border p-3">
							{#if friend.avatar_url}
								<img
									src={storageRefToUrl(friend.avatar_url)}
									alt=""
									class="h-10 w-10 rounded-full object-cover"
								/>
							{:else}
								<div
									class="bg-muted flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold"
								>
									{friend.username?.[0]?.toUpperCase() ?? '?'}
								</div>
							{/if}
							<div class="flex-1">
								<p class="text-foreground text-sm font-medium">@{friend.username}</p>
								{#if friend.full_name}
									<p class="text-muted-foreground text-xs">{friend.full_name}</p>
								{/if}
							</div>
							<UserCheck class="text-muted-foreground h-4 w-4" />
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

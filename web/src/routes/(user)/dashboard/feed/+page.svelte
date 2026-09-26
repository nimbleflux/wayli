<script lang="ts">
	import { storageRefToUrl } from '$lib/utils/inline-media';
	import { onMount } from 'svelte';
	import { fluxbase } from '$lib/fluxbase';
	import { userStore } from '$lib/stores/auth';
	import { getFriends } from '$lib/services/friend.service';
	import { getSharedTrips } from '$lib/services/trip-share.service';
	import { renderMarkdown } from '$lib/utils/markdown';
	import { translate } from '$lib/i18n';
	import { BookOpen, Calendar, Newspaper, Loader2 } from 'lucide-svelte';

	let t = $derived($translate);
	let isLoading = $state(true);
	let entries = $state<
		Array<{
			id: string;
			trip_id: string;
			title: string;
			body: string;
			entry_date: string;
			trip_title?: string;
			trip_image_url?: string | null;
			username?: string;
		}>
	>([]);

	onMount(async () => {
		await loadFeed();
	});

	async function loadFeed() {
		if (!$userStore?.id) return;
		isLoading = true;
		try {
			// 1. Get trip IDs shared with this user
			const sharedTripIds = await getSharedTrips($userStore.id);

			// 2. Fetch entries from shared trips
			let friendEntries: any[] = [];
			if (sharedTripIds.length > 0) {
				const { data } = await fluxbase
					.from('trip_entries')
					.select('id, trip_id, title, body, entry_date, cover_media_id')
					.in('trip_id', sharedTripIds)
					.eq('status', 'published')
					.order('entry_date', { ascending: false })
					.limit(10);
				friendEntries = (data as any[]) ?? [];
			}

			// 3. Fetch public entries from the server
			const { data: publicTrips } = await fluxbase
				.from('trips')
				.select('id, title, image_url, user_id')
				.eq('visibility', 'public')
				.in('status', ['active', 'completed'])
				.order('start_date', { ascending: false })
				.limit(10);

			const publicTripsList = (publicTrips as any[]) ?? [];
			let publicEntries: any[] = [];
			if (publicTripsList.length > 0) {
				// Exclude trips already covered by friends shares
				const publicTripIds = publicTripsList
					.map((t) => t.id)
					.filter((id) => !sharedTripIds.includes(id));

				if (publicTripIds.length > 0) {
					const { data } = await fluxbase
						.from('trip_entries')
						.select('id, trip_id, title, body, entry_date, cover_media_id')
						.in('trip_id', publicTripIds)
						.eq('status', 'published')
						.order('entry_date', { ascending: false })
						.limit(10);
					publicEntries = (data as any[]) ?? [];
				}
			}

			// 4. Merge and deduplicate
			const seenIds = new Set<string>();
			const allEntries = [...friendEntries, ...publicEntries].filter((e) => {
				if (seenIds.has(e.id)) return false;
				seenIds.add(e.id);
				return true;
			});

			// 5. Enrich with trip + user info
			const allTripIds = [...new Set(allEntries.map((e) => e.trip_id))];
			if (allTripIds.length === 0) {
				entries = [];
				return;
			}

			// Combine trip info from both sources
			const tripMap = new Map<string, any>();
			for (const t of publicTripsList) tripMap.set(t.id, t);

			// Fetch trip info for friend-shared trips not in publicTripsList
			const missingTripIds = allTripIds.filter((id) => !tripMap.has(id));
			if (missingTripIds.length > 0) {
				const { data: friendTrips } = await fluxbase
					.from('trips')
					.select('id, title, image_url, user_id')
					.in('id', missingTripIds);
				for (const t of (friendTrips as any[]) ?? []) tripMap.set(t.id, t);
			}

			// Fetch usernames
			const userIds = [...new Set([...tripMap.values()].map((t) => t.user_id))];
			const profileMap = new Map<string, string>();
			if (userIds.length > 0) {
				const { data: profiles } = await fluxbase
					.from('public_profiles')
					.select('id, username')
					.in('id', userIds);
				for (const p of (profiles as any[]) ?? []) profileMap.set(p.id, p.username);
			}

			// Fetch cover media for entries that have cover_media_id set
			const mediaMap = new Map<string, string>();
			const mediaIds = [...new Set(allEntries.map((e) => e.cover_media_id).filter(Boolean))];
			if (mediaIds.length > 0) {
				const { data: media } = await fluxbase
					.from('trip_media')
					.select('id, thumbnail_path, storage_path')
					.in('id', mediaIds);
				for (const m of (media as any[]) ?? []) {
					mediaMap.set(m.id, m.thumbnail_path ?? m.storage_path);
				}
			}

			entries = allEntries
				.map((e) => {
					const trip = tripMap.get(e.trip_id);
					const entryCover = e.cover_media_id ? mediaMap.get(e.cover_media_id) : null;
					return {
						...e,
						trip_title: trip?.title,
						trip_image_url: entryCover ?? trip?.image_url,
						username: trip ? profileMap.get(trip.user_id) : undefined
					};
				})
				.sort((a, b) => (b.entry_date || '').localeCompare(a.entry_date || ''))
				.slice(0, 20);
		} catch (err) {
			console.error('Failed to load feed:', err);
		} finally {
			isLoading = false;
		}
	}
</script>

<svelte:head>
	<title>Feed · Wayli</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-center gap-3">
		<Newspaper class="text-primary h-6 w-6" />
		<div>
			<h1 class="text-foreground text-xl font-bold">Feed</h1>
			<p class="text-muted-foreground text-sm">Latest stories from friends and community</p>
		</div>
	</div>

	{#if isLoading}
		<div class="flex justify-center py-12">
			<Loader2 class="text-muted-foreground h-8 w-8 animate-spin" />
		</div>
	{:else if entries.length === 0}
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<BookOpen class="text-muted-foreground mb-4 h-12 w-12 opacity-30" />
			<p class="text-muted-foreground">No stories yet.</p>
			<p class="text-muted-foreground mt-1 text-sm">
				Add friends or check back later for new entries.
			</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each entries as entry (entry.id)}
				{@const storyHref = entry.username
					? `/u/${entry.username}/trips/${entry.trip_id}?entry=${entry.id}`
					: null}
				{@const Tag = storyHref ? 'a' : 'div'}
				<svelte:element
					this={Tag}
					href={storyHref ?? undefined}
					class="bg-card border-border hover:border-primary/40 flex flex-col overflow-hidden rounded-2xl border transition-colors {storyHref
						? 'cursor-pointer'
						: ''}"
				>
					{#if entry.trip_image_url}
						<div class="h-40 overflow-hidden">
							<img
								src={storageRefToUrl(entry.trip_image_url)}
								alt=""
								class="h-full w-full object-cover"
								loading="lazy"
							/>
						</div>
					{/if}
					<div class="flex flex-1 flex-col p-5">
						<div class="text-muted-foreground mb-2 flex items-center gap-2 text-xs">
							<Calendar class="h-3 w-3" />
							{new Date(entry.entry_date).toLocaleDateString(undefined, {
								weekday: 'long',
								month: 'long',
								day: 'numeric',
								year: 'numeric'
							})}
							{#if entry.username}
								<span class="ml-auto">by @{entry.username}</span>
							{/if}
						</div>
						<h2 class="text-foreground mb-2 text-lg font-bold">
							{entry.title || entry.trip_title}
						</h2>
						{#if entry.body}
							<div class="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
								<!-- eslint-disable-next-line svelte/no-at-html-tags -->
								{@html renderMarkdown(entry.body.slice(0, 500))}
							</div>
							{#if entry.body.length > 500}
								<span class="text-primary mt-2 inline-block text-sm font-medium">
									Read more →
								</span>
							{/if}
						{/if}
					</div>
				</svelte:element>
			{/each}
		</div>
	{/if}
</div>

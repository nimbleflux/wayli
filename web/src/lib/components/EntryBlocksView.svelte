<script lang="ts">
	/**
	 * Read-side renderer for block-based journal entries: text blocks render
	 * as markdown, photo blocks as thumbnail grids with a lightbox. Used by
	 * the travel dashboard and the public trip page.
	 */
	import { renderMarkdown } from '$lib/utils/markdown';
	import type { EntryBlock } from '$lib/types/journal.types';
	import { X, ChevronLeft, ChevronRight } from 'lucide-svelte';

	type ViewMedia = { url: string; fullUrl?: string; caption?: string | null };

	type Props = {
		blocks: EntryBlock[];
		mediaById: Map<string, ViewMedia>;
	};

	let { blocks, mediaById }: Props = $props();

	/** All photos across blocks, in block order — the lightbox sequence. */
	const flatPhotos = $derived(
		blocks
			.flatMap((b) => (b.t === 'photos' ? b.ids : []))
			.map((id) => ({ id, ...mediaById.get(id) }))
	);

	let lightboxId = $state<string | null>(null);
	const lightboxIndex = $derived(
		lightboxId ? flatPhotos.findIndex((p) => p.id === lightboxId) : -1
	);

	function openLightbox(id: string) {
		lightboxId = id;
	}

	function navigateLightbox(direction: number) {
		if (lightboxIndex === -1 || flatPhotos.length === 0) return;
		const next = (lightboxIndex + direction + flatPhotos.length) % flatPhotos.length;
		lightboxId = flatPhotos[next].id;
	}

	let touchStartX = 0;
	function handleTouchStart(e: TouchEvent) {
		touchStartX = e.touches[0].clientX;
	}
	function handleTouchEnd(e: TouchEvent) {
		const dx = e.changedTouches[0].clientX - touchStartX;
		if (Math.abs(dx) > 50) navigateLightbox(dx > 0 ? -1 : 1);
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (lightboxId === null) return;
		if (e.key === 'Escape') lightboxId = null;
		else if (e.key === 'ArrowLeft') navigateLightbox(-1);
		else if (e.key === 'ArrowRight') navigateLightbox(1);
	}}
/>

<div class="flex flex-col gap-3">
	{#each blocks as block (block)}
		{#if block.t === 'text' && block.md.trim()}
			<!-- break-words: an unbreakable long word (URL) must not force the
			     entry wider than its column. -->
			<div class="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed break-words">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{@html renderMarkdown(block.md)}
			</div>
		{:else if block.t === 'photos' && block.ids.length > 0}
			<div class="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
				{#each block.ids as mediaId (mediaId)}
					{@const media = mediaById.get(mediaId)}
					{#if media}
						<button
							type="button"
							onclick={() => openLightbox(mediaId)}
							class="aspect-square overflow-hidden rounded-md"
							aria-label="View photo"
						>
							<img
								src={media.url}
								alt={media.caption || 'Trip photo'}
								class="h-full w-full object-cover transition-transform hover:scale-105"
								loading="lazy"
							/>
						</button>
					{/if}
				{/each}
			</div>
		{/if}
	{/each}
</div>

{#if lightboxId !== null && lightboxIndex >= 0}
	{@const photo = flatPhotos[lightboxIndex]}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="fixed inset-0 z-50 flex items-start justify-center bg-black/90 pt-8"
		onclick={() => (lightboxId = null)}
		onkeydown={(e) => e.key === 'Escape' && (lightboxId = null)}
		ontouchstart={handleTouchStart}
		ontouchend={handleTouchEnd}
		role="presentation"
	>
		<button
			type="button"
			class="absolute top-4 right-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
			aria-label="Close"><X class="h-6 w-6" /></button
		>
		{#if flatPhotos.length > 1}
			<button
				type="button"
				class="absolute top-1/2 left-4 z-10 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
				onclick={(e) => {
					e.stopPropagation();
					navigateLightbox(-1);
				}}
				aria-label="Previous photo"
			>
				<ChevronLeft class="h-6 w-6" />
			</button>
			<button
				type="button"
				class="absolute top-1/2 right-4 z-10 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
				onclick={(e) => {
					e.stopPropagation();
					navigateLightbox(1);
				}}
				aria-label="Next photo"
			>
				<ChevronRight class="h-6 w-6" />
			</button>
		{/if}
		<img
			src={photo.fullUrl ?? photo.url}
			alt={photo.caption || 'Photo'}
			class="animate-scale-in max-h-[92vh] max-w-full rounded-lg object-contain"
			role="presentation"
		/>
	</div>
{/if}

<script lang="ts">
	import { storageRefToUrl } from '$lib/utils/inline-media';
	import { onMount } from 'svelte';
	import { userStore } from '$lib/stores/auth';
	import { page } from '$app/state';
	import type { TripMedia } from '$lib/types/media.types';
	import {
		listMedia,
		createMedia,
		deleteMedia,
		uploadMedia,
		reorderMedia
	} from '$lib/services/trip-media.service';
	import { compressImage } from '$lib/utils/image-compress';
	import { ImagePlus, Trash2, X, Loader2, Star, ChevronLeft, ChevronRight } from 'lucide-svelte';

	type Props = {
		tripId: string;
		entryId?: string;
		coverMediaId?: string | null;
		onCoverChange?: (mediaId: string, photoUrl?: string) => void;
		/** Storage refs already placed inline in the entry body — the read-view
		 * gallery hides them so photos don't appear twice. */
		excludeRefs?: Set<string>;
	};

	let { tripId, entryId, coverMediaId = null, onCoverChange, excludeRefs }: Props = $props();

	let media = $state<TripMedia[]>([]);
	let isLoading = $state(true);
	let isUploading = $state(false);
	let lightbox = $state<TripMedia | null>(null);
	let fileInput: HTMLInputElement;
	let draggedId = $state<string | null>(null);
	let dragOverId = $state<string | null>(null);

	const tripIdSafe = $derived(page.params.tripId ?? tripId);

	onMount(async () => {
		await loadMedia();
	});

	async function loadMedia() {
		isLoading = true;
		try {
			let all = await listMedia(tripIdSafe);
			if (entryId) {
				all = all.filter((m) => m.entry_id === entryId);
			}
			if (excludeRefs) {
				all = all.filter((m) => !excludeRefs.has(m.storage_path));
			}
			media = all;
		} catch (err) {
			console.error('Failed to load media:', err);
		} finally {
			isLoading = false;
		}
	}

	async function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		if (!input.files || input.files.length === 0) return;
		if (!$userStore?.id) return;

		isUploading = true;
		try {
			for (const file of Array.from(input.files)) {
				if (!file.type.startsWith('image/')) continue;

				// Compress client-side (max 2048px, quality 0.85 + 400px thumbnail)
				const { full, thumbnail } = await compressImage(file);

				// Upload both variants
				const timestamp = Date.now();
				const fullPath = await uploadMedia(
					$userStore.id,
					tripIdSafe,
					full.blob,
					`${timestamp}-${file.name}`
				);
				const thumbPath = await uploadMedia(
					$userStore.id,
					tripIdSafe,
					thumbnail.blob,
					`${timestamp}-thumb-${file.name}`
				);

				// Create metadata row
				const created = await createMedia({
					user_id: $userStore.id,
					trip_id: tripIdSafe,
					entry_id: entryId,
					storage_path: fullPath,
					thumbnail_path: thumbPath,
					width: full.width,
					height: full.height,
					taken_at: full.takenAt ?? undefined,
					exif: full.exif ?? undefined
				});
				media = [...media, created];
			}
		} catch (err) {
			console.error('Upload failed:', err);
		} finally {
			isUploading = false;
			input.value = ''; // reset for re-upload
		}
	}

	async function handleDelete(item: TripMedia) {
		if (!confirm('Delete this photo?')) return;
		try {
			await deleteMedia(item);
			media = media.filter((m) => m.id !== item.id);
			if (lightbox?.id === item.id) lightbox = null;
		} catch (err) {
			console.error('Delete failed:', err);
		}
	}

	function handleDragStart(e: DragEvent, item: TripMedia) {
		draggedId = item.id;
		e.dataTransfer?.setData('text/plain', item.id);
		e.dataTransfer!.effectAllowed = 'move';
	}

	function handleDragOver(e: DragEvent, item: TripMedia) {
		e.preventDefault();
		e.dataTransfer!.dropEffect = 'move';
		if (draggedId && draggedId !== item.id) {
			dragOverId = item.id;
		}
	}

	function handleDragLeave() {
		dragOverId = null;
	}

	async function handleDrop(e: DragEvent, target: TripMedia) {
		e.preventDefault();
		dragOverId = null;
		if (!draggedId || draggedId === target.id) {
			draggedId = null;
			return;
		}

		const fromIdx = media.findIndex((m) => m.id === draggedId);
		const toIdx = media.findIndex((m) => m.id === target.id);
		if (fromIdx === -1 || toIdx === -1) {
			draggedId = null;
			return;
		}

		// Reorder array
		const reordered = [...media];
		const [moved] = reordered.splice(fromIdx, 1);
		reordered.splice(toIdx, 0, moved);
		media = reordered;
		draggedId = null;

		// Persist new sort_order
		try {
			await reorderMedia(reordered);
		} catch {
			// non-critical — UI is already updated
		}
	}

	function handleDragEnd() {
		draggedId = null;
		dragOverId = null;
	}

	function navigateLightbox(direction: number) {
		if (!lightbox || media.length === 0) return;
		const currentIdx = media.findIndex((m) => m.id === lightbox!.id);
		if (currentIdx === -1) return;
		const nextIdx = (currentIdx + direction + media.length) % media.length;
		lightbox = media[nextIdx];
	}

	let touchStartX = 0;
	function handleTouchStart(e: TouchEvent) {
		touchStartX = e.touches[0].clientX;
	}
	function handleTouchEnd(e: TouchEvent) {
		const dx = e.changedTouches[0].clientX - touchStartX;
		if (Math.abs(dx) > 50) {
			navigateLightbox(dx > 0 ? -1 : 1);
		}
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (!lightbox) return;
		if (e.key === 'Escape') lightbox = null;
		else if (e.key === 'ArrowLeft') navigateLightbox(-1);
		else if (e.key === 'ArrowRight') navigateLightbox(1);
	}}
/>

<div>
	<input
		bind:this={fileInput}
		type="file"
		accept="image/*"
		multiple
		class="hidden"
		onchange={handleFileSelect}
	/>

	{#if isLoading}
		<!-- silent: no flash -->
	{:else if media.length === 0}
		<button
			type="button"
			onclick={() => fileInput.click()}
			disabled={isUploading}
			class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors disabled:opacity-50"
		>
			{#if isUploading}
				<Loader2 class="h-3 w-3 animate-spin" /> Uploading...
			{:else}
				<ImagePlus class="h-3 w-3" /> Add photos
			{/if}
		</button>
	{:else}
		<div class="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
			{#each media as item (item.id)}
				<div
					class="group relative aspect-square overflow-hidden rounded-md transition-opacity {draggedId ===
					item.id
						? 'opacity-30'
						: ''} {dragOverId === item.id ? 'ring-primary ring-2' : ''}"
					draggable="true"
					role="button"
					tabindex="0"
					aria-label="Photo. Drag to reorder."
					ondragstart={(e) => handleDragStart(e, item)}
					ondragover={(e) => handleDragOver(e, item)}
					ondragleave={handleDragLeave}
					ondrop={(e) => handleDrop(e, item)}
					ondragend={handleDragEnd}
				>
					{#if coverMediaId === item.id}
						<div class="absolute top-1 left-1 z-10 rounded-full bg-amber-400 p-1 shadow-lg">
							<Star class="h-3 w-3 fill-white text-white" />
						</div>
					{/if}
					<button
						type="button"
						onclick={() => (lightbox = item)}
						class="h-full w-full cursor-pointer"
						aria-label="View photo"
					>
						<img
							src={storageRefToUrl(item.thumbnail_path ?? item.storage_path)}
							alt={item.caption || 'Trip photo'}
							class="h-full w-full object-cover transition-transform group-hover:scale-105"
							loading="lazy"
						/>
					</button>
					<button
						type="button"
						onclick={() => handleDelete(item)}
						class="bg-destructive absolute top-1 right-1 rounded-full p-1 text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
						aria-label="Delete photo"><Trash2 class="h-3 w-3" /></button
					>
					{#if onCoverChange && entryId && coverMediaId !== item.id}
						<button
							type="button"
							onclick={() => onCoverChange(item.id, item.thumbnail_path ?? item.storage_path)}
							class="absolute bottom-1 left-1 rounded-full bg-black/50 p-1 text-amber-300 opacity-0 shadow-lg backdrop-blur-sm transition-opacity group-hover:opacity-100"
							aria-label="Set as cover photo"
							title="Set as cover"><Star class="h-3 w-3" /></button
						>
					{/if}
				</div>
			{/each}
			<!-- Add tile -->
			<button
				type="button"
				onclick={() => fileInput.click()}
				disabled={isUploading}
				class="border-border text-muted-foreground hover:text-foreground hover:bg-muted flex aspect-square items-center justify-center rounded-md border border-dashed transition-colors disabled:opacity-50"
				aria-label="Add photos"
			>
				{#if isUploading}
					<Loader2 class="h-4 w-4 animate-spin" />
				{:else}
					<ImagePlus class="h-4 w-4" />
				{/if}
			</button>
		</div>
	{/if}
</div>

<!-- Lightbox -->
{#if lightbox}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="fixed inset-0 z-50 flex items-start justify-center bg-black/90 pt-8"
		onclick={() => (lightbox = null)}
		onkeydown={(e) => e.key === 'Escape' && (lightbox = null)}
		ontouchstart={handleTouchStart}
		ontouchend={handleTouchEnd}
		role="presentation"
	>
		<button
			type="button"
			class="absolute top-4 right-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
			aria-label="Close"><X class="h-6 w-6" /></button
		>
		{#if media.length > 1}
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
			src={storageRefToUrl(lightbox.storage_path)}
			alt={lightbox.caption || 'Photo'}
			class="animate-scale-in max-h-[92vh] max-w-full rounded-lg object-contain"
			role="presentation"
		/>
	</div>
{/if}

<script lang="ts">
	/**
	 * Block-based journal entry editor: an ordered list of text (markdown) and
	 * photo blocks. Photos always live in photo blocks — there is no separate
	 * "leftover gallery" anymore. The parent owns upload/delete/cover
	 * semantics and the media lookup; this component owns block structure.
	 */
	import MarkdownEditor from './MarkdownEditor.svelte';
	import type { EntryBlock } from '$lib/types/journal.types';
	import {
		ImagePlus,
		Type,
		Trash2,
		Star,
		Loader2,
		ArrowUp,
		ArrowDown,
		X,
		Camera
	} from 'lucide-svelte';

	type ViewMedia = { url: string; caption?: string | null };

	type Props = {
		/** Block list — $bindable, mutated in place via reassignment. */
		blocks: EntryBlock[];
		/** Media lookup for rendering photo block thumbnails. */
		mediaById: Map<string, ViewMedia>;
		coverMediaId?: string | null;
		/** Persist "set as cover" (star). */
		onSetCover?: (mediaId: string) => void;
		/** Upload picked files; resolves with the created media ids. */
		onAddPhotos: (files: File[]) => Promise<string[]>;
		/** Open the Immich picker; resolves with the created media ids (#13). */
		onOpenImmichPicker?: () => Promise<string[]>;
		/** Whether the Immich integration is connected + enabled. */
		immichEnabled?: boolean;
		/** Delete a media row (fires after the inline confirm step). */
		onDeletePhoto?: (mediaId: string) => Promise<void>;
		disabled?: boolean;
	};

	let {
		blocks = $bindable(),
		mediaById,
		coverMediaId = null,
		onSetCover,
		onAddPhotos,
		onOpenImmichPicker,
		immichEnabled = false,
		onDeletePhoto,
		disabled = false
	}: Props = $props();

	let fileInput = $state<HTMLInputElement>();
	let uploading = $state(false);
	/** Media id armed for deletion — second click within the window deletes. */
	let armedDeleteId = $state<string | null>(null);
	let armTimer: ReturnType<typeof setTimeout> | undefined;

	function addTextBlock() {
		blocks = [...blocks, { t: 'text', md: '' }];
	}

	function appendPhotoIds(ids: string[]) {
		if (ids.length === 0) return;
		const last = blocks[blocks.length - 1];
		if (last?.t === 'photos') {
			const rest = blocks.slice(0, -1);
			blocks = [...rest, { t: 'photos', ids: [...last.ids, ...ids] }];
		} else {
			blocks = [...blocks, { t: 'photos', ids }];
		}
	}

	async function handleImmichPicker() {
		if (!onOpenImmichPicker) return;
		uploading = true;
		try {
			const ids = await onOpenImmichPicker();
			appendPhotoIds(ids);
		} finally {
			uploading = false;
		}
	}

	async function handleFileSelect(event: Event) {
		const input = event.target as HTMLInputElement;
		const files = Array.from(input.files ?? []).filter((f) => f.type.startsWith('image/'));
		input.value = '';
		if (files.length === 0) return;
		uploading = true;
		try {
			const ids = await onAddPhotos(files);
			if (ids.length === 0) return;
			const last = blocks[blocks.length - 1];
			if (last?.t === 'photos') {
				// Batch-extends the trailing photo block.
				const rest = blocks.slice(0, -1);
				blocks = [...rest, { t: 'photos', ids: [...last.ids, ...ids] }];
			} else {
				blocks = [...blocks, { t: 'photos', ids }];
			}
		} finally {
			uploading = false;
		}
	}

	function moveBlock(index: number, delta: number) {
		const target = index + delta;
		if (target < 0 || target >= blocks.length) return;
		const next = [...blocks];
		const [moved] = next.splice(index, 1);
		next.splice(target, 0, moved);
		blocks = next;
	}

	/** Remove a block. Photo blocks take their media rows with them. */
	async function removeBlock(index: number) {
		const block = blocks[index];
		if (block?.t === 'photos') {
			const ids = [...block.ids];
			blocks = blocks.filter((_, i) => i !== index);
			if (onDeletePhoto) {
				for (const id of ids) await onDeletePhoto(id).catch(() => {});
			}
		} else {
			blocks = blocks.filter((_, i) => i !== index);
		}
	}

	function removePhoto(blockIndex: number, mediaId: string) {
		if (armedDeleteId !== mediaId) {
			// First click arms; a stray click anywhere else disarms.
			armedDeleteId = mediaId;
			clearTimeout(armTimer);
			armTimer = setTimeout(() => (armedDeleteId = null), 3000);
			return;
		}
		armedDeleteId = null;
		clearTimeout(armTimer);
		const block = blocks[blockIndex];
		if (block?.t !== 'photos') return;
		const ids = block.ids.filter((id) => id !== mediaId);
		blocks = blocks
			.map((b, i) => (i === blockIndex ? { t: 'photos' as const, ids } : b))
			.filter((b) => b.t === 'text' || b.ids.length > 0);
		onDeletePhoto?.(mediaId).catch(() => {});
	}
</script>

<svelte:window onpointerdown={() => (armedDeleteId = null)} />

<div class="flex flex-col gap-3">
	<input
		bind:this={fileInput}
		type="file"
		accept="image/*"
		multiple
		class="hidden"
		onchange={handleFileSelect}
	/>

	{#each blocks as block, index (index)}
		<div class="border-border bg-card relative rounded-lg border p-3">
			<!-- Block controls -->
			<div class="text-muted-foreground absolute -top-3 right-2 z-10 flex gap-0.5">
				<button
					type="button"
					onclick={() => moveBlock(index, -1)}
					disabled={index === 0 || disabled}
					class="bg-background hover:bg-muted rounded p-1 disabled:opacity-30"
					aria-label="Move block up"><ArrowUp class="h-3.5 w-3.5" /></button
				>
				<button
					type="button"
					onclick={() => moveBlock(index, 1)}
					disabled={index === blocks.length - 1 || disabled}
					class="bg-background hover:bg-muted rounded p-1 disabled:opacity-30"
					aria-label="Move block down"><ArrowDown class="h-3.5 w-3.5" /></button
				>
				<button
					type="button"
					onclick={() => removeBlock(index)}
					{disabled}
					class="bg-background hover:bg-muted rounded p-1 disabled:opacity-30"
					aria-label="Remove block"><X class="h-3.5 w-3.5" /></button
				>
			</div>

			{#if block.t === 'text'}
				<MarkdownEditor
					bind:value={block.md}
					placeholder="Write this part of the story in markdown..."
				/>
			{:else}
				<div class="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
					{#each block.ids as mediaId (mediaId)}
						{@const media = mediaById.get(mediaId)}
						<div class="group relative aspect-square overflow-hidden rounded-md">
							{#if coverMediaId === mediaId}
								<div class="absolute top-1 left-1 z-10 rounded-full bg-amber-400 p-1 shadow-lg">
									<Star class="h-3 w-3 fill-white text-white" />
								</div>
							{/if}
							<img
								src={media?.url}
								alt={media?.caption || 'Trip photo'}
								class="h-full w-full object-cover"
								loading="lazy"
							/>
							{#if onSetCover && coverMediaId !== mediaId}
								<button
									type="button"
									onclick={() => onSetCover(mediaId)}
									class="absolute bottom-1 left-1 rounded-full bg-black/50 p-1 text-amber-300 opacity-0 shadow-lg backdrop-blur-sm transition-opacity group-hover:opacity-100"
									aria-label="Set as cover photo"
									title="Set as cover"><Star class="h-3 w-3" /></button
								>
							{/if}
							<button
								type="button"
								onclick={() => removePhoto(index, mediaId)}
								class="absolute top-1 right-1 rounded-full p-1 text-white shadow-lg transition-opacity {armedDeleteId ===
								mediaId
									? 'bg-destructive opacity-100'
									: 'bg-destructive opacity-0 group-hover:opacity-100'}"
								aria-label={armedDeleteId === mediaId ? 'Click again to delete' : 'Delete photo'}
								title={armedDeleteId === mediaId ? 'Click again to delete' : 'Delete'}
							>
								<Trash2 class="h-3 w-3" />
							</button>
						</div>
					{/each}
					<!-- Add tile (extends this photo block) -->
					<button
						type="button"
						onclick={() => fileInput?.click()}
						disabled={uploading || disabled}
						class="border-border text-muted-foreground hover:text-foreground hover:bg-muted flex aspect-square items-center justify-center rounded-md border border-dashed transition-colors disabled:opacity-50"
						aria-label="Add photos to this block"
					>
						{#if uploading}
							<Loader2 class="h-4 w-4 animate-spin" />
						{:else}
							<ImagePlus class="h-4 w-4" />
						{/if}
					</button>
				</div>
			{/if}
		</div>
	{/each}

	{#if blocks.length === 0}
		<p class="text-muted-foreground py-6 text-center text-sm">
			Empty entry — add a text block or some photos to start.
		</p>
	{/if}

	<!-- Add-block actions -->
	<div class="flex gap-2">
		<button
			type="button"
			onclick={addTextBlock}
			{disabled}
			class="border-border text-foreground hover:bg-muted inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
		>
			<Type class="h-3.5 w-3.5" /> Add text
		</button>
		<button
			type="button"
			onclick={() => fileInput?.click()}
			disabled={uploading || disabled}
			class="border-border text-foreground hover:bg-muted inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
		>
			{#if uploading}
				<Loader2 class="h-3.5 w-3.5 animate-spin" /> Uploading…
			{:else}
				<ImagePlus class="h-3.5 w-3.5" /> Add photos
			{/if}
		</button>
		{#if immichEnabled && onOpenImmichPicker}
			<button
				type="button"
				onclick={handleImmichPicker}
				disabled={uploading || disabled}
				class="border-border text-foreground hover:bg-muted inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
			>
				<Camera class="h-3.5 w-3.5" /> Add from Immich
			</button>
		{/if}
	</div>
</div>

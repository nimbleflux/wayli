<script lang="ts">
	// Horizontal strip of Immich photos taken on a single day, shown under the
	// journal day headers. Display-only; thumbnails stream through the
	// immich-thumb proxy (object URLs, cached by the service).
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n';
	import { X } from 'lucide-svelte';
	import { loadPhotosForRange, getThumbUrl, type ThumbRow } from '$lib/services/immich.service';
	import { immichSettings } from '$lib/stores/immich.svelte';
	import { getSetting, loadPublicSettings } from '$lib/stores/settings.svelte';

	let { date }: { date: string | number | Date } = $props();

	let photos = $state<ThumbRow[]>([]);
	let loaded = $state(false);
	let preview = $state<ThumbRow | null>(null);
	let previewUrl = $state('');
	let displayDay = $state('');

	/** Normalize any date-ish value to "YYYY-MM-DD" (same as the picker). */
	function normalizeToDay(value: unknown): string {
		if (value == null) return '';
		if (value instanceof Date) {
			return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
		}
		if (typeof value === 'number') {
			const d = new Date(value);
			return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
		}
		const str = String(value);
		if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
		const d = new Date(str);
		if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
		return '';
	}

	onMount(async () => {
		// Guard: a missing or malformed date must not crash the page.
		const day = normalizeToDay(date);
		displayDay = day;
		const start = new Date(`${day}T00:00:00.000Z`);
		if (!day || Number.isNaN(start.getTime())) {
			loaded = true;
			return;
		}
		try {
			const end = new Date(start);
			end.setUTCDate(end.getUTCDate() + 1);
			photos = (await loadPhotosForRange(start.toISOString(), end.toISOString())) as ThumbRow[];
		} catch {
			// Query failure — render nothing rather than crashing the page.
		} finally {
			loaded = true;
		}
	});

	async function loadThumb(assetId: string, el: HTMLImageElement) {
		const url = await getThumbUrl(assetId);
		if (url) el.src = url;
	}

	async function openPreview(photo: ThumbRow) {
		preview = photo;
		previewUrl = await immichPhotoUrl(photo.asset_id);
	}

	async function immichPhotoUrl(assetId: string): Promise<string> {
		await loadPublicSettings();
		const base = (immichSettings()?.server_url || getSetting('wayli.immich_endpoint', '')).replace(
			/\/+$/,
			''
		);
		return `${base}/photos/${assetId}`;
	}
</script>

{#if loaded && photos.length > 0}
	<!-- min-w-0: the strip's intrinsic width scales with photo count; clamp it
	     so grid/flex ancestors without their own width cap don't blow out. -->
	<div class="mb-3 min-w-0">
		<p class="text-muted-foreground mb-1.5 text-xs font-medium">
			{t('travel.immichPhotosTakenOn', { date: displayDay })}
		</p>
		<div class="flex gap-2 overflow-x-auto pb-1">
			{#each photos as photo (photo.asset_id)}
				<button
					type="button"
					class="border-border h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-md border"
					onclick={() => openPreview(photo)}
					title={photo.city ?? ''}
				>
					<img
						src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="
						alt={photo.city ?? 'Photo'}
						loading="lazy"
						class="h-full w-full object-cover"
						onload={(e) => loadThumb(photo.asset_id, e.currentTarget as HTMLImageElement)}
					/>
				</button>
			{/each}
		</div>
	</div>
{/if}

{#if preview}
	<div
		class="fixed inset-0 z-[1002] flex items-center justify-center bg-black/70 p-4"
		onclick={(e) => e.target === e.currentTarget && (preview = null)}
		onkeydown={(e) => e.key === 'Escape' && (preview = null)}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div class="dark:bg-card relative max-w-2xl rounded-xl bg-white p-4 shadow-xl">
			<button
				type="button"
				class="absolute top-2 right-2 cursor-pointer rounded-md bg-white/80 p-1"
				onclick={() => (preview = null)}
				aria-label={t('common.close')}
			>
				<X class="h-4 w-4" />
			</button>
			{#await getThumbUrl(preview.asset_id, 'preview') then url}
				{#if url}
					<img src={url} alt={preview.city ?? 'Photo'} class="max-h-[70vh] rounded-lg" />
				{/if}
			{/await}
			<p class="text-muted-foreground mt-2 text-sm">
				{[
					new Date(preview.taken_at).toLocaleString(),
					[preview.city, preview.state, preview.country].filter(Boolean).join(', ')
				]
					.filter(Boolean)
					.join(' · ')}
			</p>
			<a
				class="text-primary text-sm underline underline-offset-2"
				href={previewUrl}
				target="_blank"
				rel="noopener"
			>
				{t('statistics.immichOpenInImmich')}
			</a>
		</div>
	</div>
{/if}

<script lang="ts">
	// Immich photo picker: browse geotagged photos around a date, multi-select,
	// and attach copies to a journal entry / trip (#13).
	//
	// Queries the user's Immich library LIVE via the immich-search function
	// (server-side API key) — always fresh, no sync prerequisite. Falls back
	// to the local immich_assets cache when Immich is unreachable.
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n';
	import { X, Loader2, Check } from 'lucide-svelte';
	import { fluxbase } from '$lib/fluxbase';
	import {
		searchPhotosLive,
		loadPhotosForRange,
		getThumbUrl,
		type ThumbRow
	} from '$lib/services/immich.service';
	import { attachPhotosToEntry } from '$lib/services/immich-attach.service';

	let {
		open,
		tripId,
		entryId,
		initialDate,
		onadded,
		onclose
	}: {
		open: boolean;
		tripId: string;
		entryId?: string;
		/** String date, Date object, or ms timestamp — normalized internally. */
		initialDate: string | number | Date;
		onadded?: (mediaIds: string[]) => void;
		onclose?: () => void;
	} = $props();

	let photos = $state<ThumbRow[]>([]);
	let selected = $state<Set<string>>(new Set());
	let loading = $state(false);
	let attaching = $state(false);
	let rangeDays = $state(3);
	let resultMessage = $state('');
	let userId = $state('');
	/** True when the live query failed and the cache was used (or empty). */
	let usingCache = $state(false);

	// The component is always mounted with open=true (it's inside {#if} in the
	// parent), so onMount is the reliable entry point. A $effect keyed on
	// `open` was unreliable here — in production it didn't reliably trigger
	// the initial load.
	onMount(() => {
		if (!open) return;
		console.log('[immich-picker] mounted, initialDate:', JSON.stringify(initialDate));
		void (async () => {
			try {
				const { data } = await fluxbase.auth.getUser();
				userId = data?.user?.id ?? '';
			} catch {
				userId = '';
			}
		})();
		void load();
	});

	/**
	 * Normalize any date-ish value to a "YYYY-MM-DD" day string. The Travel
	 * page's DateRangePicker binds a Date object (or its ms timestamp) to
	 * editorDate — String(date).slice(0,10) produces "1758672000" (the epoch
	 * prefix) which parses as INVALID. Handle: string "YYYY-MM-DD", string
	 * full ISO, number (ms epoch), Date object, null/undefined.
	 */
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
		// Already "YYYY-MM-DD" (or starts with it)
		if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
		// Full ISO timestamp string
		const d = new Date(str);
		if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
		return '';
	}

	async function load() {
		loading = true;
		resultMessage = '';
		selected = new Set();
		usingCache = false;
		try {
			const day = normalizeToDay(initialDate);
			const base = day ? new Date(`${day}T00:00:00.000Z`) : new Date(NaN);
			console.log(
				'[immich-picker] load(): initialDate =',
				JSON.stringify(initialDate),
				'→ day =',
				day
			);
			if (!day || Number.isNaN(base.getTime())) {
				photos = [];
				return;
			}
			const start = new Date(base);
			start.setUTCDate(start.getUTCDate() - rangeDays);
			const end = new Date(base);
			end.setUTCDate(end.getUTCDate() + rangeDays + 1);
			const startIso = start.toISOString();
			const endIso = end.toISOString();

			// Live query first — always fresh, no sync needed.
			console.log('[immich-picker] calling searchPhotosLive');
			const live = await searchPhotosLive(startIso, endIso);
			console.log('[immich-picker] searchPhotosLive returned:', live.length, 'photos');
			if (live.length > 0) {
				photos = live;
				return;
			}
			// Live returned nothing: could be genuinely empty OR Immich
			// unreachable/disabled. Fall back to the local cache — if the
			// cache has rows for this range, show them.
			const cached = await loadPhotosForRange(startIso, endIso);
			console.log('[immich-picker] cache fallback:', cached.length, 'photos');
			if (cached.length > 0) {
				photos = cached;
				usingCache = true;
				return;
			}
			photos = [];
		} catch {
			photos = [];
		} finally {
			// Minimum 300ms display so the spinner is actually visible even
			// for instant (cached/guard) responses — without this the loading
			// state toggles true→false in one batch and never renders.
			await new Promise((r) => setTimeout(r, 300));
			loading = false;
		}
	}

	function toggleSelect(assetId: string) {
		const next = new Set(selected);
		if (next.has(assetId)) next.delete(assetId);
		else next.add(assetId);
		selected = next;
	}

	async function addSelected() {
		attaching = true;
		try {
			const chosen = photos.filter((p) => selected.has(p.asset_id));
			const result = await attachPhotosToEntry({
				userId,
				tripId,
				entryId,
				assets: chosen
			});
			resultMessage = t('connections.immich.pickerAddedCount', {
				count: result.added,
				failed: result.failed
			});
			photos = photos.filter((p) => !selected.has(p.asset_id));
			selected = new Set();
			if (result.added > 0) {
				onadded?.(result.created.map((c) => c.id));
			}
		} finally {
			attaching = false;
		}
	}

	function close() {
		previewClose();
	}
	function previewClose() {
		// parent controls `open`; ask it to close
		onclose?.();
	}

	async function loadThumb(assetId: string, el: HTMLImageElement) {
		const url = await getThumbUrl(assetId);
		if (url) el.src = url;
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-[1003] flex items-center justify-center bg-black/50 p-4"
		onclick={(e) => e.target === e.currentTarget && previewClose()}
		onkeydown={(e) => e.key === 'Escape' && previewClose()}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div
			class="dark:bg-card flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl bg-white p-6 shadow-xl"
		>
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-foreground text-lg font-semibold">
					{t('connections.immich.pickerTitle')}
				</h2>
				<button
					type="button"
					class="text-muted-foreground hover:text-foreground cursor-pointer"
					onclick={previewClose}
					aria-label={t('common.close')}
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<div class="mb-4 flex items-center gap-2">
				<label for="immichPickerRange" class="text-muted-foreground text-sm">
					{t('connections.immich.pickerRangeLabel')}
				</label>
				<select
					id="immichPickerRange"
					bind:value={rangeDays}
					onchange={load}
					class="border-border dark:bg-muted/20 rounded-md border px-2 py-1 text-sm"
				>
					<option value={1}>±1 {t('connections.immich.days')}</option>
					<option value={3}>±3 {t('connections.immich.days')}</option>
					<option value={7}>±7 {t('connections.immich.days')}</option>
					<option value={14}>±14 {t('connections.immich.days')}</option>
				</select>
			</div>

			{#if loading}
				<div class="text-muted-foreground flex items-center gap-2 py-8 text-sm">
					<Loader2 class="h-4 w-4 animate-spin" />
					{t('connections.immich.pickerLoading')}
				</div>
			{:else if photos.length === 0}
				<p class="text-muted-foreground py-8 text-center text-sm">
					{t('connections.immich.pickerEmpty')}
				</p>
			{:else}
				<!-- Scrollable photo grid; the action footer below stays pinned so
				     "Add {n} photos" is reachable without scrolling. -->
				<div class="min-h-0 flex-1 overflow-y-auto">
					<div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
						{#each photos as photo (photo.asset_id)}
							<button
								type="button"
								role="checkbox"
								aria-checked={selected.has(photo.asset_id)}
								class={`relative aspect-square overflow-hidden rounded-md border-2 ${
									selected.has(photo.asset_id) ? 'border-primary' : 'border-transparent'
								}`}
								onclick={() => toggleSelect(photo.asset_id)}
								title={photo.city ?? photo.taken_at}
							>
								<img
									src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="
									alt={photo.city ?? 'Photo'}
									loading="lazy"
									class="h-full w-full object-cover"
									onload={(e) => loadThumb(photo.asset_id, e.currentTarget as HTMLImageElement)}
								/>
								{#if selected.has(photo.asset_id)}
									<span class="bg-primary absolute top-1 right-1 rounded-full p-0.5 text-white">
										<Check class="h-3 w-3" />
									</span>
								{/if}
							</button>
						{/each}
					</div>
				</div>

				<div class="border-border mt-4 flex items-center justify-end gap-2 border-t pt-3">
					{#if usingCache}
						<span
							class="text-muted-foreground text-xs"
							title={t('connections.immich.pickerCacheHint')}
						>
							{t('connections.immich.pickerCached')}
						</span>
					{/if}
					<span class="text-muted-foreground text-sm">
						{selected.size}
						{t('connections.immich.pickerSelected')}
					</span>
					<button
						type="button"
						onclick={addSelected}
						disabled={attaching || selected.size === 0}
						class="bg-primary hover:bg-primary/90 flex cursor-pointer items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#if attaching}
							<Loader2 class="h-4 w-4 animate-spin" />
						{/if}
						{t('connections.immich.pickerAdd', { count: selected.size })}
					</button>
				</div>
			{/if}

			{#if resultMessage}
				<p class="text-muted-foreground mt-3 text-sm">{resultMessage}</p>
			{/if}
		</div>
	</div>
{/if}

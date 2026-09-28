<script lang="ts">
	// Immich photo picker: browse synced geotagged photos around a date,
	// multi-select, and attach copies to a journal entry / trip (#13).
	import { createEventDispatcher } from 'svelte';
	import { t } from '$lib/i18n';
	import { X, Loader2, Check } from 'lucide-svelte';
	import { fluxbase } from '$lib/fluxbase';
	import { loadPhotosForRange, getThumbUrl, type ThumbRow } from '$lib/services/immich.service';
	import { attachPhotosToEntry } from '$lib/services/immich-attach.service';

	let {
		open,
		tripId,
		entryId,
		initialDate
	}: { open: boolean; tripId: string; entryId?: string; initialDate: string } = $props();

	const dispatch = createEventDispatcher<{ added: number; close: void }>();

	let photos = $state<ThumbRow[]>([]);
	let selected = $state<Set<string>>(new Set());
	let loading = $state(false);
	let attaching = $state(false);
	let rangeDays = $state(3);
	let resultMessage = $state('');
	let userId = $state('');

	$effect(() => {
		if (open) {
			void (async () => {
				try {
					const { data } = await fluxbase.auth.getUser();
					userId = data?.user?.id ?? '';
				} catch {
					userId = '';
				}
			})();
			void load();
		}
	});

	async function load() {
		loading = true;
		resultMessage = '';
		selected = new Set();
		try {
			const start = new Date(`${initialDate}T00:00:00.000Z`);
			start.setUTCDate(start.getUTCDate() - rangeDays);
			const end = new Date(`${initialDate}T00:00:00.000Z`);
			end.setUTCDate(end.getUTCDate() + rangeDays + 1);
			photos = await loadPhotosForRange(start.toISOString(), end.toISOString());
		} finally {
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
			if (result.added > 0) dispatch('added', result.added);
		} finally {
			attaching = false;
		}
	}

	function close() {
		previewClose();
	}
	function previewClose() {
		// parent controls `open`; ask it to close
		dispatch('close');
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
			class="dark:bg-card max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
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
					<option value={3}>±3 {t('connections.immich.days')}</option>
					<option value={7}>±7 {t('connections.immich.days')}</option>
					<option value={30}>±30 {t('connections.immich.days')}</option>
					<option value={365}>±365 {t('connections.immich.days')}</option>
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

				<div class="mt-4 flex items-center justify-end gap-2">
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

<script lang="ts">
	import {
		Upload,
		Download,
		UploadCloud,
		FileCheck,
		ChevronDown,
		Loader2,
		MapPin,
		Star,
		Route
	} from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { toast } from 'svelte-sonner';

	import ExportJobs from '$lib/components/ExportJobs.svelte';
	import DateRangePicker from '$lib/components/ui/date-range-picker.svelte';
	import { translate } from '$lib/i18n';
	import { ServiceAdapter } from '$lib/services/api/service-adapter';
	import { jobCreationService } from '$lib/services/job-creation.service';
	import { sessionStore } from '$lib/stores/auth';
	import { isFitnessBetaEnabled, loadFitnessBeta } from '$lib/stores/fitness-beta.svelte';

	let t = $derived($translate);

	// ── Import state ──
	let selectedFile = $state<File | null>(null);
	let importFormat = $state<string | null>(null);
	let isImporting = $state(false);
	let isDragOver = $state(false);
	let fileInputEl = $state<HTMLInputElement | null>(null);
	let lastSuccessfulImport = $state<string | null>(null);

	// ── Export state ──
	let exportExpanded = $state(true);
	let isExporting = $state(false);
	let exportFormat = $state('JSON');
	let exportStartDate = $state<Date | undefined>(undefined);
	let exportEndDate = $state<Date | undefined>(undefined);
	let includeLocationDataExport = $state(true);
	let includeWantToVisitExport = $state(true);
	let includeTripsExport = $state(true);

	// ── Format detection ──
	const ALL_FORMAT_BADGES = [
		{ ext: 'GeoJSON', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
		{ ext: 'GPX', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
		{
			ext: 'KML',
			color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
		},
		{
			ext: 'OwnTracks',
			color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
		},
		{
			ext: 'Polarsteps',
			color: 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300'
		},
		{
			ext: 'FIT',
			color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300'
		}
	];

	// FIT import is part of the fitness beta; it only appears when opted in.
	let fitnessBeta = $state(false);
	let FORMAT_BADGES = $derived(
		fitnessBeta ? ALL_FORMAT_BADGES : ALL_FORMAT_BADGES.filter((b) => b.ext !== 'FIT')
	);

	/** Returns the format id, or null when the file is a .fit but the beta is off. */
	function detectImportFormat(file: File): string | null {
		const name = file.name.toLowerCase();
		if (name.endsWith('.fit')) return fitnessBeta ? 'FIT' : null;
		if (name.endsWith('.geojson') || name.endsWith('.json')) return 'GeoJSON';
		if (name.endsWith('.zip')) return 'Polarsteps';
		if (name.endsWith('.kml')) return 'KML';
		if (name.endsWith('.gpx')) return 'GPX';
		if (name.endsWith('.rec')) return 'OwnTracks';
		return 'GeoJSON';
	}

	// ── File selection (click + drag-drop) ──
	function openFilePicker() {
		fileInputEl?.click();
	}

	function handleFileSelect(event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.files?.[0]) {
			const format = detectImportFormat(target.files[0]);
			if (!format) {
				target.value = '';
				toast.error(t('importExport.fitBetaRequired'));
				return;
			}
			selectedFile = target.files[0];
			importFormat = format;
		}
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		isDragOver = false;
		const file = event.dataTransfer?.files?.[0];
		if (file) {
			const format = detectImportFormat(file);
			if (!format) {
				toast.error(t('importExport.fitBetaRequired'));
				return;
			}
			selectedFile = file;
			importFormat = format;
		}
	}

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		isDragOver = true;
	}

	function handleDragLeave() {
		isDragOver = false;
	}

	function clearFile() {
		selectedFile = null;
		importFormat = null;
		if (fileInputEl) fileInputEl.value = '';
	}

	// ── Import ──
	async function handleImport() {
		if (!selectedFile || !importFormat) {
			toast.error(t('importExport.pleaseSelectFile'));
			return;
		}
		try {
			isImporting = true;
			await jobCreationService.createImportJob(selectedFile, {
				format: importFormat,
				includeLocationData: true,
				includeWantToVisit: true,
				includeTrips: true
			});
			toast.success(t('importExport.uploadSuccessful'));
			clearFile();
		} catch (error) {
			console.error('Import error:', error);
			toast.error(t('importExport.importFailed'));
		} finally {
			isImporting = false;
		}
	}

	// ── Export ──
	async function handleExport() {
		try {
			isExporting = true;
			await jobCreationService.createExportJob({
				format: exportFormat,
				includeLocationData: includeLocationDataExport,
				includeWantToVisit: includeWantToVisitExport,
				includeTrips: includeTripsExport,
				startDate: exportStartDate,
				endDate: exportEndDate
			});
			toast.success(t('importExport.exportStarted'));
			exportStartDate = undefined;
			exportEndDate = undefined;
		} catch (error) {
			console.error('Export error:', error);
			toast.error(t('importExport.exportStartFailed'));
		} finally {
			isExporting = false;
		}
	}

	// ── Last import date ──
	async function fetchLastSuccessfulImport() {
		try {
			const session = $sessionStore;
			if (!session) return;
			const serviceAdapter = new ServiceAdapter({ session });
			const jobsResponse = (await serviceAdapter.getJobs({ type: 'data_import' })) as any;
			const jobs = Array.isArray(jobsResponse) ? jobsResponse : jobsResponse?.data || [];
			const lastCompleted = jobs
				.filter((job: any) => job.status === 'completed')
				.sort(
					(a: any, b: any) =>
						new Date(b.completed_at || b.updated_at).getTime() -
						new Date(a.completed_at || a.updated_at).getTime()
				)[0];
			if (lastCompleted) {
				lastSuccessfulImport = new Date(
					lastCompleted.completed_at || lastCompleted.updated_at
				).toLocaleString('en-US', {
					year: 'numeric',
					month: 'short',
					day: 'numeric',
					hour: '2-digit',
					minute: '2-digit'
				});
			}
		} catch (error) {
			console.error('Error fetching last successful import:', error);
		}
	}

	onMount(fetchLastSuccessfulImport);
	onMount(async () => {
		await loadFitnessBeta();
		fitnessBeta = isFitnessBetaEnabled();
	});
</script>

<svelte:head>
	<title>{t('importExport.title')} · Wayli</title>
</svelte:head>

<div>
	<!-- Header -->
	<div class="mb-8 flex items-center gap-3">
		<Upload class="text-primary h-6 w-6" />
		<div>
			<h1 class="text-foreground text-xl font-bold">{t('importExport.title')}</h1>
			<p class="text-muted-foreground text-sm">{t('importExport.subtitle')}</p>
		</div>
	</div>

	<div class="space-y-8">
		<!-- ═══ Import card (hero) ═══ -->
		<div class="bg-card border-border rounded-xl border p-6">
			<div class="mb-4 flex items-center gap-3">
				<Upload class="text-muted-foreground h-5 w-5" />
				<h2 class="text-foreground text-lg font-semibold">{t('importExport.importData')}</h2>
			</div>

			<!-- Hidden file input -->
			<input
				type="file"
				bind:this={fileInputEl}
				accept={fitnessBeta
					? '.geojson,.json,.kml,.gpx,.rec,.zip,.fit'
					: '.geojson,.json,.kml,.gpx,.rec,.zip'}
				class="hidden"
				onchange={handleFileSelect}
			/>

			<!-- Dropzone -->
			{#if selectedFile}
				<!-- File selected state -->
				<div
					class="border-border flex items-center gap-3 rounded-xl border-2 border-solid p-4"
					role="button"
					tabindex="0"
					onclick={openFilePicker}
					onkeydown={(e) => e.key === 'Enter' && openFilePicker()}
				>
					<div class="text-primary shrink-0">
						<FileCheck class="h-8 w-8" />
					</div>
					<div class="min-w-0 flex-1">
						<p class="text-foreground truncate text-sm font-medium">{selectedFile.name}</p>
						<div class="mt-1 flex items-center gap-2">
							<span
								class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {FORMAT_BADGES.find(
									(f) => f.ext === importFormat
								)?.color ?? 'bg-muted text-muted-foreground'}"
							>
								{importFormat}
							</span>
							<span class="text-muted-foreground text-xs">
								{(selectedFile.size / 1024 / 1024).toFixed(1)} MB
							</span>
						</div>
					</div>
					<button
						type="button"
						onclick={(e) => {
							e.stopPropagation();
							clearFile();
						}}
						class="text-muted-foreground hover:text-foreground shrink-0 text-xs font-medium"
					>
						{t('common.actions.cancel')}
					</button>
				</div>
			{:else}
				<!-- Empty dropzone -->
				<div
					class="hover:border-primary/50 flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors {isDragOver
						? 'border-primary bg-primary/5'
						: 'border-border'}"
					role="button"
					tabindex="0"
					onclick={openFilePicker}
					onkeydown={(e) => e.key === 'Enter' && openFilePicker()}
					ondrop={handleDrop}
					ondragover={handleDragOver}
					ondragleave={handleDragLeave}
				>
					<UploadCloud class="text-muted-foreground h-10 w-10 {isDragOver ? 'text-primary' : ''}" />
					<div>
						<p class="text-foreground text-sm font-medium">
							{t('importExport.selectFile')}
						</p>
						<p class="text-muted-foreground mt-0.5 text-xs">
							{t('importExport.browse')}
						</p>
					</div>
					<div class="mt-2 flex flex-wrap justify-center gap-1.5">
						{#each FORMAT_BADGES as badge (badge.ext)}
							<span
								class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {badge.color}"
							>
								{badge.ext}
							</span>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Last import + button -->
			<div class="mt-4 flex items-center justify-between gap-4">
				{#if lastSuccessfulImport}
					<p class="text-muted-foreground text-xs">
						{t('importExport.lastSuccessfulImport', { date: lastSuccessfulImport })}
					</p>
				{:else}
					<span></span>
				{/if}
				<button
					type="button"
					onclick={handleImport}
					disabled={isImporting || !selectedFile}
					class="bg-primary hover:bg-primary/90 inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
				>
					{#if isImporting}
						<Loader2 class="h-4 w-4 animate-spin" />
						{t('importExport.importing')}
					{:else}
						<Upload class="h-4 w-4" />
						{t('importExport.importDataButton')}
					{/if}
				</button>
			</div>
		</div>

		<!-- ═══ Export card (collapsible) ═══ -->
		<div class="bg-card border-border rounded-xl border p-6">
			<!-- Collapse header -->
			<button
				type="button"
				onclick={() => (exportExpanded = !exportExpanded)}
				class="flex w-full items-center justify-between"
			>
				<div class="flex items-center gap-3">
					<Download class="text-muted-foreground h-5 w-5" />
					<h2 class="text-foreground text-lg font-semibold">{t('importExport.exportData')}</h2>
				</div>
				<ChevronDown
					class="text-muted-foreground h-5 w-5 transition-transform {exportExpanded
						? 'rotate-180'
						: ''}"
				/>
			</button>

			{#if exportExpanded}
				<div transition:slide={{ duration: 200 }} class="mt-4 space-y-4">
					<p class="text-muted-foreground text-sm">{t('importExport.exportDescription')}</p>

					<!-- Include options as toggle pills -->
					<div>
						<span class="text-foreground mb-2 block text-sm font-medium">
							{t('importExport.include')}
						</span>
						<div class="flex flex-wrap gap-2">
							<button
								type="button"
								onclick={() => (includeLocationDataExport = !includeLocationDataExport)}
								class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors {includeLocationDataExport
									? 'border-primary bg-primary/10 text-primary'
									: 'border-border text-muted-foreground hover:border-muted-foreground/50'}"
							>
								<MapPin class="h-3.5 w-3.5" />
								{t('importExport.locationData')}
							</button>
							<button
								type="button"
								onclick={() => (includeWantToVisitExport = !includeWantToVisitExport)}
								class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors {includeWantToVisitExport
									? 'border-primary bg-primary/10 text-primary'
									: 'border-border text-muted-foreground hover:border-muted-foreground/50'}"
							>
								<Star class="h-3.5 w-3.5" />
								{t('importExport.wantToVisit')}
							</button>
							<button
								type="button"
								onclick={() => (includeTripsExport = !includeTripsExport)}
								class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors {includeTripsExport
									? 'border-primary bg-primary/10 text-primary'
									: 'border-border text-muted-foreground hover:border-muted-foreground/50'}"
							>
								<Route class="h-3.5 w-3.5" />
								{t('importExport.trips')}
							</button>
						</div>
					</div>

					<!-- Format + Date range side by side -->
					<div class="flex flex-wrap items-start gap-6">
						<div>
							<label
								class="text-muted-foreground mb-1.5 block text-sm font-medium"
								for="exportFormat"
							>
								{t('importExport.format')}
							</label>
							<select
								id="exportFormat"
								bind:value={exportFormat}
								class="border-border focus:ring-primary rounded-lg border bg-transparent px-3 py-2 text-sm focus:ring-2 focus:outline-none"
							>
								<option value="JSON">JSON</option>
								<option value="GeoJSON">GeoJSON</option>
							</select>
						</div>
						<div class="min-w-[200px] flex-1">
							<span class="text-muted-foreground mb-1.5 block text-sm font-medium">
								{t('importExport.dateRange')}
							</span>
							<DateRangePicker
								bind:startDate={exportStartDate}
								bind:endDate={exportEndDate}
								pickLabel={t('importExport.pickDateRange')}
								showClear={true}
							/>
							{#if !exportStartDate && !exportEndDate}
								<p class="text-muted-foreground mt-1.5 text-xs">
									{t('importExport.exportAllDataHint')}
								</p>
							{/if}
						</div>
					</div>

					<!-- Export button -->
					<div class="flex justify-end">
						<button
							type="button"
							onclick={handleExport}
							disabled={isExporting}
							class="bg-primary hover:bg-primary/90 inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
						>
							{#if isExporting}
								<Loader2 class="h-4 w-4 animate-spin" />
								{t('importExport.statusProcessing')}
							{:else}
								<Download class="h-4 w-4" />
								{t('importExport.exportDataButton')}
							{/if}
						</button>
					</div>
				</div>
			{/if}
		</div>

		<!-- ═══ Export history ═══ -->
		<div class="bg-card border-border rounded-xl border p-6">
			<ExportJobs />
		</div>
	</div>
</div>

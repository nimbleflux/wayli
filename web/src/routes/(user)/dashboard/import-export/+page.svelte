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
		Route,
		Copy,
		X
	} from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { toast } from 'svelte-sonner';

	import DuplicateReviewModal from '$lib/components/DuplicateReviewModal.svelte';
	import ExportJobs from '$lib/components/ExportJobs.svelte';
	import DateRangePicker from '$lib/components/ui/date-range-picker.svelte';
	import { translate } from '$lib/i18n';
	import { ServiceAdapter } from '$lib/services/api/service-adapter';
	import {
		dismissDuplicateReport,
		listDuplicateReports,
		type DuplicateReport
	} from '$lib/services/duplicates.service';
	import { jobCreationService } from '$lib/services/job-creation.service';
	import { sessionStore } from '$lib/stores/auth';
	import { isFitnessBetaEnabled, loadFitnessBeta } from '$lib/stores/fitness-beta.svelte';
	import { allJobs } from '$lib/stores/job-store';

	let t = $derived($translate);

	// ── Import state ──
	// #286: bulk import — every selected file becomes its own queued
	// data-import job (the backend already treats each file independently).
	let selectedFiles = $state<{ file: File; format: string }[]>([]);
	let isImporting = $state(false);
	let isDragOver = $state(false);
	let fileInputEl = $state<HTMLInputElement | null>(null);
	let lastSuccessfulImport = $state<string | null>(null);

	// ── Duplicate reports (#274) ──
	let pendingReports = $state<DuplicateReport[]>([]);
	let reviewingReport = $state<DuplicateReport | null>(null);
	let dismissingReportId = $state<string | null>(null);

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

	/** Detect formats for every file at once; .fit without the beta is skipped. */
	function setSelectedFiles(incoming: FileList | File[]) {
		const accepted: { file: File; format: string }[] = [];
		let skippedFit = 0;
		for (const file of Array.from(incoming)) {
			const format = detectImportFormat(file);
			if (!format) {
				skippedFit++;
				continue;
			}
			accepted.push({ file, format });
		}
		selectedFiles = accepted;
		if (skippedFit > 0) toast.error(t('importExport.fitBetaRequired'));
	}

	function handleFileSelect(event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.files?.length) setSelectedFiles(target.files);
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		isDragOver = false;
		if (event.dataTransfer?.files?.length) setSelectedFiles(event.dataTransfer.files);
	}

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		isDragOver = true;
	}

	function handleDragLeave() {
		isDragOver = false;
	}

	function clearFiles() {
		selectedFiles = [];
		if (fileInputEl) fileInputEl.value = '';
	}

	// ── Import ──
	async function handleImport() {
		if (selectedFiles.length === 0) {
			toast.error(t('importExport.pleaseSelectFile'));
			return;
		}
		isImporting = true;
		let ok = 0;
		try {
			// Sequential submission: each import job kicks off post-import
			// passes (watermark reset, distance RPC, geocoding) — feeding the
			// queue one file at a time keeps those from racing. Progress for
			// the individual uploads shows in the header upload button.
			for (const { file, format } of selectedFiles) {
				try {
					await jobCreationService.createImportJob(file, {
						format,
						includeLocationData: true,
						includeWantToVisit: true,
						includeTrips: true
					});
					ok++;
				} catch (error) {
					console.error(`Import error for ${file.name}:`, error);
				}
			}
			if (ok === selectedFiles.length) {
				toast.success(t('importExport.uploadSuccessful'));
			} else if (ok > 0) {
				toast.warning(t('importExport.bulkQueued', { ok, total: selectedFiles.length }));
			} else {
				toast.error(t('importExport.importFailed'));
			}
			clearFiles();
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

	// ── Duplicate reports (#274) ──
	async function loadPendingReports() {
		try {
			pendingReports = await listDuplicateReports('pending_review');
		} catch (err) {
			console.error('Failed to load duplicate reports:', err);
		}
	}

	function reportTitle(report: DuplicateReport): string {
		if (report.source_type === 'import' && report.source?.file_name) {
			return t('duplicates.bannerTitle', { file: report.source.file_name });
		}
		return t('duplicates.bannerTitleScan');
	}

	// Two-step dismiss: the banner ✕ must not permanently discard a finding on
	// a stray click. First click arms the button (it becomes "Dismiss"),
	// second click confirms; arming clears itself after 4 seconds.
	let confirmingDismissId = $state<string | null>(null);
	let confirmDismissTimer: ReturnType<typeof setTimeout> | null = null;

	function handleBannerDismiss(report: DuplicateReport) {
		if (confirmingDismissId !== report.id) {
			confirmingDismissId = report.id;
			if (confirmDismissTimer) clearTimeout(confirmDismissTimer);
			confirmDismissTimer = setTimeout(() => (confirmingDismissId = null), 4000);
			return;
		}
		if (confirmDismissTimer) clearTimeout(confirmDismissTimer);
		confirmingDismissId = null;
		handleDismissReport(report);
	}

	async function handleDismissReport(report: DuplicateReport) {
		dismissingReportId = report.id;
		try {
			await dismissDuplicateReport(report.id);
			pendingReports = pendingReports.filter((r) => r.id !== report.id);
		} catch (err) {
			console.error('Dismiss failed:', err);
			toast.error(t('duplicates.dismissFailed'));
		} finally {
			dismissingReportId = null;
		}
	}

	// Refresh the banner when a relevant job reaches a terminal state: a
	// data-import can create a new report; a duplicate-cleanup applies one.
	let seenFinishedJobs = new Set<string>();
	$effect(() => {
		for (const job of $allJobs) {
			if (job.status !== 'completed' || seenFinishedJobs.has(job.id)) continue;
			if (job.job_name === 'data-import' || job.job_name === 'duplicate-cleanup') {
				seenFinishedJobs.add(job.id);
				loadPendingReports();
			}
		}
	});

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
	onMount(loadPendingReports);
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
		<!-- ═══ Pending duplicate reports (#274) ═══ -->
		{#if pendingReports.length > 0}
			<div class="space-y-2">
				{#each pendingReports as report (report.id)}
					<div
						class="flex items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-50 p-4 dark:bg-amber-950/20"
					>
						<Copy class="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
						<div class="min-w-0 flex-1">
							<p class="text-foreground truncate text-sm font-semibold">
								{reportTitle(report)}
							</p>
							<p class="text-muted-foreground text-xs">
								{t('duplicates.bannerDescription')
									.replace(
										'{sections}',
										String(report.summary?.section_count ?? report.clusters?.length ?? 0)
									)
									.replace('{points}', String(report.summary?.recommended_remove_count ?? 0))}
							</p>
						</div>
						<button
							type="button"
							onclick={() => (reviewingReport = report)}
							class="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-700"
						>
							{t('duplicates.review')}
						</button>
						<button
							type="button"
							onclick={() => handleBannerDismiss(report)}
							disabled={dismissingReportId === report.id}
							class="text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 shrink-0 rounded-md border border-transparent p-1.5 text-xs font-medium transition-colors disabled:opacity-50 {confirmingDismissId ===
							report.id
								? 'border-destructive/50 text-destructive'
								: ''}"
							aria-label={t('duplicates.dismiss')}
						>
							{#if dismissingReportId === report.id}
								<Loader2 class="h-4 w-4 animate-spin" />
							{:else if confirmingDismissId === report.id}
								{t('duplicates.dismiss')}?
							{:else}
								<X class="h-4 w-4" />
							{/if}
						</button>
					</div>
				{/each}
			</div>
		{/if}

		<!-- ═══ Import card (hero) ═══ -->
		<div class="bg-card border-border rounded-xl border p-6">
			<div class="mb-4 flex items-center gap-3">
				<Upload class="text-muted-foreground h-5 w-5" />
				<h2 class="text-foreground text-lg font-semibold">{t('importExport.importData')}</h2>
			</div>

			<!-- Hidden file input -->
			<input
				type="file"
				multiple
				bind:this={fileInputEl}
				accept={fitnessBeta
					? '.geojson,.json,.kml,.gpx,.rec,.zip,.fit'
					: '.geojson,.json,.kml,.gpx,.rec,.zip'}
				class="hidden"
				onchange={handleFileSelect}
			/>

			<!-- Dropzone -->
			{#if selectedFiles.length > 1}
				<!-- Multi-file selected state (#286) -->
				<div class="border-border rounded-xl border-2 border-solid p-2">
					<div class="max-h-56 space-y-1 overflow-y-auto">
						{#each selectedFiles as entry, i (entry.file.name + i)}
							<div
								class="flex items-center gap-3 rounded-lg p-2 {i % 2 === 0 ? 'bg-muted/40' : ''}"
							>
								<FileCheck class="text-primary h-5 w-5 shrink-0" />
								<div class="min-w-0 flex-1">
									<p class="text-foreground truncate text-sm font-medium">{entry.file.name}</p>
									<div class="mt-0.5 flex items-center gap-2">
										<span
											class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {FORMAT_BADGES.find(
												(f) => f.ext === entry.format
											)?.color ?? 'bg-muted text-muted-foreground'}"
										>
											{entry.format}
										</span>
										<span class="text-muted-foreground text-xs">
											{(entry.file.size / 1024 / 1024).toFixed(1)} MB
										</span>
									</div>
								</div>
								<button
									type="button"
									onclick={() => (selectedFiles = selectedFiles.filter((_, j) => j !== i))}
									class="text-muted-foreground hover:text-destructive shrink-0"
									aria-label={t('common.actions.cancel')}
								>
									<X class="h-4 w-4" />
								</button>
							</div>
						{/each}
					</div>
					<button
						type="button"
						onclick={openFilePicker}
						class="text-primary hover:text-primary/80 mt-1 w-full py-1.5 text-xs font-medium"
					>
						+ {t('importExport.selectFile')}
					</button>
				</div>
			{:else if selectedFiles.length === 1}
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
						<p class="text-foreground truncate text-sm font-medium">{selectedFiles[0].file.name}</p>
						<div class="mt-1 flex items-center gap-2">
							<span
								class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {FORMAT_BADGES.find(
									(f) => f.ext === selectedFiles[0].format
								)?.color ?? 'bg-muted text-muted-foreground'}"
							>
								{selectedFiles[0].format}
							</span>
							<span class="text-muted-foreground text-xs">
								{(selectedFiles[0].file.size / 1024 / 1024).toFixed(1)} MB
							</span>
						</div>
					</div>
					<button
						type="button"
						onclick={(e) => {
							e.stopPropagation();
							clearFiles();
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
					disabled={isImporting || selectedFiles.length === 0}
					class="bg-primary hover:bg-primary/90 inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
				>
					{#if isImporting}
						<Loader2 class="h-4 w-4 animate-spin" />
						{t('importExport.importing')}
					{:else if selectedFiles.length > 1}
						<Upload class="h-4 w-4" />
						{t('importExport.importNDataButton', { n: selectedFiles.length })}
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

<!-- Duplicate review modal (#274) -->
{#if reviewingReport}
	<DuplicateReviewModal
		report={reviewingReport}
		onclose={() => (reviewingReport = null)}
		onSettled={(reportId) => {
			pendingReports = pendingReports.filter((r) => r.id !== reportId);
			reviewingReport = null;
		}}
	/>
{/if}

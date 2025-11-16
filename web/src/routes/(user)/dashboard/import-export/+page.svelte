<script lang="ts">
	import { Import, FileDown, MapPin } from 'lucide-svelte';
	import { onMount, onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';

	import ExportJobs from '$lib/components/ExportJobs.svelte';
	import DateRangePicker from '$lib/components/ui/date-range-picker.svelte';
	import { translate } from '$lib/i18n';
	import { ServiceAdapter } from '$lib/services/api/service-adapter';
	import { jobCreationService } from '$lib/services/job-creation.service';
	import { sessionStore } from '$lib/stores/auth';
	import { subscribe, getActiveJobsMap } from '$lib/stores/job-store';
	import { state as appState } from '$lib/stores/app-state.svelte';

	// Use the reactive translation function
	let t = $derived($translate);

	// Import state
	let importFormat = $state<string | null>(null);
	let selectedFile = $state<File | null>(null);
	let includeLocationData = $state(true);
	let includeWantToVisit = $state(true);
	let includeTrips = $state(true);
	let isImporting = $state(false);
	let fileInputEl = $state<HTMLInputElement | null>(null);

	// Last successful import date
	let lastSuccessfulImport = $state<string | null>(null);

	// Export state
	let exportFormat = $state('JSON');
	let exportStartDate = $state<Date | undefined>(undefined);
	let exportEndDate = $state<Date | undefined>(undefined);

	// Add export state variables for export job creation
	let includeLocationDataExport = $state(true);
	let includeWantToVisitExport = $state(true);
	let includeTripsExport = $state(true);

	// No reload flag needed - ExportJobs component handles its own updates

	// Job store subscription for monitoring export jobs
	let unsubscribeJobs: (() => void) | null = null;

	let importFormats = $derived([
		{
			value: 'GeoJSON',
			label: 'GeoJSON',
			icon: MapPin,
			description: t('importExport.geoJsonDescription')
		}
		// { value: 'GPX', label: 'GPX', icon: Route, description: t('importExport.gpxDescription')},
		// {
		// 	value: 'OwnTracks',
		// 	label: 'OwnTracks (.REC)',
		// 	icon: Route,
		// 	description: t('importExport.ownTracksDescription')
		// }
	]);

	function handleFileSelect(event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.files && target.files.length > 0) {
			selectedFile = target.files[0];
			// Auto-detect format
			detectImportFormat(selectedFile).then((detected) => {
				importFormat = detected;
			});
		}
	}

	async function detectImportFormat(file: File): Promise<string> {
		const name = file.name.toLowerCase();
		if (name.endsWith('.geojson') || name.endsWith('.json')) return 'GeoJSON';
		// if (name.endsWith('.gpx')) return 'GPX';
		// if (name.endsWith('.rec')) return 'OwnTracks';
		return 'GeoJSON'; // Default
	}

	// Import functions
	async function handleImport() {
		if (!selectedFile || !importFormat) {
			toast.error(t('importExport.pleaseSelectFile'));
			return;
		}

		try {
			isImporting = true;

			const result = await jobCreationService.createImportJob(selectedFile, {
				format: importFormat,
				includeLocationData,
				includeWantToVisit,
				includeTrips
			});

			// Immediately add the job to the store so it shows in the sidebar
			if (result?.id) {
				const { addJobToStore } = await import('$lib/stores/job-store');
				addJobToStore({
					id: result.id,
					type: 'data_import',
					status: 'queued',
					progress: 0,
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
					result: undefined,
					error: undefined
				});
				console.log('✅ [IMPORT] Job added to store:', result.id);
			}

			// Reset form
			selectedFile = null;
			importFormat = null;
			includeLocationData = true;
			includeWantToVisit = true;
			includeTrips = true;

			// Clear file input
			if (fileInputEl) {
				fileInputEl.value = '';
			}

			// Refresh the last successful import date after a successful import
			await fetchLastSuccessfulImport();

			// Show success message
			toast.success(t('importExport.uploadSuccessful'));
		} catch (error) {
			console.error('Import error:', error);
			// Show error message
			toast.error(t('importExport.importFailed') || 'Import failed');
		} finally {
			isImporting = false;
		}
	}

	// Fetch last successful import date
	async function fetchLastSuccessfulImport() {
		try {
			const session = $sessionStore;
			if (!session) return;

			const serviceAdapter = new ServiceAdapter({ session });
			const jobsResponse = (await serviceAdapter.getJobs({ type: 'data_import' })) as any;
			const jobs = Array.isArray(jobsResponse) ? jobsResponse : jobsResponse?.data || [];

			// Find the most recent completed import job
			const lastCompletedImport = jobs
				.filter((job: any) => job.status === 'completed')
				.sort(
					(a: any, b: any) =>
						new Date(b.completed_at || b.updated_at).getTime() -
						new Date(a.completed_at || a.updated_at).getTime()
				)[0];

			if (lastCompletedImport) {
				const date = new Date(lastCompletedImport.completed_at || lastCompletedImport.updated_at);
				lastSuccessfulImport = date.toLocaleString('en-US', {
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

	// Fetch last successful import date on mount
	onMount(async () => {
		await fetchLastSuccessfulImport();
		startJobMonitoring();

		// No need for MutationObserver - the bind: directive should handle the syncing automatically
	});

	// Cleanup job store subscription on destroy
	onDestroy(() => {
		if (unsubscribeJobs) {
			unsubscribeJobs();
		}
	});

	// Start job store monitoring for export jobs only
	function startJobMonitoring() {
		console.log('🚀 Starting job store monitoring for export jobs only on import/export page');

		// Subscribe to job store updates but filter for export jobs only
		// This prevents import job progress from triggering export history reloads
		unsubscribeJobs = subscribe(() => {
			// Get current jobs from store
			const activeJobs = getActiveJobsMap();
			const exportJobs = Array.from(activeJobs.values()).filter(
				(job: any) => job.type === 'data_export'
			);

			// ExportJobs component automatically handles updates via Fluxbase Realtime
			if (exportJobs.length > 0) {
				console.log('📊 Export job update detected');
			}
		});
	}

	// ExportJobs component handles its own updates via Fluxbase Realtime - no manual reload needed

	// Export functions
	async function handleExport() {
		if (!exportStartDate || !exportEndDate) {
			toast.error(t('importExport.pleaseSelectDates'));
			return;
		}

		// We know these are Date objects at this point
		const startDate = exportStartDate;
		const endDate = exportEndDate;

		try {
			await jobCreationService.createExportJob({
				format: exportFormat,
				includeLocationData: includeLocationDataExport,
				includeWantToVisit: includeWantToVisitExport,
				includeTrips: includeTripsExport,
				startDate: startDate,
				endDate: endDate
			});

			// Reset form
			exportFormat = 'JSON';
			exportStartDate = undefined;
			exportEndDate = undefined;
			includeLocationDataExport = true;
			includeWantToVisitExport = true;
			includeTripsExport = true;
		} catch (error) {
			console.error('Export error:', error);
		}
	}

	let localExportStartDate = $state<Date | undefined>(undefined);
	let localExportEndDate = $state<Date | undefined>(undefined);

	// Initialize from app state if available
	$effect(() => {
		if (appState.filtersStartDate instanceof Date && !localExportStartDate) {
			localExportStartDate = appState.filtersStartDate;
		}
		if (appState.filtersEndDate instanceof Date && !localExportEndDate) {
			localExportEndDate = appState.filtersEndDate;
		}
	});

	// Sync local dates to export dates
	$effect(() => {
		exportStartDate = localExportStartDate;
		exportEndDate = localExportEndDate;
	});

	function handleExportDateRangeChange() {
		// Ensure the dates are properly synced when the picker changes
		if (localExportStartDate instanceof Date) {
			exportStartDate = localExportStartDate;
			appState.filtersStartDate = localExportStartDate;
		}
		if (localExportEndDate instanceof Date) {
			exportEndDate = localExportEndDate;
			appState.filtersEndDate = localExportEndDate;
		}
	}
</script>

<svelte:head>
	<title>{t('importExport.title')} - Wayli</title>
</svelte:head>

<div>
	<!-- Header -->
	<div class="mb-8">
		<div class="flex items-center gap-3">
			<Import class="h-8 w-8 text-blue-600 dark:text-gray-400" />
			<h1 class="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
				{t('importExport.title')}
			</h1>
		</div>
	</div>

	<div class="grid gap-8 md:grid-cols-2">
		<!-- Import Section -->
		<div
			class="flex flex-col rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
		>
			<div class="mb-6 flex items-center gap-3">
				<FileDown class="h-5 w-5 text-gray-400" />
				<h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">
					{t('importExport.importData')}
				</h2>
			</div>
			<p class="mb-6 text-sm text-gray-600 dark:text-gray-300">
				{t('importExport.importDescription')}
			</p>
			{#if lastSuccessfulImport}
				<div class="mb-4 text-xs text-gray-500 dark:text-gray-400">
					{t('importExport.lastSuccessfulImport', { date: lastSuccessfulImport })}
				</div>
			{/if}

			<div class="flex-1 space-y-4">
				<div>
					<label
						for="fileInput"
						class="mb-1.5 block text-sm font-medium text-gray-900 dark:text-gray-100"
						>{t('importExport.selectFile')}</label
					>
					<div class="relative">
						<label for="fileInput" class="absolute inset-0 z-10 cursor-pointer"></label>
						<input
							type="file"
							id="fileInput"
							bind:this={fileInputEl}
							accept=".geojson,.json"
							class="block w-full cursor-pointer rounded-md border border-gray-300 text-sm text-gray-500 file:mr-4 file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-blue-600 hover:file:bg-blue-100 dark:border-gray-600 dark:text-gray-300 dark:file:bg-gray-700 dark:file:text-blue-400 dark:hover:file:bg-gray-600"
							onchange={handleFileSelect}
						/>
					</div>
					{#if selectedFile}
						<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
							{t('importExport.selectedFile', { filename: selectedFile.name })}
							{#if importFormat}
								| {t('importExport.detectedFormat', { format: importFormat })}
							{/if}
						</p>
					{/if}
				</div>

				<div class="mt-6">
					<h3 class="mb-3 text-sm font-medium text-gray-900 dark:text-gray-100">
						{t('importExport.supportedFormats')}
					</h3>
					<div class="space-y-2 text-sm text-gray-600 dark:text-gray-300">
						{#each importFormats as format (format.label)}
							<div class="flex items-center gap-2">
								<format.icon class="h-4 w-4" />
								<span>{format.label} - {format.description}</span>
							</div>
						{/each}
					</div>
				</div>

				<!-- Import button only shown if no active job -->
				<button
					type="button"
					onclick={handleImport}
					disabled={isImporting || !selectedFile}
					class="mt-6 flex w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-[rgb(37,140,244)] px-4 py-2 text-sm font-medium text-white hover:bg-[rgb(37,140,244)]/90 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{#if isImporting}
						<div class="h-4 w-4 animate-spin rounded-full border-b-2 border-white"></div>
						{t('importExport.importing')}
					{:else}
						<Import class="h-4 w-4" />
						{t('importExport.importDataButton')}
					{/if}
				</button>
			</div>
		</div>

		<!-- Export Section -->
		<div
			class="flex flex-col rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
		>
			<div class="mb-6 flex items-center gap-3">
				<FileDown class="h-5 w-5 text-gray-400" />
				<h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">
					{t('importExport.exportData')}
				</h2>
			</div>
			<p class="mb-6 text-sm text-gray-600 dark:text-gray-300">
				{t('importExport.exportDescription')}
			</p>

			<div class="flex-1 space-y-4">
				<div>
					<label
						class="mb-1.5 block text-sm font-medium text-gray-900 dark:text-gray-100"
						for="includeLocationData">{t('importExport.include')}</label
					>
					<div class="space-y-2">
						<label class="flex items-center gap-2">
							<input
								type="checkbox"
								bind:checked={includeLocationDataExport}
								class="h-4 w-4 rounded border-gray-300 text-[rgb(37,140,244)] focus:ring-[rgb(37,140,244)]"
							/>
							<span class="text-sm text-gray-600 dark:text-gray-300"
								>{t('importExport.locationData')}</span
							>
						</label>
						<label class="flex items-center gap-2">
							<input
								type="checkbox"
								bind:checked={includeWantToVisitExport}
								class="h-4 w-4 rounded border-gray-300 text-[rgb(37,140,244)] focus:ring-[rgb(37,140,244)]"
							/>
							<span class="text-sm text-gray-600 dark:text-gray-300"
								>{t('importExport.wantToVisit')}</span
							>
						</label>
						<label class="flex items-center gap-2">
							<input
								type="checkbox"
								bind:checked={includeTripsExport}
								class="h-4 w-4 rounded border-gray-300 text-[rgb(37,140,244)] focus:ring-[rgb(37,140,244)]"
							/>
							<span class="text-sm text-gray-600 dark:text-gray-300">{t('importExport.trips')}</span
							>
						</label>
					</div>
				</div>
				<div class="mt-4">
					<span class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
						>{t('importExport.dateRange')}</span
					>
					<div class="datepicker-import-export-fix relative">
						<DateRangePicker
							bind:startDate={localExportStartDate}
							bind:endDate={localExportEndDate}
							pickLabel={t('importExport.pickDateRange')}
							onChange={handleExportDateRangeChange}
							showClear={false}
						/>
					</div>
				</div>
			</div>

			<button
				onclick={handleExport}
				class="mt-6 flex w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-[rgb(37,140,244)] px-4 py-2 text-sm font-medium text-white hover:bg-[rgb(37,140,244)]/90"
			>
				<FileDown class="h-4 w-4" />
				{t('importExport.exportDataButton')}
			</button>
		</div>
	</div>

	<!-- Export Jobs Section -->
	<div class="mt-8">
		<ExportJobs />
	</div>
</div>

<style>
	/* Styles removed - were not being applied to scoped components */
</style>

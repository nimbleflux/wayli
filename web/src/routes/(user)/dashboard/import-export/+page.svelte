<script lang="ts">
	import { Import, FileDown, MapPin, Route } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';

	import ExportJobs from '$lib/components/ExportJobs.svelte';
	import DateRangePicker from '$lib/components/ui/date-range-picker.svelte';
	import { translate } from '$lib/i18n';
	import { ServiceAdapter } from '$lib/services/api/service-adapter';
	import { jobCreationService } from '$lib/services/job-creation.service';
	import { sessionStore } from '$lib/stores/auth';
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

	let importFormats = $derived([
		{
			value: 'GeoJSON',
			label: 'GeoJSON',
			icon: MapPin,
			description: t('importExport.geoJsonDescription')
		},
		{
			value: 'KML',
			label: 'KML',
			icon: MapPin,
			description: t('importExport.kmlDescription')
		},
		{
			value: 'GPX',
			label: 'GPX',
			icon: Route,
			description: t('importExport.gpxDescription')
		},
		{
			value: 'OwnTracks',
			label: 'OwnTracks (.REC)',
			icon: Route,
			description: t('importExport.ownTracksDescription')
		}
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
		if (name.endsWith('.kml')) return 'KML';
		if (name.endsWith('.gpx')) return 'GPX';
		if (name.endsWith('.rec')) return 'OwnTracks';
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

			await jobCreationService.createImportJob(selectedFile, {
				format: importFormat,
				includeLocationData,
				includeWantToVisit,
				includeTrips
			});

			// Job will appear in sidebar automatically via Realtime subscription

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
	});

	// Export functions
	async function handleExport() {
		// Dates are optional - no date range means "export all data"
		try {
			await jobCreationService.createExportJob({
				format: exportFormat,
				includeLocationData: includeLocationDataExport,
				includeWantToVisit: includeWantToVisitExport,
				includeTrips: includeTripsExport,
				startDate: exportStartDate,
				endDate: exportEndDate
			});

			// Reset date range only - preserve checkbox preferences
			exportFormat = 'JSON';
			exportStartDate = undefined;
			exportEndDate = undefined;
			localExportStartDate = undefined;
			localExportEndDate = undefined;
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
		} else {
			exportStartDate = undefined;
			appState.filtersStartDate = undefined;
		}
		if (localExportEndDate instanceof Date) {
			exportEndDate = localExportEndDate;
			appState.filtersEndDate = localExportEndDate;
		} else {
			exportEndDate = undefined;
			appState.filtersEndDate = undefined;
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
			<Import class="text-primary h-8 w-8 dark:text-gray-400" />
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
							accept=".geojson,.json,.kml"
							class="file:bg-primary/5 file:text-primary hover:file:bg-primary/10 block w-full cursor-pointer rounded-md border border-gray-300 text-sm text-gray-500 file:mr-4 file:border-0 file:px-4 file:py-2 file:text-sm file:font-medium dark:border-gray-600 dark:text-gray-300 dark:file:bg-gray-700 dark:file:text-gray-300 dark:hover:file:bg-gray-600"
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
					class="bg-primary hover:bg-primary/90 mt-6 flex w-full cursor-pointer items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
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
								class="text-primary h-4 w-4 rounded border-gray-300 focus:ring-[rgb(34,51,95)]"
							/>
							<span class="text-sm text-gray-600 dark:text-gray-300"
								>{t('importExport.locationData')}</span
							>
						</label>
						<label class="flex items-center gap-2">
							<input
								type="checkbox"
								bind:checked={includeWantToVisitExport}
								class="text-primary h-4 w-4 rounded border-gray-300 focus:ring-[rgb(34,51,95)]"
							/>
							<span class="text-sm text-gray-600 dark:text-gray-300"
								>{t('importExport.wantToVisit')}</span
							>
						</label>
						<label class="flex items-center gap-2">
							<input
								type="checkbox"
								bind:checked={includeTripsExport}
								class="text-primary h-4 w-4 rounded border-gray-300 focus:ring-[rgb(34,51,95)]"
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
							showClear={true}
						/>
					</div>
					{#if !localExportStartDate && !localExportEndDate}
						<p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
							{t('importExport.exportAllDataHint')}
						</p>
					{/if}
				</div>
			</div>

			<button
				onclick={handleExport}
				class="bg-primary hover:bg-primary/90 mt-6 flex w-full cursor-pointer items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white"
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

<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Search,
		Loader2,
		Sparkles,
		History,
		Star,
		StarOff,
		Trash2,
		ChevronRight,
		MapPin,
		Clock,
		AlertCircle,
		ThumbsUp,
		ThumbsDown,
		MessageSquare,
		X,
		Check,
		Edit3,
		Coffee,
		Utensils
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { format } from 'date-fns';

	import { translate } from '$lib/i18n';
	import {
		locationQueryService,
		type QuerySuggestion,
		type QueryHistoryEntry,
		type QueryResult,
		type PlaceVisitResult
	} from '$lib/services/location-query.service';

	let t = $derived($translate);

	// State
	let question = $state('');
	let isLoading = $state(false);
	let result = $state<QueryResult | null>(null);
	let suggestions = $state<QuerySuggestion[]>([]);
	let stats = $state<{
		recent_countries: string[];
		recent_cities: string[];
		top_amenities: string[];
		top_cuisines: string[];
	} | null>(null);
	let history = $state<QueryHistoryEntry[]>([]);
	let showHistory = $state(false);
	let showFeedbackModal = $state(false);
	let feedbackType = $state<'perfect' | 'wrong_results' | 'missing_data' | 'other'>('perfect');
	let feedbackText = $state('');

	// Visit correction state
	let selectedVisit = $state<PlaceVisitResult | null>(null);
	let showCorrectionModal = $state(false);
	let correctedName = $state('');
	let correctedAmenity = $state('');
	let correctedCuisine = $state('');

	// Load suggestions and history on mount
	onMount(async () => {
		try {
			const [suggestionsData, historyData] = await Promise.all([
				locationQueryService.getSuggestions(),
				locationQueryService.getHistory({ limit: 10 })
			]);

			suggestions = suggestionsData.suggestions;
			stats = suggestionsData.stats;
			history = historyData.history;
		} catch (error) {
			console.error('Failed to load initial data:', error);
		}
	});

	// Execute query
	async function executeQuery() {
		if (!question.trim() || isLoading) return;

		isLoading = true;
		result = null;

		try {
			result = await locationQueryService.query(question);

			// Refresh history after query
			const historyData = await locationQueryService.getHistory({ limit: 10 });
			history = historyData.history;
		} catch (error) {
			toast.error((error as Error).message || 'Query failed');
		} finally {
			isLoading = false;
		}
	}

	// Use a suggestion
	function useSuggestion(suggestion: QuerySuggestion) {
		question = suggestion.question;
		executeQuery();
	}

	// Rerun a history query
	function rerunQuery(entry: QueryHistoryEntry) {
		question = entry.question;
		showHistory = false;
		executeQuery();
	}

	// Toggle favorite
	async function toggleFavorite(entry: QueryHistoryEntry) {
		try {
			const newFavorite = await locationQueryService.toggleFavorite(entry.id, !entry.is_favorite);
			entry.is_favorite = newFavorite;
			history = [...history];
		} catch (error) {
			toast.error('Failed to update favorite');
		}
	}

	// Delete history entry
	async function deleteHistoryEntry(entry: QueryHistoryEntry) {
		try {
			await locationQueryService.deleteHistory(entry.id);
			history = history.filter((h) => h.id !== entry.id);
			toast.success('History entry deleted');
		} catch (error) {
			toast.error('Failed to delete history entry');
		}
	}

	// Submit feedback
	async function submitFeedback(wasHelpful: boolean) {
		if (!result?.sql) return;

		try {
			await locationQueryService.submitFeedback({
				question,
				generated_sql: result.sql,
				was_helpful: wasHelpful,
				feedback_type: wasHelpful ? 'perfect' : feedbackType,
				feedback_text: wasHelpful ? undefined : feedbackText
			});

			toast.success('Thanks for your feedback!');
			showFeedbackModal = false;
			feedbackText = '';
		} catch (error) {
			toast.error('Failed to submit feedback');
		}
	}

	// Open visit correction modal
	function openCorrectionModal(visit: PlaceVisitResult) {
		selectedVisit = visit;
		correctedName = visit.poi_name || '';
		correctedAmenity = visit.poi_amenity || '';
		correctedCuisine = visit.poi_cuisine || '';
		showCorrectionModal = true;
	}

	// Confirm visit
	async function confirmVisit(visit: PlaceVisitResult) {
		try {
			await locationQueryService.updateVisit(visit.id, 'confirm');
			toast.success('Visit confirmed');
			// Refresh results
			if (result?.results) {
				const idx = result.results.findIndex((r) => r.id === visit.id);
				if (idx >= 0) {
					result.results[idx].confidence_score = 1.0;
					result = { ...result };
				}
			}
		} catch (error) {
			toast.error('Failed to confirm visit');
		}
	}

	// Reject visit
	async function rejectVisit(visit: PlaceVisitResult) {
		try {
			await locationQueryService.updateVisit(visit.id, 'reject');
			toast.success('Visit removed');
			// Remove from results
			if (result?.results) {
				result.results = result.results.filter((r) => r.id !== visit.id);
				result = { ...result };
			}
		} catch (error) {
			toast.error('Failed to remove visit');
		}
	}

	// Submit visit correction
	async function submitCorrection() {
		if (!selectedVisit) return;

		try {
			await locationQueryService.updateVisit(selectedVisit.id, 'correct', {
				poi_name: correctedName || undefined,
				poi_amenity: correctedAmenity || undefined,
				poi_cuisine: correctedCuisine || undefined
			});

			toast.success('Visit corrected');
			showCorrectionModal = false;

			// Update in results
			if (result?.results) {
				const idx = result.results.findIndex((r) => r.id === selectedVisit!.id);
				if (idx >= 0) {
					result.results[idx].poi_name = correctedName;
					result.results[idx].poi_amenity = correctedAmenity;
					result.results[idx].poi_cuisine = correctedCuisine;
					result.results[idx].confidence_score = 1.0;
					result = { ...result };
				}
			}
		} catch (error) {
			toast.error('Failed to correct visit');
		}
	}

	// Get category icon
	function getCategoryIcon(category: string) {
		switch (category) {
			case 'location':
				return MapPin;
			case 'venue_type':
				return Utensils;
			case 'cuisine':
				return Coffee;
			case 'time':
				return Clock;
			default:
				return Sparkles;
		}
	}

	// Format date for display
	function formatDate(dateStr: string): string {
		try {
			return format(new Date(dateStr), 'MMM d, yyyy h:mm a');
		} catch {
			return dateStr;
		}
	}

	// Get amenity display name
	function getAmenityLabel(amenity: string | null): string {
		if (!amenity) return 'Place';
		return amenity.charAt(0).toUpperCase() + amenity.slice(1);
	}
</script>

<svelte:head>
	<title>Ask About Your Travels | Wayli</title>
</svelte:head>

<div class="mx-auto max-w-4xl px-4 py-8">
	<!-- Header -->
	<div class="mb-8 text-center">
		<div class="mb-4 flex items-center justify-center gap-2">
			<Sparkles class="h-8 w-8 text-purple-500" />
			<h1 class="text-3xl font-bold text-gray-900 dark:text-gray-100">
				Ask About Your Travels
			</h1>
		</div>
		<p class="text-gray-600 dark:text-gray-400">
			Use natural language to explore your travel history and discover insights
		</p>
	</div>

	<!-- Search Input -->
	<div class="mb-6">
		<div class="relative">
			<input
				type="text"
				bind:value={question}
				onkeydown={(e) => e.key === 'Enter' && executeQuery()}
				placeholder="e.g., What restaurants did I visit in Vietnam last year?"
				disabled={isLoading}
				class="w-full rounded-xl border border-gray-300 bg-white py-4 pl-5 pr-14 text-lg shadow-sm transition-all focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:focus:border-purple-400"
			/>
			<button
				onclick={executeQuery}
				disabled={!question.trim() || isLoading}
				class="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg bg-purple-500 p-2.5 text-white transition-colors hover:bg-purple-600 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{#if isLoading}
					<Loader2 class="h-5 w-5 animate-spin" />
				{:else}
					<Search class="h-5 w-5" />
				{/if}
			</button>
		</div>

		<!-- Quick Actions -->
		<div class="mt-3 flex items-center justify-between">
			<button
				onclick={() => (showHistory = !showHistory)}
				class="flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
			>
				<History class="h-4 w-4" />
				Recent queries
			</button>

			{#if stats}
				<div class="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
					{#if stats.recent_countries.length > 0}
						<span>Recent: {stats.recent_countries.slice(0, 3).join(', ')}</span>
					{/if}
				</div>
			{/if}
		</div>
	</div>

	<!-- History Dropdown -->
	{#if showHistory && history.length > 0}
		<div class="mb-6 rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
			<div class="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
				<h3 class="font-medium text-gray-900 dark:text-gray-100">Recent Queries</h3>
			</div>
			<div class="max-h-64 overflow-y-auto">
				{#each history as entry (entry.id)}
					<div
						class="flex items-center justify-between border-b border-gray-100 px-4 py-3 last:border-b-0 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-750"
					>
						<button
							onclick={() => rerunQuery(entry)}
							class="flex-1 text-left text-sm text-gray-700 dark:text-gray-300"
						>
							{entry.question}
						</button>
						<div class="flex items-center gap-2">
							{#if entry.result_count !== null}
								<span class="text-xs text-gray-400">{entry.result_count} results</span>
							{/if}
							<button
								onclick={() => toggleFavorite(entry)}
								class="p-1 text-gray-400 hover:text-yellow-500"
							>
								{#if entry.is_favorite}
									<Star class="h-4 w-4 fill-yellow-500 text-yellow-500" />
								{:else}
									<StarOff class="h-4 w-4" />
								{/if}
							</button>
							<button
								onclick={() => deleteHistoryEntry(entry)}
								class="p-1 text-gray-400 hover:text-red-500"
							>
								<Trash2 class="h-4 w-4" />
							</button>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Suggestions -->
	{#if !result && suggestions.length > 0}
		<div class="mb-8">
			<h3 class="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
				Try asking...
			</h3>
			<div class="grid gap-3 sm:grid-cols-2">
				{#each suggestions as suggestion (suggestion.question)}
					{@const Icon = getCategoryIcon(suggestion.category)}
					<button
						onclick={() => useSuggestion(suggestion)}
						class="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left transition-all hover:border-purple-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-800 dark:hover:border-purple-600"
					>
						<div class="mt-0.5 rounded-lg bg-purple-100 p-2 dark:bg-purple-900/30">
							<Icon class="h-4 w-4 text-purple-600 dark:text-purple-400" />
						</div>
						<div>
							<div class="font-medium text-gray-900 dark:text-gray-100">
								{suggestion.question}
							</div>
							<div class="mt-1 text-sm text-gray-500 dark:text-gray-400">
								{suggestion.description}
							</div>
						</div>
						<ChevronRight class="ml-auto h-5 w-5 flex-shrink-0 text-gray-400" />
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Results -->
	{#if result}
		<div class="space-y-4">
			<!-- Explanation -->
			{#if result.explanation}
				<div class="rounded-xl border border-purple-200 bg-purple-50 p-4 dark:border-purple-800 dark:bg-purple-900/20">
					<div class="flex items-start gap-3">
						<Sparkles class="mt-0.5 h-5 w-5 flex-shrink-0 text-purple-600 dark:text-purple-400" />
						<div>
							<div class="font-medium text-purple-900 dark:text-purple-100">
								{result.explanation}
							</div>
							{#if result.sql}
								<div class="mt-2 text-xs text-purple-700 dark:text-purple-300">
									Found {result.results?.length ?? 0} results
								</div>
							{/if}
						</div>
					</div>
				</div>
			{/if}

			<!-- Error -->
			{#if result.error}
				<div class="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
					<div class="flex items-start gap-3">
						<AlertCircle class="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" />
						<div>
							<div class="font-medium text-red-900 dark:text-red-100">
								{result.error}
							</div>
							{#if result.errorSuggestion}
								<div class="mt-1 text-sm text-red-700 dark:text-red-300">
									{result.errorSuggestion}
								</div>
							{/if}
						</div>
					</div>
				</div>
			{/if}

			<!-- Results List -->
			{#if result.results && result.results.length > 0}
				<div class="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
					<div class="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
						<div class="flex items-center justify-between">
							<h3 class="font-medium text-gray-900 dark:text-gray-100">
								Places Found
							</h3>
							<span class="text-sm text-gray-500">{result.results.length} results</span>
						</div>
					</div>
					<div class="divide-y divide-gray-100 dark:divide-gray-700">
						{#each result.results as visit (visit.id)}
							<div class="p-4">
								<div class="flex items-start justify-between">
									<div class="flex-1">
										<div class="flex items-center gap-2">
											<span class="font-medium text-gray-900 dark:text-gray-100">
												{visit.poi_name || 'Unknown Place'}
											</span>
											{#if visit.confidence_score !== null && visit.confidence_score < 0.8}
												<span
													class="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
												>
													Low confidence
												</span>
											{/if}
										</div>
										<div class="mt-1 flex flex-wrap items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
											{#if visit.poi_amenity}
												<span class="flex items-center gap-1">
													<Utensils class="h-3.5 w-3.5" />
													{getAmenityLabel(visit.poi_amenity)}
												</span>
											{/if}
											{#if visit.poi_cuisine}
												<span class="flex items-center gap-1">
													<Coffee class="h-3.5 w-3.5" />
													{visit.poi_cuisine}
												</span>
											{/if}
											{#if visit.city}
												<span class="flex items-center gap-1">
													<MapPin class="h-3.5 w-3.5" />
													{visit.city}{visit.country ? `, ${visit.country}` : ''}
												</span>
											{/if}
										</div>
										<div class="mt-2 flex items-center gap-4 text-xs text-gray-400">
											<span>{formatDate(visit.started_at)}</span>
											{#if visit.duration_minutes}
												<span>{visit.duration_minutes} min visit</span>
											{/if}
										</div>
									</div>

									<!-- Visit Actions -->
									<div class="ml-4 flex items-center gap-1">
										<button
											onclick={() => confirmVisit(visit)}
											title="Confirm this visit"
											class="rounded-lg p-2 text-gray-400 transition-colors hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/20"
										>
											<Check class="h-4 w-4" />
										</button>
										<button
											onclick={() => openCorrectionModal(visit)}
											title="Correct this visit"
											class="rounded-lg p-2 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/20"
										>
											<Edit3 class="h-4 w-4" />
										</button>
										<button
											onclick={() => rejectVisit(visit)}
											title="This wasn't a real visit"
											class="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
										>
											<X class="h-4 w-4" />
										</button>
									</div>
								</div>
							</div>
						{/each}
					</div>
				</div>

				<!-- Feedback Section -->
				<div class="flex items-center justify-center gap-4 py-4">
					<span class="text-sm text-gray-500 dark:text-gray-400">Were these results helpful?</span>
					<button
						onclick={() => submitFeedback(true)}
						class="flex items-center gap-1.5 rounded-lg bg-green-100 px-3 py-1.5 text-sm font-medium text-green-700 transition-colors hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50"
					>
						<ThumbsUp class="h-4 w-4" />
						Yes
					</button>
					<button
						onclick={() => (showFeedbackModal = true)}
						class="flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
					>
						<ThumbsDown class="h-4 w-4" />
						No
					</button>
				</div>
			{/if}

			<!-- Examples when no SQL generated -->
			{#if result.examples && result.examples.length > 0 && !result.sql}
				<div class="mt-4">
					<h4 class="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
						Try one of these instead:
					</h4>
					<div class="space-y-2">
						{#each result.examples as example (example.question)}
							<button
								onclick={() => {
									question = example.question;
									executeQuery();
								}}
								class="block w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-left text-sm text-gray-700 transition-colors hover:border-purple-300 hover:bg-purple-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-purple-600"
							>
								{example.question}
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- Feedback Modal -->
{#if showFeedbackModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
		<div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-gray-800">
			<div class="mb-4 flex items-center justify-between">
				<h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
					What went wrong?
				</h3>
				<button
					onclick={() => (showFeedbackModal = false)}
					class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<div class="space-y-3">
				{#each [
					{ value: 'wrong_results', label: 'Wrong results returned' },
					{ value: 'missing_data', label: 'Missing data I expected' },
					{ value: 'other', label: 'Something else' }
				] as option (option.value)}
					<label
						class="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 p-3 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-750"
					>
						<input
							type="radio"
							name="feedback_type"
							value={option.value}
							checked={feedbackType === option.value}
							onchange={() => (feedbackType = option.value as typeof feedbackType)}
							class="h-4 w-4 text-purple-600"
						/>
						<span class="text-gray-700 dark:text-gray-300">{option.label}</span>
					</label>
				{/each}
			</div>

			<div class="mt-4">
				<textarea
					bind:value={feedbackText}
					placeholder="Tell us more (optional)..."
					rows="3"
					class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
				></textarea>
			</div>

			<div class="mt-4 flex justify-end gap-3">
				<button
					onclick={() => (showFeedbackModal = false)}
					class="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
				>
					Cancel
				</button>
				<button
					onclick={() => submitFeedback(false)}
					class="rounded-lg bg-purple-500 px-4 py-2 text-sm font-medium text-white hover:bg-purple-600"
				>
					Submit Feedback
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Visit Correction Modal -->
{#if showCorrectionModal && selectedVisit}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
		<div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-gray-800">
			<div class="mb-4 flex items-center justify-between">
				<h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
					Correct Visit Details
				</h3>
				<button
					onclick={() => (showCorrectionModal = false)}
					class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<div class="space-y-4">
				<div>
					<label
						for="poi_name"
						class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
					>
						Place Name
					</label>
					<input
						id="poi_name"
						type="text"
						bind:value={correctedName}
						placeholder="e.g., Pho 24"
						class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
					/>
				</div>

				<div>
					<label
						for="poi_amenity"
						class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
					>
						Type
					</label>
					<select
						id="poi_amenity"
						bind:value={correctedAmenity}
						class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
					>
						<option value="">Select type...</option>
						<option value="restaurant">Restaurant</option>
						<option value="cafe">Cafe</option>
						<option value="bar">Bar</option>
						<option value="fast_food">Fast Food</option>
						<option value="pub">Pub</option>
						<option value="museum">Museum</option>
						<option value="cinema">Cinema</option>
						<option value="theatre">Theatre</option>
						<option value="hotel">Hotel</option>
						<option value="shop">Shop</option>
						<option value="other">Other</option>
					</select>
				</div>

				<div>
					<label
						for="poi_cuisine"
						class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
					>
						Cuisine (if applicable)
					</label>
					<input
						id="poi_cuisine"
						type="text"
						bind:value={correctedCuisine}
						placeholder="e.g., vietnamese, italian, vegan"
						class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
					/>
				</div>
			</div>

			<div class="mt-6 flex justify-end gap-3">
				<button
					onclick={() => (showCorrectionModal = false)}
					class="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
				>
					Cancel
				</button>
				<button
					onclick={submitCorrection}
					class="rounded-lg bg-purple-500 px-4 py-2 text-sm font-medium text-white hover:bg-purple-600"
				>
					Save Changes
				</button>
			</div>
		</div>
	</div>
{/if}

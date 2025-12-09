<script lang="ts">
	import {
		Edit,
		MapPin,
		BarChart2,
		Trash2,
		Map,
		Search,
		ArrowUp,
		ArrowDown,
		List,
		LayoutGrid
	} from 'lucide-svelte';

	export let trips: {
		title: string;
		labels: string[];
		distance: string;
		startDate: string;
		duration: string;
		countries: string[];
		image: string;
		lat: number;
		lng: number;
	}[];
	export let onDelete: (trip: (typeof trips)[0]) => void;
	export let onMouseEnter: ((trip: (typeof trips)[0]) => void) | undefined = undefined;

	let sortField: keyof (typeof trips)[0] = 'startDate';
	let sortDirection: 'asc' | 'desc' = 'desc';
	let searchQuery = '';
	let view = 'list';

	$: filteredTrips = trips.filter((trip) =>
		trip.title.toLowerCase().includes(searchQuery.toLowerCase())
	);

	$: sortedTrips = [...filteredTrips].sort((a, b) => {
		const aValue = a[sortField];
		const bValue = b[sortField];
		const direction = sortDirection === 'asc' ? 1 : -1;

		if (sortField === 'startDate' && typeof aValue === 'string' && typeof bValue === 'string') {
			return direction * (new Date(aValue).getTime() - new Date(bValue).getTime());
		}

		if (typeof aValue === 'string' && typeof bValue === 'string') {
			return direction * aValue.localeCompare(bValue);
		}

		return 0;
	});

	function toggleSort(field: keyof (typeof trips)[0]) {
		if (sortField === field) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		} else {
			sortField = field;
			sortDirection = 'desc';
		}
	}

	function handleRowHover(trip: (typeof trips)[0]) {
		if (onMouseEnter) {
			onMouseEnter(trip);
		}
	}
</script>

<div class="space-y-4">
	<div class="relative">
		<Search class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
		<input
			type="text"
			bind:value={searchQuery}
			placeholder="Search trips..."
			class="w-full rounded-md border border-[rgb(218,218,221)] bg-white py-2 pr-4 pl-10 text-sm placeholder:text-gray-400 focus:border-[rgb(34,51,95)] focus:ring-1 focus:ring-[rgb(34,51,95)] focus:outline-none"
		/>
	</div>

	<div
		class="rounded-lg border border-[rgb(218,218,221)] bg-white dark:border-[#23232a] dark:bg-[#23232a]"
	>
		<table class="w-full">
			<thead>
				<tr
					class="border-b border-[rgb(218,218,221)] bg-white dark:border-[#23232a] dark:bg-[#23232a]"
				>
					<th class="w-8 px-6 py-4">
						<input type="checkbox" class="rounded border-gray-300 dark:border-[#23232a]" />
					</th>
					<th class="px-6 py-4">
						<button
							class="flex cursor-pointer items-center gap-1 text-left text-sm font-medium text-gray-900 hover:text-[rgb(34,51,95)] dark:text-gray-100 dark:hover:text-blue-400"
							onclick={() => toggleSort('title')}
						>
							Trip Name
							{#if sortField === 'title'}
								<span class="text-[rgb(34,51,95)] dark:text-blue-400">
									{#if sortDirection === 'asc'}
										<ArrowUp class="h-4 w-4" />
									{:else}
										<ArrowDown class="h-4 w-4" />
									{/if}
								</span>
							{/if}
						</button>
					</th>
					<th class="px-6 py-4">
						<button
							class="flex cursor-pointer items-center gap-1 text-left text-sm font-medium text-gray-900 hover:text-[rgb(34,51,95)] dark:text-gray-100 dark:hover:text-blue-400"
							onclick={() => toggleSort('labels')}
						>
							Labels
							{#if sortField === 'labels'}
								<span class="text-[rgb(34,51,95)] dark:text-blue-400">
									{#if sortDirection === 'asc'}
										<ArrowUp class="h-4 w-4" />
									{:else}
										<ArrowDown class="h-4 w-4" />
									{/if}
								</span>
							{/if}
						</button>
					</th>
					<th class="px-6 py-4">
						<button
							class="flex cursor-pointer items-center gap-1 text-left text-sm font-medium text-gray-900 hover:text-[rgb(34,51,95)] dark:text-gray-100 dark:hover:text-blue-400"
							onclick={() => toggleSort('distance')}
						>
							Distance
							{#if sortField === 'distance'}
								<span class="text-[rgb(34,51,95)] dark:text-blue-400">
									{#if sortDirection === 'asc'}
										<ArrowUp class="h-4 w-4" />
									{:else}
										<ArrowDown class="h-4 w-4" />
									{/if}
								</span>
							{/if}
						</button>
					</th>
					<th class="px-6 py-4">
						<button
							class="flex cursor-pointer items-center gap-1 text-left text-sm font-medium text-gray-900 hover:text-[rgb(34,51,95)] dark:text-gray-100 dark:hover:text-blue-400"
							onclick={() => toggleSort('startDate')}
						>
							Start Date
							{#if sortField === 'startDate'}
								<span class="text-[rgb(34,51,95)] dark:text-blue-400">
									{#if sortDirection === 'asc'}
										<ArrowUp class="h-4 w-4" />
									{:else}
										<ArrowDown class="h-4 w-4" />
									{/if}
								</span>
							{/if}
						</button>
					</th>
					<th class="px-6 py-4">
						<button
							class="flex cursor-pointer items-center gap-1 text-left text-sm font-medium text-gray-900 hover:text-[rgb(34,51,95)] dark:text-gray-100 dark:hover:text-blue-400"
							onclick={() => toggleSort('duration')}
						>
							Duration
							{#if sortField === 'duration'}
								<span class="text-[rgb(34,51,95)] dark:text-blue-400">
									{#if sortDirection === 'asc'}
										<ArrowUp class="h-4 w-4" />
									{:else}
										<ArrowDown class="h-4 w-4" />
									{/if}
								</span>
							{/if}
						</button>
					</th>
					<th class="px-6 py-4 text-sm font-medium text-gray-900 dark:text-gray-100">Countries</th>
					<th class="px-6 py-4 text-sm font-medium text-gray-900 dark:text-gray-100">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each sortedTrips as trip (trip.title)}
					<tr
						class="border-b border-[rgb(218,218,221)] hover:bg-gray-50 dark:border-[#3f3f46] dark:hover:bg-[#2d2d35]"
						onmouseenter={() => handleRowHover(trip)}
					>
						<td class="w-8 px-6 py-4">
							<input type="checkbox" class="rounded border-gray-300 dark:border-[#23232a]" />
						</td>
						<td class="px-6 py-4 text-sm font-medium text-gray-900 dark:text-gray-100"
							>{trip.title}</td
						>
						<td class="px-6 py-4">
							<div class="flex gap-1">
								{#each trip.labels as label (label)}
									<span
										class="rounded-full px-2 py-0.5 text-xs font-medium
                    {label === 'Adventure'
											? 'bg-red-100 text-red-700'
											: label === 'Nature'
												? 'bg-green-100 text-green-700'
												: label === 'Roadtrip'
													? 'bg-[rgb(34,51,95)]/10 text-[rgb(34,51,95)] dark:bg-blue-500/20 dark:text-blue-400'
													: label === 'Vacation'
														? 'bg-purple-100 text-purple-700'
														: label === 'auto-generated'
															? 'bg-gray-100 text-gray-700'
															: 'bg-gray-100 text-gray-700'}"
									>
										{label}
									</span>
								{/each}
							</div>
						</td>
						<td class="px-6 py-4 text-sm text-gray-500">{trip.distance}</td>
						<td class="px-6 py-4 text-sm text-gray-500">{trip.startDate}</td>
						<td class="px-6 py-4 text-sm text-gray-500">{trip.duration}</td>
						<td class="px-6 py-4">
							<div class="flex gap-1">
								{#each trip.countries as country (country)}
									<img
										src={`https://flagcdn.com/w20/${country.toLowerCase()}.png`}
										alt={country}
										class="h-4 w-6 rounded"
									/>
								{/each}
							</div>
						</td>
						<td class="px-6 py-4">
							<div class="flex justify-end gap-2">
								<button class="cursor-pointer rounded p-1 hover:bg-gray-100" aria-label="Edit">
									<Edit class="h-4 w-4 text-gray-500" />
								</button>
								<button
									class="cursor-pointer rounded p-1 hover:bg-gray-100"
									aria-label="View points of interest"
								>
									<MapPin class="h-4 w-4 text-gray-500" />
								</button>
								<button
									class="cursor-pointer rounded p-1 hover:bg-gray-100"
									aria-label="View statistics"
								>
									<BarChart2 class="h-4 w-4 text-gray-500" />
								</button>
								<button
									class="cursor-pointer rounded p-1 hover:bg-gray-100"
									aria-label="View on map"
								>
									<Map class="h-4 w-4 text-gray-500" />
								</button>
								<button
									class="cursor-pointer rounded p-1 text-red-500 hover:bg-gray-100 hover:text-red-600"
									aria-label="Delete"
									onclick={() => onDelete(trip)}
								>
									<Trash2 class="h-4 w-4" />
								</button>
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<div class="flex items-center gap-2">
		<button
			class="cursor-pointer rounded-md border border-[rgb(218,218,221)] bg-white p-2 text-gray-600 hover:bg-gray-50 dark:border-[#3f3f46] dark:bg-[#23232a] dark:text-gray-300 dark:hover:bg-[#2d2d35]"
			class:bg-[rgb(34,51,95)]={view === 'list'}
			class:text-white={view === 'list'}
			class:border-[rgb(34,51,95)]={view === 'list'}
			onclick={() => (view = 'list')}
		>
			<List class="h-5 w-5" />
		</button>
		<button
			class="cursor-pointer rounded-md border border-[rgb(218,218,221)] bg-white p-2 text-gray-600 hover:bg-gray-50 dark:border-[#3f3f46] dark:bg-[#23232a] dark:text-gray-300 dark:hover:bg-[#2d2d35]"
			class:bg-[rgb(34,51,95)]={view === 'tiles'}
			class:text-white={view === 'tiles'}
			class:border-[rgb(34,51,95)]={view === 'tiles'}
			onclick={() => (view = 'tiles')}
		>
			<LayoutGrid class="h-5 w-5" />
		</button>
	</div>
</div>

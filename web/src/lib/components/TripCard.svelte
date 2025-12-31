<script lang="ts">
	import { MapPin, Edit, BarChart2, Trash2, Map } from 'lucide-svelte';

	interface Props {
		title: string;
		labels: string[];
		distance: string;
		duration: string;
		image: string;
		countries: string[];
		onDelete: () => void;
	}

	let { title, labels, distance, duration, image, countries, onDelete }: Props = $props();
</script>

<div
	class="group relative overflow-hidden rounded-xl border border-gray-200 bg-white transition-all duration-300 hover:-translate-y-1 hover:shadow-lg dark:border-[#23232a] dark:bg-[#23232a]"
>
	<div class="relative aspect-[4/3] overflow-hidden">
		<img
			src={image}
			alt={title}
			class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
		/>
		<div class="absolute inset-0 bg-black/40">
			<div class="absolute top-4 right-4 flex gap-1">
				{#each countries as country (country)}
					<img
						src={`https://flagcdn.com/w20/${country.toLowerCase()}.png`}
						alt={country}
						class="h-4 w-6 rounded"
					/>
				{/each}
			</div>
			<div class="absolute bottom-4 left-4">
				<h3 class="text-lg font-semibold text-white">{title}</h3>
				<div class="mt-2 flex flex-wrap gap-1">
					{#each labels as label (label)}
						<span
							class="rounded-full px-2 py-0.5 text-xs font-medium
							{label === 'Adventure'
								? 'bg-red-100 text-red-700'
								: label === 'Nature'
									? 'bg-emerald-100 text-emerald-700'
									: label === 'Roadtrip'
										? 'bg-green-100 text-green-700'
										: label === 'Vacation'
											? 'bg-primary/10 text-primary dark:bg-primary-dark/20 dark:text-primary-dark'
											: label === 'auto-generated'
												? 'bg-gray-100 text-gray-700'
												: ''}"
						>
							{label}
						</span>
					{/each}
				</div>
			</div>
		</div>
	</div>
	<div class="flex items-center justify-between p-4">
		<div class="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
			<div class="flex items-center gap-1">
				<MapPin class="h-4 w-4" />
				<span>{distance}</span>
			</div>
			<span>{duration}</span>
		</div>
		<div class="flex gap-2">
			<button class="cursor-pointer rounded p-1 hover:bg-gray-100" aria-label="Edit">
				<Edit class="h-4 w-4 text-gray-500" />
			</button>
			<button class="cursor-pointer rounded p-1 hover:bg-gray-100" aria-label="View map">
				<Map class="h-4 w-4 text-gray-500" />
			</button>
			<button class="cursor-pointer rounded p-1 hover:bg-gray-100" aria-label="View statistics">
				<BarChart2 class="h-4 w-4 text-gray-500" />
			</button>
			<button
				class="cursor-pointer rounded p-1 text-red-600 hover:bg-red-50"
				aria-label="Delete"
				onclick={onDelete}
			>
				<Trash2 class="h-4 w-4" />
			</button>
		</div>
	</div>
</div>

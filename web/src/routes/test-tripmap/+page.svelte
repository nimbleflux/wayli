<script lang="ts">
	import TripMap from '$lib/components/TripMap.svelte';
	import ImmichPhotoStrip from '$lib/components/ImmichPhotoStrip.svelte';
	import { onMount } from 'svelte';

	let trips = $state<{ id: number; expanded: boolean; entries: { entry_date: string }[] }[]>([]);
	let consoleErrors: string[] = [];
	let consoleWarnings: string[] = [];
	let mounted = $state(false);

	onMount(() => {
		const origError = console.error;
		console.error = (...args: any[]) => {
			consoleErrors.push(args.map(String).join(' '));
			origError.apply(console, args);
		};
		const origWarn = console.warn;
		console.warn = (...args: any[]) => {
			consoleWarnings.push(args.map(String).join(' '));
			origWarn.apply(console, args);
		};
		mounted = true;
	});

	const samplePoints = Array.from({ length: 50 }, (_, i) => ({
		lat: 52.0 + i * 0.01,
		lng: 4.0 + i * 0.01
	}));
	const sampleSegments = [samplePoints.map((p) => ({ lat: p.lat, lng: p.lng }))];
	const sampleMarkers = [{ lat: 52.0, lng: 4.0, label: 'Start' }];

	// Mount 3 trips with maps + entries (with valid AND invalid dates) to
	// simulate the travel page with ImmichPhotoStrip + TripMap
	$effect(() => {
		if (!mounted) return;
		const timer = setTimeout(() => {
			trips = [
				{
					id: 1,
					expanded: true,
					entries: [
						{ entry_date: '2026-09-05' },
						{ entry_date: '' }, // invalid — should not crash
						{ entry_date: undefined as unknown as string } // invalid — should not crash
					]
				},
				{ id: 2, expanded: true, entries: [{ entry_date: '2026-09-06' }] },
				{ id: 3, expanded: true, entries: [{ entry_date: '2026-09-07' }] }
			];
		}, 100);
		return () => clearTimeout(timer);
	});
</script>

<div class="space-y-4 p-4">
	<h1 class="text-xl font-bold">TripMap + ImmichPhotoStrip crash test</h1>
	<p data-testid="error-count">Console errors: {consoleErrors.length}</p>
	<p data-testid="warn-count">Console warnings: {consoleWarnings.length}</p>
	{#if consoleErrors.length > 0}
		<pre class="bg-red-100 p-2 text-xs" data-testid="error-list">{consoleErrors.join('\n')}</pre>
	{/if}

	{#each trips as t (t.id)}
		<div class="rounded border p-2">
			<h2 class="font-semibold">Trip {t.id}</h2>
			{#if t.expanded}
				<TripMap
					points={samplePoints}
					segments={sampleSegments}
					markers={sampleMarkers}
					class="h-64"
				/>
				{#each t.entries as entry (entry.entry_date)}
					<ImmichPhotoStrip date={entry.entry_date} />
				{/each}
			{/if}
		</div>
	{/each}

	<button
		type="button"
		class="rounded bg-blue-500 px-4 py-2 text-white"
		onclick={() => {
			trips = trips.map((t) => ({ ...t, expanded: !t.expanded }));
		}}
	>
		Toggle all trips
	</button>
</div>

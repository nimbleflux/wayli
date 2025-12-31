<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		columns?: 1 | 2;
		children: Snippet;
	}

	let { columns = 1, children }: Props = $props();
</script>

<div class="grid gap-2" class:grid-cols-1={columns === 1} class:md:grid-cols-2={columns === 2}>
	{@render children()}
</div>

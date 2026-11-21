<script lang="ts">
	// Test harness: binds DateRangePicker the way real parents do and exposes
	// the bound values as text so tests can assert their runtime type/shape.
	import DateRangePicker from '$lib/components/ui/date-range-picker.svelte';

	let { requireCompleteRange = false }: { requireCompleteRange?: boolean } = $props();

	let startDate = $state<string | Date>('');
	let endDate = $state<string | Date>('');

	// Distinguish the failure mode this pins down: the library's own two-way
	// binding normalizes props to epoch-millis numbers, which used to leak
	// into parents and from there into job payloads / DB queries.
	function renderValue(v: string | Date): string {
		if (typeof v === 'number') return `epoch:${v}`;
		if (v instanceof Date) return `date:${v.toISOString()}`;
		return `str:${v}`;
	}
</script>

<DateRangePicker bind:startDate bind:endDate {requireCompleteRange} />
<div data-testid="bound-start">{renderValue(startDate)}</div>
<div data-testid="bound-end">{renderValue(endDate)}</div>

<script lang="ts">
	import { AlertTriangle, Trash2 } from 'lucide-svelte';

	import AccessibleButton from '$lib/components/ui/accessible-button/index.svelte';
	import Modal from '$lib/components/ui/modal/index.svelte';

	export let open = false;
	export let title = 'Confirm Action';
	export let message = 'Are you sure you want to proceed?';
	export let confirmText = 'Confirm';
	export let cancelText = 'Cancel';
	export let variant: 'danger' | 'warning' | 'info' = 'warning';
	export let icon: typeof AlertTriangle | typeof Trash2 = AlertTriangle;
	export let onConfirm: (() => void) | undefined = undefined;
	export let onCancel: (() => void) | undefined = undefined;

	const variantConfig = {
		danger: {
			iconClass: 'text-red-600 dark:text-red-400',
			bgClass: 'bg-red-100 dark:bg-red-900/20',
			buttonClass: 'bg-red-600 hover:bg-red-700 text-white'
		},
		warning: {
			iconClass: 'text-yellow-600 dark:text-yellow-400',
			bgClass: 'bg-yellow-100 dark:bg-yellow-900/20',
			buttonClass: 'bg-yellow-600 hover:bg-yellow-700 text-white'
		},
		info: {
			iconClass: 'text-[rgb(34,51,95)] dark:text-gray-300',
			bgClass: 'bg-[rgb(34,51,95)]/10 dark:bg-[rgb(34,51,95)]/20',
			buttonClass: 'bg-[rgb(34,51,95)] hover:bg-[rgb(34,51,95)]/90 text-white'
		}
	};

	function handleConfirm() {
		if (onConfirm) {
			onConfirm();
		}
	}

	function handleCancel() {
		if (onCancel) {
			onCancel();
		}
	}
</script>

<Modal {open} title="" size="sm" showCloseButton={false} onClose={handleCancel}>
	<div class="space-y-4 text-center">
		<!-- Icon -->
		<div
			class="mx-auto flex h-12 w-12 items-center justify-center rounded-full {variantConfig[variant]
				.bgClass}"
		>
			<svelte:component this={icon} class="h-6 w-6 {variantConfig[variant].iconClass}" />
		</div>

		<!-- Content -->
		<div>
			<h3 class="mb-2 text-lg font-medium text-gray-900 dark:text-gray-100">
				{title}
			</h3>
			<p class="text-sm text-gray-500 dark:text-gray-400">
				{message}
			</p>
		</div>

		<!-- Action Buttons -->
		<div class="flex gap-3 pt-4">
			<AccessibleButton variant="outline" onClick={handleCancel} class="flex-1">
				{cancelText}
			</AccessibleButton>
			<AccessibleButton onClick={handleConfirm} class="flex-1 {variantConfig[variant].buttonClass}">
				{confirmText}
			</AccessibleButton>
		</div>
	</div>
</Modal>

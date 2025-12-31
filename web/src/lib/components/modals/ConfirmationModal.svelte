<script lang="ts">
	import type { Component } from 'svelte';
	import { AlertTriangle, Trash2 } from 'lucide-svelte';

	import AccessibleButton from '$lib/components/ui/accessible-button/index.svelte';
	import Modal from '$lib/components/ui/modal/index.svelte';

	interface Props {
		open?: boolean;
		title?: string;
		message?: string;
		confirmText?: string;
		cancelText?: string;
		variant?: 'danger' | 'warning' | 'info';
		icon?: Component;
		onConfirm?: () => void;
		onCancel?: () => void;
	}

	let {
		open = false,
		title = 'Confirm Action',
		message = 'Are you sure you want to proceed?',
		confirmText = 'Confirm',
		cancelText = 'Cancel',
		variant = 'warning',
		icon = AlertTriangle,
		onConfirm,
		onCancel
	}: Props = $props();

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
			iconClass: 'text-primary dark:text-gray-300',
			bgClass: 'bg-primary/10 dark:bg-primary/20',
			buttonClass: 'bg-primary hover:bg-primary/90 text-white'
		}
	};

	function handleConfirm() {
		onConfirm?.();
	}

	function handleCancel() {
		onCancel?.();
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

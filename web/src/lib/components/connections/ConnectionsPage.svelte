<!-- 🖥️ CLIENT-SIDE COMPONENT: Connections Page -->
<!-- This component demonstrates proper client-side architecture -->

<script lang="ts">
	import { Link, Database, RefreshCw, Copy, Check } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';

	import { translate } from '$lib/i18n';
	import { config } from '$lib/config';

	import { fluxbase } from '$lib/fluxbase';

	// Simple client logger
	function logClient(message: string, level: 'info' | 'error') {
		if (level === 'error') {
			console.error(`[Connections] ${message}`);
		} else {
			console.log(`[Connections] ${message}`);
		}
	}

	// Use the reactive translation function
	let t = $derived($translate);

	let copiedField = $state('');

	let owntracksApiKey = $state<string | null>(null);
	let owntracksEndpoint = $state<string | null>(null);

	async function refreshApiKeyData() {
		const { data, error } = await fluxbase.auth.getUser();

		if (data?.user && !error) {
			const user = data.user;

			// Get the API key from user_preferences table
			const { data: preferences, error: prefsError } = await fluxbase
				.from('user_preferences')
				.select('owntracks_api_key')
				.eq('id', user.id)
				.single();

			if (prefsError) {
				logClient('Error fetching user preferences', 'error');
				owntracksApiKey = null;
				owntracksEndpoint = null;
				return;
			}

			owntracksApiKey = preferences?.owntracks_api_key || null;

			// Construct the endpoint URL for OwnTracks integration
			if (owntracksApiKey) {
				const baseUrl = config.fluxbaseUrl;
				const url = new URL(`${baseUrl}/api/v1/functions/owntracks-points/invoke/`);
				url.searchParams.append('api_key', owntracksApiKey);
				url.searchParams.append('user_id', user.id);
				owntracksEndpoint = url.toString();
			} else {
				owntracksEndpoint = null;
			}
		}
	}

	async function generateApiKey() {
		try {
			const { data } = await fluxbase.auth.getUser();
			if (!data?.user) {
				toast.error(t('connections.userNotAuthenticated'));
				return;
			}

			// Generate a secure random API key (32 bytes = 64 hex characters)
			const array = new Uint8Array(32);
			crypto.getRandomValues(array);
			const newApiKey = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');

			logClient(`Generating new API key for user: ${data.user.id}`, 'info');

			// Store the API key in user_preferences table
			const { error } = await fluxbase
				.from('user_preferences')
				.update({
					owntracks_api_key: newApiKey,
					updated_at: new Date().toISOString()
				})
				.eq('id', data.user.id);

			if (error) {
				logClient('Error storing API key in user preferences', 'error');
				console.error('❌ Error details:', error);
				toast.error(t('connections.failedToGenerateApiKey'));
				return;
			}

			logClient('API key stored successfully in user_preferences', 'info');

			// Immediately update the UI with the new API key
			owntracksApiKey = newApiKey;

			// Construct the endpoint URL with the new API key
			const baseUrl = config.fluxbaseUrl;
			const url = new URL(`${baseUrl}/api/v1/functions/owntracks-points/invoke/`);
			url.searchParams.append('api_key', newApiKey);
			url.searchParams.append('user_id', data.user.id);
			owntracksEndpoint = url.toString();

			logClient('API key generated successfully', 'info');
			toast.success(t('connections.apiKeyGeneratedSuccess'));
		} catch (error) {
			logClient('Error generating API key', 'error');
			toast.error(t('connections.failedToGenerateApiKey'));
		}
	}

	function copyToClipboard(text: string, fieldName: string) {
		navigator.clipboard
			.writeText(text)
			.then(() => {
				copiedField = fieldName;
				toast.success(t('connections.apiKeyCopied', { field: fieldName }));
				setTimeout(() => {
					copiedField = '';
				}, 2000);
			})
			.catch(() => {
				toast.error(t('connections.failedToCopy'));
			});
	}

	onMount(async () => {
		logClient('Connections page mounted', 'info');
		await refreshApiKeyData();
	});
</script>

<div>
	<!-- Header -->
	<div class="mb-8">
		<div class="flex items-center gap-3">
			<Link class="h-8 w-8 text-primary dark:text-gray-400" />
			<h1 class="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
				{t('connections.title')}
			</h1>
		</div>
	</div>

	<!-- Connections -->
	<div class="space-y-6">
		<!-- OwnTracks Integration -->
		<div
			class="rounded-xl border border-[rgb(218,218,221)] bg-white p-6 dark:border-[#23232a] dark:bg-[#23232a]"
		>
			<div class="mb-6">
				<div class="flex items-center gap-2">
					<Database class="h-5 w-5 text-gray-400" />
					<h2 class="text-xl font-semibold text-gray-900 dark:text-gray-100">
						{t('connections.owntracksIntegration')}
					</h2>
				</div>
				<p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
					{t('connections.owntracksDescription')}
				</p>
			</div>

			<div class="space-y-4">
				<!-- API Endpoint -->
				<div>
					<label
						class="mb-1.5 block text-sm font-medium text-gray-900 dark:text-gray-100"
						for="owntracksEndpoint">{t('connections.apiEndpoint')}</label
					>
					<div class="flex gap-2">
						<input
							type="text"
							value={owntracksEndpoint || t('connections.generateApiKeyFirst')}
							readonly
							id="owntracksEndpoint"
							class="flex-1 rounded-md border border-[rgb(218,218,221)] bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-[rgb(34,51,95)] focus:ring-1 focus:ring-[rgb(34,51,95)] focus:outline-none dark:border-[#3f3f46] dark:bg-[#1a1a1a] dark:text-gray-100"
						/>
						{#if owntracksEndpoint}
							<button
								type="button"
								onclick={() =>
									owntracksEndpoint &&
									copyToClipboard(owntracksEndpoint, t('connections.apiEndpoint'))}
								class="flex items-center gap-2 rounded-md border border-[rgb(218,218,221)] px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:border-[#3f3f46] dark:text-gray-300 dark:hover:bg-[#1a1a1a]"
							>
								{#if copiedField === t('connections.apiEndpoint')}
									<Check class="h-4 w-4" />
								{:else}
									<Copy class="h-4 w-4" />
								{/if}
							</button>
						{/if}
					</div>
				</div>

				<!-- API Key -->
				<div>
					<label
						class="mb-1.5 block text-sm font-medium text-gray-900 dark:text-gray-100"
						for="owntracksApiKey">{t('connections.apiKey')}</label
					>
					<div class="flex gap-2">
						<input
							type="text"
							value={owntracksApiKey || t('connections.noApiKeyGenerated')}
							readonly
							id="owntracksApiKey"
							class="flex-1 rounded-md border border-[rgb(218,218,221)] bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:border-[rgb(34,51,95)] focus:ring-1 focus:ring-[rgb(34,51,95)] focus:outline-none dark:border-[#3f3f46] dark:bg-[#1a1a1a] dark:text-gray-100"
						/>
						{#if owntracksApiKey}
							<button
								type="button"
								onclick={() =>
									owntracksApiKey && copyToClipboard(owntracksApiKey, t('connections.apiKey'))}
								class="flex items-center gap-2 rounded-md border border-[rgb(218,218,221)] px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:border-[#3f3f46] dark:text-gray-300 dark:hover:bg-[#1a1a1a]"
							>
								{#if copiedField === t('connections.apiKey')}
									<Check class="h-4 w-4" />
								{:else}
									<Copy class="h-4 w-4" />
								{/if}
							</button>
						{/if}
					</div>
				</div>

				<!-- Generate API Key Button -->
				<button
					type="button"
					onclick={generateApiKey}
					class="flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90"
				>
					<RefreshCw class="h-4 w-4" />
					{owntracksApiKey ? t('connections.generateNewApiKey') : t('connections.generateApiKey')}
				</button>

				<!-- Instructions -->
				<div
					class="mt-4 rounded-lg border border-[rgb(34,51,95)]/30 bg-primary/5 p-4 dark:border-[rgb(34,51,95)] dark:bg-primary/20"
				>
					<h3 class="mb-2 text-sm font-medium text-primary dark:text-gray-300">
						{t('connections.setupInstructions')}
					</h3>
					<ol class="list-inside list-decimal space-y-1 text-sm text-primary dark:text-gray-400">
						<li>{t('connections.instruction1')}</li>
						<li>{t('connections.instruction2')}</li>
						<li>{t('connections.instruction3')}</li>
					</ol>
				</div>
			</div>
		</div>
	</div>
</div>

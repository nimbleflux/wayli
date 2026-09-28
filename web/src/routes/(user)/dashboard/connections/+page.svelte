<script lang="ts">
	import { fluxbase } from '$lib/fluxbase';
	import { config } from '$lib/config';
	import { toast } from 'svelte-sonner';
	import { translate } from '$lib/i18n';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { Database, Link, Copy, Check, RefreshCw, AlertTriangle, X, Loader2 } from 'lucide-svelte';
	import Switch from '$lib/components/ui/Switch.svelte';

	// Use the reactive translation function
	let t = $derived($translate);

	// Removed unused data prop since this page is now fully client-side

	let copiedField = $state('');

	// ── Immich integration ──────────────────────────────────────────────
	import {
		loadImmichSettings,
		saveImmichSettings,
		immichSettings
	} from '$lib/stores/immich.svelte';
	import { IMMICH_API_KEY, IMMICH_REQUIRED_PERMISSIONS } from '$lib/types/immich.types';
	import { getSetting, loadPublicSettings } from '$lib/stores/settings.svelte';
	import { Camera, Unplug } from 'lucide-svelte';

	type ImmichKeyStatus = 'loading' | 'configured' | 'missing' | 'error';
	let immichKeyStatus = $state<ImmichKeyStatus>('loading');
	let immichServerUrl = $state('');
	let immichEnabled = $state(false);
	let immichAvailable = $state(false);
	let immichTesting = $state(false);
	let immichTestResult = $state<{ ok: boolean; message: string } | null>(null);
	let immichSyncing = $state(false);
	let immichDisconnecting = $state(false);
	let immichKeyInput = $state('');

	async function refreshImmichData() {
		await loadPublicSettings();
		immichAvailable = getSetting<boolean>('wayli.immich_enabled', false) === true;
		if (!immichAvailable) return;

		try {
			const result = await fluxbase.settings.listSecrets();
			const allSecrets = ((result as any)?.data ?? result) as any[] | null;
			const meta = Array.isArray(allSecrets)
				? allSecrets.find((sec: any) => sec.key === IMMICH_API_KEY)
				: undefined;
			immichKeyStatus = meta ? 'configured' : 'missing';
		} catch {
			immichKeyStatus = 'error';
		}

		const settings = await loadImmichSettings();
		immichServerUrl = settings?.server_url
			? String(settings.server_url)
			: String(getSetting('wayli.immich_endpoint', ''));
		immichEnabled = settings?.enabled === true;
	}

	async function saveImmichConnection() {
		try {
			await fluxbase.settings.setSecret(IMMICH_API_KEY, immichKeyInput.trim(), {
				description: 'Immich API key for the photo integration'
			});
			await saveImmichSettings({
				server_url: immichServerUrl.trim() || undefined,
				enabled: immichEnabled
			});
			toast.success(t('connections.immich.saved'));
			await refreshImmichData();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t('connections.immich.saveFailed'));
		}
	}

	async function testImmichConnection() {
		immichTesting = true;
		immichTestResult = null;
		try {
			const { data, error } = await fluxbase.functions.invoke('immich-test', {
				body: { serverUrl: immichServerUrl.trim() || undefined }
			});
			const result = (data ?? error) as any;
			if (result?.ok) {
				immichTestResult = {
					ok: true,
					message: t('connections.immich.testOk', {
						values: { user: String(result.user ?? '') }
					})
				};
			} else {
				immichTestResult = {
					ok: false,
					message:
						result?.errorKind === 'permission'
							? t('connections.immich.testPermission')
							: result?.errorKind === 'auth'
								? t('connections.immich.testAuth')
								: t('connections.immich.testFailed')
				};
			}
		} catch {
			immichTestResult = { ok: false, message: t('connections.immich.testFailed') };
		} finally {
			immichTesting = false;
		}
	}

	async function syncImmich() {
		immichSyncing = true;
		try {
			await fluxbase.jobs.submit('immich_sync', {}, { namespace: 'wayli' });
			toast.success(t('connections.immich.syncStarted'));
		} catch {
			toast.error(t('connections.immich.syncFailed'));
		} finally {
			immichSyncing = false;
		}
	}

	async function disconnectImmich() {
		if (!confirm(t('connections.immich.disconnectConfirm'))) return;
		immichDisconnecting = true;
		try {
			await fluxbase.functions.invoke('immich-sync', { body: { wipe: true } });
			await fluxbase.settings.deleteSecret(IMMICH_API_KEY);
			immichKeyInput = '';
			await refreshImmichData();
			toast.success(t('connections.immich.disconnected'));
		} catch {
			toast.error(t('connections.immich.disconnectFailed'));
		} finally {
			immichDisconnecting = false;
		}
	}

	// OwnTracks API key status. We distinguish a fetch failure from "no key set"
	// so a transient error (network blip, auth race, or a wrapped API response)
	// never renders as "No API key generated" when a key actually exists.
	type KeyStatus = 'loading' | 'configured' | 'missing' | 'error';
	let keyStatus = $state<KeyStatus>('loading');
	let owntracksEndpoint = $state<string | null>(null);
	let userId = $state<string | null>(null);

	// Modal state for showing newly generated key
	let showApiKeyModal = $state(false);
	let newlyGeneratedApiKey = $state<string | null>(null);
	let newlyGeneratedEndpoint = $state<string | null>(null);

	// True only when we have positively confirmed a key exists.
	let owntracksApiKeyConfigured = $derived(keyStatus === 'configured');

	async function refreshApiKeyData() {
		keyStatus = 'loading';

		// Resolve the user id for endpoint construction, but do NOT gate the
		// secret lookup on it — a transient auth.getUser() failure should not
		// cause a false "no key" reading.
		try {
			const { data, error } = await fluxbase.auth.getUser();
			if (data?.user && !error) {
				userId = data.user.id;
			}
		} catch {
			// Non-fatal: the secret lookup below is independent.
		}

		// Check if OwnTracks API key secret is configured (batch list, no 404).
		try {
			const result = await fluxbase.settings.listSecrets();
			// The SDK declares SecretSettingMetadata[], but some Fluxbase responses
			// arrive wrapped as { data: [...] }. Unwrap defensively before searching.
			const allSecrets = ((result as any)?.data ?? result) as any[] | null;
			const owntracksMeta = Array.isArray(allSecrets)
				? allSecrets.find((s: any) => s.key === 'owntracks_api_key')
				: undefined;
			keyStatus = owntracksMeta ? 'configured' : 'missing';
			// We can't show the actual endpoint URL since we don't have the key value.
			// The user will see the endpoint only when generating a new key.
			owntracksEndpoint = null;
		} catch (error) {
			console.error('[Connections] Failed to load API key status:', error);
			keyStatus = 'error';
			owntracksEndpoint = null;
		}
	}

	async function generateApiKey() {
		try {
			const { data } = await fluxbase.auth.getUser();
			if (!data?.user) {
				toast.error(t('connections.userNotAuthenticated'));
				return;
			}

			// Generate a secure random API key (16 bytes = 32 hex characters)
			const array = new Uint8Array(16);
			crypto.getRandomValues(array);
			const newApiKey = Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');

			console.log('🔑 Generating new API key for user:', data.user.id);

			// Store the API key as an encrypted user secret
			await fluxbase.settings.setSecret('owntracks_api_key', newApiKey, {
				description: 'OwnTracks integration API key'
			});

			console.log('✅ API key stored successfully as encrypted secret');

			// Construct the endpoint URL with the new API key
			const baseUrl = config.fluxbaseUrl;
			const url = new URL(`${baseUrl}/api/v1/functions/owntracks-points/invoke`);
			url.searchParams.append('namespace', 'wayli');
			url.searchParams.append('api_key', newApiKey);
			url.searchParams.append('user_id', data.user.id);

			// Store for modal display
			newlyGeneratedApiKey = newApiKey;
			newlyGeneratedEndpoint = url.toString();
			keyStatus = 'configured';

			// Show the modal with the new key
			showApiKeyModal = true;
		} catch (error) {
			console.error('❌ Error generating API key:', error);
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

	function closeApiKeyModal() {
		showApiKeyModal = false;
		// Clear the newly generated key from memory for security
		newlyGeneratedApiKey = null;
		newlyGeneratedEndpoint = null;
		toast.success(t('connections.apiKeyGeneratedSuccess'));
	}

	onMount(async () => {
		void refreshImmichData();
		await refreshApiKeyData();
	});
</script>

<svelte:head>
	<title>{t('connections.title')} · Wayli</title>
</svelte:head>

<div>
	<!-- Header -->
	<div class="mb-8 flex items-center gap-3">
		<Link class="text-primary h-6 w-6" />
		<div>
			<h1 class="text-foreground text-xl font-bold">{t('connections.title')}</h1>
			<p class="text-muted-foreground text-sm">Connect external devices and services</p>
		</div>
	</div>

	<!-- Connections -->
	<div class="space-y-6">
		<!-- OwnTracks Integration -->
		<div class="border-border dark:border-border dark:bg-card rounded-xl border bg-white p-6">
			<div class="mb-6">
				<div class="flex items-center gap-2">
					<Database class="text-muted-foreground h-5 w-5" />
					<h2 class="text-foreground text-xl font-semibold">
						{t('connections.owntracksIntegration')}
					</h2>
				</div>
				<p class="text-muted-foreground mt-1 text-sm">
					{t('connections.owntracksDescription')}
				</p>
			</div>

			<div class="space-y-4">
				<!-- API Key Status -->
				<div>
					<label class="text-foreground mb-1.5 block text-sm font-medium" for="owntracksApiKey"
						>{t('connections.apiKey')}</label
					>
					{#if keyStatus === 'loading'}
						<div
							class="border-border bg-muted/40 dark:border-border dark:bg-muted/20 flex items-center gap-2 rounded-md border px-3 py-2"
						>
							<Loader2 class="text-muted-foreground h-4 w-4 animate-spin" />
							<span class="text-muted-foreground text-sm font-medium">
								{t('connections.checkingApiKey')}
							</span>
						</div>
					{:else if keyStatus === 'configured'}
						<div
							class="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 dark:border-green-800 dark:bg-green-900/20"
						>
							<Check class="h-4 w-4 text-green-600 dark:text-green-400" />
							<span class="text-sm font-medium text-green-700 dark:text-green-300">
								{t('connections.apiKeyConfigured')}
							</span>
						</div>
						<p class="text-muted-foreground mt-1.5 text-xs">
							{t('connections.apiKeyConfiguredDescription')}
						</p>
					{:else if keyStatus === 'error'}
						<div
							class="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-900/20"
						>
							<AlertTriangle class="h-4 w-4 text-red-600 dark:text-red-400" />
							<span class="text-sm font-medium text-red-700 dark:text-red-300">
								{t('connections.apiKeyCheckFailed')}
							</span>
						</div>
						<button
							type="button"
							onclick={refreshApiKeyData}
							class="text-primary mt-1.5 cursor-pointer text-xs font-medium underline underline-offset-2"
						>
							{t('connections.retry')}
						</button>
					{:else}
						<!-- keyStatus === 'missing' -->
						<div
							class="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-900/20"
						>
							<AlertTriangle class="h-4 w-4 text-amber-600 dark:text-amber-400" />
							<span class="text-sm font-medium text-amber-700 dark:text-amber-300">
								{t('connections.noApiKeyGenerated')}
							</span>
						</div>
					{/if}
				</div>

				<!-- Generate API Key Button -->
				<button
					type="button"
					onclick={generateApiKey}
					class="bg-primary hover:bg-primary/90 dark:bg-primary dark:hover:bg-primary/90 flex cursor-pointer items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors"
				>
					<RefreshCw class="h-4 w-4" />
					{owntracksApiKeyConfigured
						? t('connections.regenerateApiKey')
						: t('connections.generateApiKey')}
				</button>

				{#if owntracksApiKeyConfigured}
					<p class="text-muted-foreground text-xs">
						{t('connections.regenerateWarning')}
					</p>
				{/if}

				<!-- Instructions -->
				<div
					class="border-primary/30 bg-primary/5 dark:border-primary/30 dark:bg-primary/20 mt-4 rounded-lg border p-4"
				>
					<h3 class="text-primary dark:text-primary mb-2 text-sm font-medium">
						{t('connections.setupInstructions')}
					</h3>
					<ol class="text-primary dark:text-primary/80 list-inside list-decimal space-y-1 text-sm">
						<li>{t('connections.instruction1')}</li>
						<li>{t('connections.instruction2')}</li>
						<li>{t('connections.instruction3')}</li>
					</ol>
				</div>
			</div>
		</div>

		<!-- Immich Photo Integration -->
		{#if immichAvailable}
			<div class="border-border dark:border-border dark:bg-card rounded-xl border bg-white p-6">
				<div class="mb-6">
					<div class="flex items-center gap-2">
						<Camera class="text-muted-foreground h-5 w-5" />
						<h2 class="text-foreground text-xl font-semibold">
							{t('connections.immich.title')}
						</h2>
					</div>
					<p class="text-muted-foreground mt-1 text-sm">
						{t('connections.immich.description')}
					</p>
				</div>

				<div class="space-y-4">
					<!-- Required permissions explainer -->
					<div
						class="border-primary/30 bg-primary/5 dark:border-primary/30 dark:bg-primary/20 rounded-lg border p-4"
					>
						<h3 class="text-primary dark:text-primary mb-2 text-sm font-medium">
							{t('connections.immich.requiredPermissions')}
						</h3>
						<ul class="text-primary dark:text-primary/80 space-y-1 text-sm">
							{#each IMMICH_REQUIRED_PERMISSIONS as perm (perm.scope)}
								<li>
									<code class="font-mono font-semibold">{perm.scope}</code>
									— {perm.why}
								</li>
							{/each}
						</ul>
						<p class="text-primary dark:text-primary/80 mt-2 text-xs">
							{t('connections.immich.permissionsHowTo')}
						</p>
						<p class="text-primary/60 dark:text-primary/60 mt-1 text-xs">
							{t('connections.immich.permissionsDownloadNote')}
						</p>
					</div>

					<!-- Server URL -->
					<div>
						<label class="text-foreground mb-1.5 block text-sm font-medium" for="immichServerUrl"
							>{t('connections.immich.serverUrl')}</label
						>
						<input
							id="immichServerUrl"
							type="url"
							bind:value={immichServerUrl}
							placeholder={String(getSetting('wayli.immich_endpoint', 'http://immich.local:2283'))}
							class="border-border dark:bg-muted/20 focus:ring-primary/50 focus:border-primary w-full rounded-md border px-3 py-2 text-sm"
						/>
						<p class="text-muted-foreground mt-1 text-xs">
							{t('connections.immich.serverUrlHint')}
						</p>
					</div>

					<!-- API key -->
					<div>
						<label class="text-foreground mb-1.5 block text-sm font-medium" for="immichApiKey"
							>{t('connections.immich.apiKey')}</label
						>
						{#if immichKeyStatus === 'loading'}
							<p class="text-muted-foreground text-sm">{t('connections.checkingApiKey')}</p>
						{:else if immichKeyStatus === 'configured'}
							<p
								class="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300"
							>
								<Check class="h-4 w-4" />
								{t('connections.immich.apiKeyConfigured')}
							</p>
						{:else if immichKeyStatus === 'error'}
							<p class="text-sm font-medium text-red-600">{t('connections.apiKeyCheckFailed')}</p>
						{:else}
							<p
								class="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300"
							>
								<AlertTriangle class="h-4 w-4" />
								{t('connections.immich.apiKeyMissing')}
							</p>
						{/if}
						<input
							id="immichApiKey"
							type="password"
							bind:value={immichKeyInput}
							placeholder={immichKeyStatus === 'configured'
								? t('connections.immich.apiKeyReplacePlaceholder')
								: t('connections.immich.apiKeyPlaceholder')}
							class="border-border dark:bg-muted/20 focus:ring-primary/50 focus:border-primary mt-2 w-full rounded-md border px-3 py-2 text-sm"
						/>
					</div>

					<!-- Enable toggle -->
					<div class="flex items-center justify-between">
						<span class="text-foreground text-sm font-medium">
							{t('connections.immich.enable')}
						</span>
						<Switch bind:checked={immichEnabled} />
					</div>

					<!-- Actions -->
					<div class="flex flex-wrap items-center gap-2">
						<button
							type="button"
							onclick={saveImmichConnection}
							disabled={immichKeyInput.trim().length === 0}
							class="bg-primary hover:bg-primary/90 disabled:opacity-50 flex cursor-pointer items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed"
						>
							{t('connections.immich.save')}
						</button>
						<button
							type="button"
							onclick={testImmichConnection}
							disabled={immichTesting}
							class="border-border hover:bg-muted flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium"
						>
							<RefreshCw class="h-4 w-4" class={immichTesting ? 'animate-spin' : ''} />
							{t('connections.immich.test')}
						</button>
						<button
							type="button"
							onclick={syncImmich}
							disabled={immichSyncing || immichKeyStatus !== 'configured'}
							class="border-border hover:bg-muted disabled:opacity-50 flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed"
						>
							<Camera class="h-4 w-4" />
							{t('connections.immich.syncNow')}
						</button>
						<button
							type="button"
							onclick={disconnectImmich}
							disabled={immichDisconnecting}
							class="ml-auto flex cursor-pointer items-center gap-2 rounded-md border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
						>
							<Unplug class="h-4 w-4" />
							{t('connections.immich.disconnect')}
						</button>
					</div>

					{#if immichTestResult}
						<p
							class={`rounded-md border px-3 py-2 text-sm ${immichTestResult.ok ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300' : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'}`}
						>
							{immichTestResult.message}
						</p>
					{/if}

					{#if immichSettings()?.last_sync_at}
						<p class="text-muted-foreground text-xs">
							{t('connections.immich.lastSync', {
								values: {
									time: new Date(immichSettings()!.last_sync_at!).toLocaleString()
								}
							})}
						</p>
					{/if}

					<p class="text-muted-foreground text-xs">{t('connections.immich.displayOnlyNote')}</p>
				</div>
			</div>
		{/if}
	</div>
</div>

<!-- API Key Modal - Show once when generated -->
{#if showApiKeyModal && newlyGeneratedApiKey && newlyGeneratedEndpoint}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		onclick={(e) => e.target === e.currentTarget && closeApiKeyModal()}
		onkeydown={(e) => e.key === 'Escape' && closeApiKeyModal()}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div class="dark:bg-card w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
			<div class="mb-4 flex items-start justify-between">
				<div class="flex items-center gap-2">
					<AlertTriangle class="h-5 w-5 text-amber-500" />
					<h2 class="text-foreground text-lg font-semibold">
						{t('connections.saveYourApiKey')}
					</h2>
				</div>
				<button
					type="button"
					onclick={closeApiKeyModal}
					class="text-muted-foreground hover:bg-muted hover:text-muted-foreground rounded-md p-1"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<div
				class="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20"
			>
				<p class="text-sm text-amber-800 dark:text-amber-200">
					{t('connections.apiKeyWarning')}
				</p>
			</div>

			<div class="space-y-4">
				<!-- API Endpoint -->
				<div>
					<label for="api-endpoint" class="text-foreground mb-1.5 block text-sm font-medium">
						{t('connections.apiEndpoint')}
					</label>
					<div class="flex gap-2">
						<input
							id="api-endpoint"
							type="text"
							value={newlyGeneratedEndpoint}
							readonly
							class="border-border dark:border-border dark:bg-card dark:text-foreground flex-1 rounded-md border bg-gray-50 px-3 py-2 text-xs text-gray-900"
						/>
						<button
							type="button"
							onclick={() =>
								newlyGeneratedEndpoint &&
								copyToClipboard(newlyGeneratedEndpoint, t('connections.apiEndpoint'))}
							class="border-border hover:bg-muted dark:border-border dark:text-muted-foreground dark:hover:bg-card flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-gray-700 transition-colors"
						>
							{#if copiedField === t('connections.apiEndpoint')}
								<Check class="h-4 w-4" />
							{:else}
								<Copy class="h-4 w-4" />
							{/if}
						</button>
					</div>
				</div>

				<!-- API Key -->
				<div>
					<label for="api-key" class="text-foreground mb-1.5 block text-sm font-medium">
						{t('connections.apiKey')}
					</label>
					<div class="flex gap-2">
						<input
							id="api-key"
							type="text"
							value={newlyGeneratedApiKey}
							readonly
							class="border-border dark:border-border dark:bg-card dark:text-foreground flex-1 rounded-md border bg-gray-50 px-3 py-2 font-mono text-sm text-gray-900"
						/>
						<button
							type="button"
							onclick={() =>
								newlyGeneratedApiKey &&
								copyToClipboard(newlyGeneratedApiKey, t('connections.apiKey'))}
							class="border-border hover:bg-muted dark:border-border dark:text-muted-foreground dark:hover:bg-card flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-gray-700 transition-colors"
						>
							{#if copiedField === t('connections.apiKey')}
								<Check class="h-4 w-4" />
							{:else}
								<Copy class="h-4 w-4" />
							{/if}
						</button>
					</div>
				</div>
			</div>

			<div class="mt-6 flex justify-end">
				<button
					type="button"
					onclick={closeApiKeyModal}
					class="bg-primary hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors"
				>
					{t('connections.iHaveSavedMyKey')}
				</button>
			</div>
		</div>
	</div>
{/if}

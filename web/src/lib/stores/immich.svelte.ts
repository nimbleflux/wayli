import { fluxbase } from '$lib/fluxbase';
import type { ImmichSettings } from '$lib/types/immich.types';

// Reactive snapshot of the user's Immich connection settings. `null` until the
// first load completes; reflects the last loaded state after saves.
let settingsState = $state<ImmichSettings | null>(null);

/**
 * Read the user's Immich settings from `preferences.immich`.
 * Returns null when the user has no preferences row.
 */
export async function loadImmichSettings(): Promise<ImmichSettings | null> {
	const { data } = await fluxbase.auth.getUser();
	const user = data?.user;
	if (!user) return null;

	const { data: prefs } = await fluxbase
		.from<Record<string, any>>('user_preferences')
		.select('preferences')
		.eq('id', user.id)
		.maybeSingle();

	const raw = (prefs?.preferences as any)?.immich ?? null;
	settingsState = raw
		? {
				enabled: raw.enabled === true,
				server_url: typeof raw.server_url === 'string' ? raw.server_url : undefined,
				last_sync_at: typeof raw.last_sync_at === 'string' ? raw.last_sync_at : undefined
			}
		: null;
	return settingsState;
}

/** Last loaded settings (reactive). */
export function immichSettings(): ImmichSettings | null {
	return settingsState;
}

/**
 * Persist a partial Immich settings patch into `preferences.immich`.
 * Read-modify-write of the jsonb so sibling preference keys survive; creates
 * the preferences row when the user has none yet (an UPDATE alone would
 * silently affect 0 rows and lose the toggle).
 */
export async function saveImmichSettings(patch: Partial<ImmichSettings>): Promise<void> {
	const { data } = await fluxbase.auth.getUser();
	const userId = data?.user?.id;
	if (!userId) {
		throw new Error('User not authenticated');
	}

	const { data: prefs } = await fluxbase
		.from<Record<string, any>>('user_preferences')
		.select('preferences')
		.eq('id', userId)
		.maybeSingle();

	const current = (prefs?.preferences ?? {}) as Record<string, any>;
	const mergedImmich = { ...current.immich, ...patch };
	const preferences = { ...current, immich: mergedImmich };

	if (prefs) {
		const { error } = await fluxbase
			.from<Record<string, any>>('user_preferences')
			.update({ preferences, updated_at: new Date().toISOString() })
			.eq('id', userId);
		if (error) {
			throw new Error(error.message || 'Failed to save Immich settings');
		}
	} else {
		const { error } = await fluxbase
			.from<Record<string, any>>('user_preferences')
			.insert({ id: userId, preferences });
		if (error) {
			// Lost a race with another tab creating the row — update instead.
			const { error: updateError } = await fluxbase
				.from<Record<string, any>>('user_preferences')
				.update({ preferences, updated_at: new Date().toISOString() })
				.eq('id', userId);
			if (updateError) {
				throw new Error(updateError.message || 'Failed to save Immich settings');
			}
		}
	}

	settingsState = { ...(settingsState ?? { enabled: false }), ...patch };
}

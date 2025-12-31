/**
 * Unified export for all service adapters.
 * These adapters split the monolithic service-adapter.ts into domain-specific modules.
 * @module adapters
 */

// Base adapter and config
export { BaseAdapter, type BaseAdapterConfig } from './base-adapter';

// Domain-specific adapters
export { ProfileAdapter } from './profile-adapter';
export {
	TwoFactorAdapter,
	type TwoFactorSetupResult,
	type TwoFactorEnableResult,
	type TwoFactorVerifyRequest
} from './two-factor-adapter';
export {
	TripsAdapter,
	type SuggestedImageResult,
	type GetTripsOptions,
	type PreGeneratedImage
} from './trips-adapter';
export { JobsAdapter, type JobProgress } from './jobs-adapter';
export { AdminAdapter } from './admin-adapter';
export { GeocodingAdapter, type GeocodingResult } from './geocoding-adapter';
export { TripExclusionsAdapter, type TripExclusion } from './trip-exclusions-adapter';
export { POIAdapter, type POIVisit, type DetectPOIVisitsOptions } from './poi-adapter';

import type { AuthSession } from '@fluxbase/sdk';
import { ProfileAdapter } from './profile-adapter';
import { TwoFactorAdapter } from './two-factor-adapter';
import { TripsAdapter } from './trips-adapter';
import { JobsAdapter } from './jobs-adapter';
import { AdminAdapter } from './admin-adapter';
import { GeocodingAdapter } from './geocoding-adapter';
import { TripExclusionsAdapter } from './trip-exclusions-adapter';
import { POIAdapter } from './poi-adapter';

/**
 * Factory function to create all adapters with a shared session.
 * This is the primary way to instantiate adapters for use in the application.
 *
 * @param session - The authenticated Fluxbase session
 * @returns Object containing all adapter instances
 *
 * @example
 * ```typescript
 * import { createAdapters } from '$lib/services/api/adapters';
 *
 * const session = await fluxbase.auth.getSession();
 * const adapters = createAdapters(session);
 *
 * const profile = await adapters.profile.getProfile();
 * const trips = await adapters.trips.getTrips();
 * ```
 */
export function createAdapters(session: AuthSession) {
	const config = { session };

	return {
		profile: new ProfileAdapter(config),
		twoFactor: new TwoFactorAdapter(config),
		trips: new TripsAdapter(config),
		jobs: new JobsAdapter(config),
		admin: new AdminAdapter(config),
		geocoding: new GeocodingAdapter(config),
		tripExclusions: new TripExclusionsAdapter(config),
		poi: new POIAdapter(config)
	};
}

export type Adapters = ReturnType<typeof createAdapters>;

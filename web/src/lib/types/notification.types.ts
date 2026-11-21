/**
 * A persistent in-app notification.
 *
 * Fed primarily by the client job-store when a job transitions to a terminal
 * state (completed/failed/cancelled), so notifications survive past the
 * transient ~60s job-state window. Lives in the `notifications` table
 * (owner-private via RLS).
 */
export type NotificationType =
	'job_completed' | 'job_failed' | 'job_cancelled' | 'trip_suggestion' | 'geocode_missing';

export interface AppNotification {
	id: string;
	user_id: string;
	type: NotificationType;
	title: string;
	body?: string | null;
	icon?: string | null;
	link?: string | null;
	related_job_id?: string | null;
	read_at?: string | null;
	created_at: string;
}

export interface UnreadCount {
	count: number;
}

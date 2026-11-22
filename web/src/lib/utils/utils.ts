import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/**
 * Format a date to YYYY-MM-DD in local timezone
 *
 * This function formats dates in the user's local timezone, avoiding the common
 * pitfall of using .toISOString().split('T')[0] which converts to UTC and can
 * cause off-by-one date errors in non-UTC timezones.
 *
 * @param date - Date object, date string, or null
 * @returns Date string in YYYY-MM-DD format, or empty string if invalid
 *
 * @example
 * // In UTC+2 timezone on Oct 24, 2025:
 * const date = new Date('Oct 24, 2025');
 * date.toISOString().split('T')[0]  // Returns '2025-10-23' (WRONG!)
 * formatLocalDate(date)              // Returns '2025-10-24' (CORRECT!)
 */
export function formatLocalDate(date: Date | string | null | undefined): string {
	if (!date) return '';
	const d = date instanceof Date ? date : new Date(date);
	if (isNaN(d.getTime())) return '';
	const year = d.getFullYear();
	const month = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/**
 * The trip the user is currently on (issue #288): while the user is away, the
 * daily trip job rolls a trip with status='active' and end_date = today
 * (labels=['auto-ongoing']). Surface the active trip that hasn't ended yet,
 * latest first. end_date is a plain date (YYYY-MM-DD), so string comparison
 * works.
 */
export function pickCurrentTrip(
	trips: Array<{ id: string; status: string; end_date: string }>,
	today: string = formatLocalDate(new Date())
): { id: string; status: string; end_date: string } | null {
	return (
		trips
			.filter((t) => t.status === 'active' && t.end_date >= today)
			.sort((a, b) => (a.end_date < b.end_date ? 1 : -1))[0] ?? null
	);
}

// Haversine distance in meters between two lat/lng points
export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
	const R = 6371000; // meters
	const toRad = (deg: number) => deg * (Math.PI / 180);
	const dLat = toRad(lat2 - lat1);
	const dLng = toRad(lng2 - lng1);
	const a =
		Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	return R * c;
}

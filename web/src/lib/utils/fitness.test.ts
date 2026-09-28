import { describe, expect, it } from 'vitest';

import { formatSubSport } from './fitness';

// Minimal stand-in for the i18n translate function: en.json labels.
const t = (key: string): string => {
	const labels: Record<string, string> = {
		'fitness.subSport.treadmill': 'Treadmill',
		'fitness.subSport.road': 'Road',
		'fitness.subSport.lap_swimming': 'Lap swimming'
	};
	return labels[key] ?? key;
};

describe('formatSubSport', () => {
	it('translates known slugs via the fitness.subSport.* keys', () => {
		expect(formatSubSport('treadmill', t)).toBe('Treadmill');
		expect(formatSubSport('road', t)).toBe('Road');
		expect(formatSubSport('lap_swimming', t)).toBe('Lap swimming');
	});

	it('passes unknown slugs through with underscores replaced by spaces', () => {
		expect(formatSubSport('virtual_ride', t)).toBe('virtual ride');
	});

	it('returns an empty string for empty or null slugs', () => {
		expect(formatSubSport('', t)).toBe('');
		expect(formatSubSport(null, t)).toBe('');
		expect(formatSubSport(undefined, t)).toBe('');
	});
});

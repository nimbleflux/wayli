/**
 * Amenity Icons Utility
 *
 * Maps POI amenities to Lucide icons and colors for visual display.
 * Based on categories from visit.types.ts
 */

import type { ComponentType } from 'svelte';
import {
	Utensils,
	Coffee,
	Wine,
	Beer,
	IceCream,
	Clapperboard,
	Theater,
	PartyPopper,
	Dices,
	Landmark,
	BookOpen,
	ShoppingBag,
	ShoppingCart,
	Store,
	Dumbbell,
	Sparkles,
	Waves,
	Hotel,
	Home,
	Building2,
	MapPin
} from 'lucide-svelte';

export interface AmenityStyle {
	icon: ComponentType;
	color: string; // Text/icon color
	bgColor: string; // Background color
	label: string; // Human-readable label
}

/**
 * Mapping of amenity types to their visual styles
 */
export const AMENITY_STYLES: Record<string, AmenityStyle> = {
	// Food & Drink
	restaurant: {
		icon: Utensils,
		color: '#EA580C',
		bgColor: '#FFF7ED',
		label: 'Restaurant'
	},
	cafe: {
		icon: Coffee,
		color: '#92400E',
		bgColor: '#FEF3C7',
		label: 'Cafe'
	},
	bar: {
		icon: Wine,
		color: '#7C3AED',
		bgColor: '#EDE9FE',
		label: 'Bar'
	},
	pub: {
		icon: Beer,
		color: '#B45309',
		bgColor: '#FEF3C7',
		label: 'Pub'
	},
	fast_food: {
		icon: Utensils,
		color: '#DC2626',
		bgColor: '#FEF2F2',
		label: 'Fast Food'
	},
	food_court: {
		icon: Store,
		color: '#EA580C',
		bgColor: '#FFF7ED',
		label: 'Food Court'
	},
	biergarten: {
		icon: Beer,
		color: '#65A30D',
		bgColor: '#F7FEE7',
		label: 'Beer Garden'
	},
	ice_cream: {
		icon: IceCream,
		color: '#EC4899',
		bgColor: '#FCE7F3',
		label: 'Ice Cream'
	},

	// Entertainment
	cinema: {
		icon: Clapperboard,
		color: '#DC2626',
		bgColor: '#FEF2F2',
		label: 'Cinema'
	},
	theatre: {
		icon: Theater,
		color: '#BE185D',
		bgColor: '#FCE7F3',
		label: 'Theatre'
	},
	nightclub: {
		icon: PartyPopper,
		color: '#7C3AED',
		bgColor: '#EDE9FE',
		label: 'Nightclub'
	},
	casino: {
		icon: Dices,
		color: '#059669',
		bgColor: '#ECFDF5',
		label: 'Casino'
	},

	// Culture
	museum: {
		icon: Landmark,
		color: '#2563EB',
		bgColor: '#EFF6FF',
		label: 'Museum'
	},
	gallery: {
		icon: Landmark,
		color: '#9333EA',
		bgColor: '#FAF5FF',
		label: 'Gallery'
	},
	library: {
		icon: BookOpen,
		color: '#0891B2',
		bgColor: '#ECFEFF',
		label: 'Library'
	},

	// Shopping
	mall: {
		icon: ShoppingBag,
		color: '#DB2777',
		bgColor: '#FCE7F3',
		label: 'Mall'
	},
	supermarket: {
		icon: ShoppingCart,
		color: '#16A34A',
		bgColor: '#F0FDF4',
		label: 'Supermarket'
	},
	marketplace: {
		icon: Store,
		color: '#D97706',
		bgColor: '#FFFBEB',
		label: 'Marketplace'
	},

	// Wellness
	gym: {
		icon: Dumbbell,
		color: '#DC2626',
		bgColor: '#FEF2F2',
		label: 'Gym'
	},
	spa: {
		icon: Sparkles,
		color: '#0D9488',
		bgColor: '#F0FDFA',
		label: 'Spa'
	},
	swimming_pool: {
		icon: Waves,
		color: '#0284C7',
		bgColor: '#E0F2FE',
		label: 'Swimming Pool'
	},

	// Accommodation
	hotel: {
		icon: Hotel,
		color: '#4F46E5',
		bgColor: '#EEF2FF',
		label: 'Hotel'
	},
	hostel: {
		icon: Building2,
		color: '#7C3AED',
		bgColor: '#EDE9FE',
		label: 'Hostel'
	},
	guest_house: {
		icon: Home,
		color: '#0891B2',
		bgColor: '#ECFEFF',
		label: 'Guest House'
	}
};

/**
 * Default style for unknown amenities
 */
export const DEFAULT_AMENITY_STYLE: AmenityStyle = {
	icon: MapPin,
	color: '#6B7280',
	bgColor: '#F3F4F6',
	label: 'Place'
};

/**
 * Get the style for an amenity type
 */
export function getAmenityStyle(amenity: string | null | undefined): AmenityStyle {
	if (!amenity) {
		return DEFAULT_AMENITY_STYLE;
	}

	return AMENITY_STYLES[amenity.toLowerCase()] || DEFAULT_AMENITY_STYLE;
}

/**
 * Get a human-readable label for an amenity
 */
export function getAmenityLabel(amenity: string | null | undefined): string {
	return getAmenityStyle(amenity).label;
}

/**
 * Category colors for high-level groupings
 */
export const CATEGORY_COLORS: Record<string, { color: string; bgColor: string }> = {
	food: { color: '#EA580C', bgColor: '#FFF7ED' },
	entertainment: { color: '#DB2777', bgColor: '#FCE7F3' },
	culture: { color: '#2563EB', bgColor: '#EFF6FF' },
	shopping: { color: '#16A34A', bgColor: '#F0FDF4' },
	wellness: { color: '#0D9488', bgColor: '#F0FDFA' },
	accommodation: { color: '#4F46E5', bgColor: '#EEF2FF' }
};

/**
 * Get colors for a category
 */
export function getCategoryColors(
	category: string | null | undefined
): { color: string; bgColor: string } {
	if (!category) {
		return { color: '#6B7280', bgColor: '#F3F4F6' };
	}

	return CATEGORY_COLORS[category.toLowerCase()] || { color: '#6B7280', bgColor: '#F3F4F6' };
}

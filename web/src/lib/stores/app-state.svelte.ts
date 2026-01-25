// Shared client-side state management using Svelte's $state() syntax

// Single state object with all properties
export const state = $state({
	// Theme state
	theme: 'light' as 'light' | 'dark',

	// Navigation state
	isSidebarOpen: true,

	// User preferences
	showUserMenu: false,

	// Storage notice banner visibility (for layout adjustments)
	storageBannerVisible: false,

	// Filter states for different pages
	filtersStartDate: null as Date | null,
	filtersEndDate: null as Date | null,
	filtersIsDatePickerOpen: false,

	// Map state
	mapInitialZoom: null as number | null,
	mapInitialCenter: null as { lat: number; lng: number } | null
});

// Theme management functions
export function setTheme(newTheme: 'light' | 'dark') {
	state.theme = newTheme;

	// Apply theme to document
	if (typeof document !== 'undefined') {
		if (newTheme === 'dark') {
			document.documentElement.classList.add('dark');
		} else {
			document.documentElement.classList.remove('dark');
		}

		// Store in localStorage for persistence
		localStorage.setItem('theme', newTheme);
	}
}

export function initializeTheme() {
	if (typeof document === 'undefined') return;

	// Check localStorage first
	const savedTheme = localStorage.getItem('theme') as 'light' | 'dark';

	if (savedTheme) {
		// Apply the saved theme
		if (savedTheme === 'dark') {
			document.documentElement.classList.add('dark');
		} else {
			document.documentElement.classList.remove('dark');
		}
		state.theme = savedTheme;
	} else {
		// Check system preference
		const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		const systemTheme = prefersDark ? 'dark' : 'light';

		// Apply the system theme
		if (systemTheme === 'dark') {
			document.documentElement.classList.add('dark');
		} else {
			document.documentElement.classList.remove('dark');
		}
		state.theme = systemTheme;
	}
}

// Navigation functions
export function toggleSidebar() {
	state.isSidebarOpen = !state.isSidebarOpen;
}

export function closeSidebar() {
	state.isSidebarOpen = false;
}

export function openSidebar() {
	state.isSidebarOpen = true;
}

export function setDateRange(startDate: Date | null, endDate: Date | null) {
	state.filtersStartDate = startDate;
	state.filtersEndDate = endDate;
}

export function setStartDate(startDate: Date | null) {
	state.filtersStartDate = startDate;
}

export function setEndDate(endDate: Date | null) {
	state.filtersEndDate = endDate;
}

export function clearFilters() {
	state.filtersStartDate = null;
	state.filtersEndDate = null;
}

export function toggleDatePicker() {
	state.filtersIsDatePickerOpen = !state.filtersIsDatePickerOpen;
}

export function closeDatePicker() {
	state.filtersIsDatePickerOpen = false;
}

// Map state functions
export function setMapInitialState(zoom: number, center: { lat: number; lng: number }) {
	state.mapInitialZoom = zoom;
	state.mapInitialCenter = center;
}

export function clearMapInitialState() {
	state.mapInitialZoom = null;
	state.mapInitialCenter = null;
}

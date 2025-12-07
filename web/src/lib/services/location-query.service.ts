/**
 * Location Query Service
 *
 * Frontend service for interacting with the location-query edge function.
 * Provides natural language queries about travel history.
 */

import { fluxbase } from '$lib/fluxbase';

// Types
export interface QuerySuggestion {
	question: string;
	description: string;
	category: 'location' | 'venue_type' | 'cuisine' | 'time' | 'discovery' | 'example';
}

export interface QueryHistoryEntry {
	id: string;
	question: string;
	generated_sql: string | null;
	explanation: string | null;
	result_count: number | null;
	execution_time_ms: number | null;
	is_favorite: boolean;
	created_at: string;
}

export interface QueryResult {
	sql: string | null;
	explanation: string;
	table: string | null;
	results?: PlaceVisitResult[];
	error?: string;
	errorCode?: string;
	errorSuggestion?: string;
	examples?: Array<{ question: string; description: string }>;
}

export interface PlaceVisitResult {
	id: string;
	started_at: string;
	ended_at: string;
	duration_minutes: number;
	longitude: number;
	latitude: number;
	poi_name: string | null;
	poi_amenity: string | null;
	poi_cuisine: string | null;
	poi_category: string | null;
	poi_tags: Record<string, string>;
	city: string | null;
	country: string | null;
	country_code: string | null;
	confidence_score: number | null;
}

export interface SuggestionsResponse {
	suggestions: QuerySuggestion[];
	stats: {
		recent_countries: string[];
		recent_cities: string[];
		top_amenities: string[];
		top_cuisines: string[];
	} | null;
}

export interface HistoryResponse {
	history: QueryHistoryEntry[];
	total: number | null;
	limit: number;
	offset: number;
}

class LocationQueryService {
	private baseUrl: string;

	constructor() {
		this.baseUrl = '/api/location-query';
	}

	/**
	 * Execute a natural language query
	 */
	async query(
		question: string,
		options: { execute?: boolean; saveToHistory?: boolean } = {}
	): Promise<QueryResult> {
		const { execute = true, saveToHistory = true } = options;

		const response = await fetch(this.baseUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			credentials: 'include',
			body: JSON.stringify({
				question,
				execute,
				save_to_history: saveToHistory
			})
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'Query failed');
		}

		return response.json();
	}

	/**
	 * Get personalized query suggestions
	 */
	async getSuggestions(): Promise<SuggestionsResponse> {
		const response = await fetch(`${this.baseUrl}/suggestions`, {
			method: 'GET',
			credentials: 'include'
		});

		if (!response.ok) {
			// Return default suggestions on error
			return {
				suggestions: [
					{
						question: 'Which restaurants did I visit in Vietnam?',
						description: 'Find all restaurant visits in a specific country',
						category: 'example'
					},
					{
						question: 'What vegan places did I go to last month?',
						description: 'Filter by cuisine type and date range',
						category: 'example'
					},
					{
						question: 'Show me cafes I visited in Tokyo',
						description: 'Find cafes in a specific city',
						category: 'example'
					}
				],
				stats: null
			};
		}

		return response.json();
	}

	/**
	 * Get query history
	 */
	async getHistory(options: {
		limit?: number;
		offset?: number;
		favoritesOnly?: boolean;
	} = {}): Promise<HistoryResponse> {
		const { limit = 20, offset = 0, favoritesOnly = false } = options;

		const params = new URLSearchParams({
			limit: limit.toString(),
			offset: offset.toString(),
			...(favoritesOnly && { favorites: 'true' })
		});

		const response = await fetch(`${this.baseUrl}/history?${params}`, {
			method: 'GET',
			credentials: 'include'
		});

		if (!response.ok) {
			throw new Error('Failed to fetch history');
		}

		return response.json();
	}

	/**
	 * Toggle favorite status for a history entry
	 */
	async toggleFavorite(historyId: string, isFavorite: boolean): Promise<boolean> {
		const response = await fetch(`${this.baseUrl}/favorite`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			credentials: 'include',
			body: JSON.stringify({
				history_id: historyId,
				is_favorite: isFavorite
			})
		});

		if (!response.ok) {
			throw new Error('Failed to update favorite');
		}

		const data = await response.json();
		return data.is_favorite;
	}

	/**
	 * Delete history entries
	 */
	async deleteHistory(historyId?: string, clearAll = false): Promise<void> {
		const response = await fetch(`${this.baseUrl}/history`, {
			method: 'DELETE',
			headers: {
				'Content-Type': 'application/json'
			},
			credentials: 'include',
			body: JSON.stringify({
				history_id: historyId,
				clear_all: clearAll
			})
		});

		if (!response.ok) {
			throw new Error('Failed to delete history');
		}
	}

	/**
	 * Submit feedback for a query
	 */
	async submitFeedback(feedback: {
		question: string;
		generated_sql: string | null;
		was_helpful: boolean;
		feedback_type?: 'wrong_results' | 'syntax_error' | 'missing_data' | 'perfect' | 'other';
		feedback_text?: string;
	}): Promise<void> {
		const response = await fetch(`${this.baseUrl}/feedback`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			credentials: 'include',
			body: JSON.stringify(feedback)
		});

		if (!response.ok) {
			throw new Error('Failed to submit feedback');
		}
	}

	/**
	 * Confirm, reject, or correct a place visit
	 */
	async updateVisit(
		visitId: string,
		action: 'confirm' | 'reject' | 'correct',
		correctedPoi?: {
			poi_name?: string;
			poi_amenity?: string;
			poi_cuisine?: string;
			poi_category?: string;
		}
	): Promise<{ success: boolean; message?: string; error?: string }> {
		const response = await fetch(`${this.baseUrl}/visit`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			credentials: 'include',
			body: JSON.stringify({
				visit_id: visitId,
				action,
				corrected_poi: correctedPoi
			})
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || 'Failed to update visit');
		}

		return response.json();
	}
}

// Export singleton instance
export const locationQueryService = new LocationQueryService();

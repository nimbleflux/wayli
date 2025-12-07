/**
 * Location Query Service
 *
 * Translates natural language questions about travel history into SQL queries
 * using an LLM provider. Handles questions like:
 * - "Which vegan restaurant did I visit in Vietnam in May?"
 * - "What museums have I been to this year?"
 * - "Show me all the cafes I visited in Paris"
 */

import type { ChatMessage, MergedAIConfig } from '../../types/ai.types';
import { LOCATION_QUERY_SCHEMA } from '../../types/ai.types';
import { LLMService } from './llm-provider.service';

/**
 * Result of a location query
 */
export interface LocationQueryResult {
	// The generated SQL query
	sql: string;
	// Explanation of what the query does
	explanation: string;
	// Which table(s) the query uses
	tables: ('tracker_data' | 'place_visits')[];
	// Confidence in the query (0-1)
	confidence: number;
	// Raw LLM response
	raw_response?: string;
}

/**
 * Error from location query
 */
export interface LocationQueryError {
	code: 'INVALID_QUESTION' | 'LLM_ERROR' | 'PARSE_ERROR' | 'NOT_CONFIGURED';
	message: string;
	details?: string;
}

/**
 * System prompt for SQL generation
 */
const SYSTEM_PROMPT = `You are a SQL query generator for a travel tracking application. Your job is to translate natural language questions about a user's travel history into valid PostgreSQL queries.

${LOCATION_QUERY_SCHEMA}

IMPORTANT RULES:
1. Always generate valid PostgreSQL syntax
2. Always include "WHERE user_id = $1" to filter by user
3. Use parameterized queries ($1 for user_id, no other parameters for now)
4. Prefer place_visits table for questions about specific venues/places
5. Use tracker_data for general location history questions
6. For date ranges, use >= and < with dates (not BETWEEN)
7. Use ILIKE for case-insensitive text matching
8. Limit results to 100 rows maximum unless specifically asked for more
9. Order results by date descending (most recent first) unless otherwise specified
10. Do NOT use subqueries if a simple JOIN or WHERE clause will work

OUTPUT FORMAT:
You must respond with a JSON object in this exact format:
{
  "sql": "SELECT ... FROM ... WHERE user_id = $1 ...",
  "explanation": "Brief explanation of what this query finds",
  "tables": ["place_visits"],
  "confidence": 0.9
}

If you cannot generate a valid query for the question, respond with:
{
  "sql": null,
  "explanation": "Reason why the query cannot be generated",
  "tables": [],
  "confidence": 0
}

Examples:

Question: "Which restaurants did I visit in Vietnam?"
{
  "sql": "SELECT poi_name, city, started_at, duration_minutes FROM place_visits WHERE user_id = $1 AND country_code = 'vn' AND poi_amenity = 'restaurant' ORDER BY started_at DESC LIMIT 100",
  "explanation": "Finds all restaurant visits in Vietnam, ordered by most recent first",
  "tables": ["place_visits"],
  "confidence": 0.95
}

Question: "What vegan places have I been to?"
{
  "sql": "SELECT poi_name, poi_amenity, city, country, started_at FROM place_visits WHERE user_id = $1 AND (poi_tags->>'diet:vegan' = 'yes' OR poi_cuisine ILIKE '%vegan%') ORDER BY started_at DESC LIMIT 100",
  "explanation": "Finds all visits to places marked as vegan or with vegan cuisine",
  "tables": ["place_visits"],
  "confidence": 0.85
}

Question: "How many countries have I visited this year?"
{
  "sql": "SELECT COUNT(DISTINCT country_code) as country_count FROM tracker_data WHERE user_id = $1 AND recorded_at >= date_trunc('year', CURRENT_DATE) AND country_code IS NOT NULL",
  "explanation": "Counts unique countries visited since the start of the current year",
  "tables": ["tracker_data"],
  "confidence": 0.9
}`;

/**
 * Location Query Service class
 */
export class LocationQueryService {
	private llmService: LLMService;

	constructor(config: MergedAIConfig) {
		this.llmService = new LLMService(config);
	}

	/**
	 * Generate a SQL query from a natural language question
	 */
	async generateQuery(question: string): Promise<LocationQueryResult> {
		if (!this.llmService.isConfigured()) {
			throw {
				code: 'NOT_CONFIGURED',
				message: 'LLM service is not configured'
			} as LocationQueryError;
		}

		// Validate question
		if (!question || question.trim().length < 5) {
			throw {
				code: 'INVALID_QUESTION',
				message: 'Question is too short or empty'
			} as LocationQueryError;
		}

		const messages: ChatMessage[] = [
			{ role: 'system', content: SYSTEM_PROMPT },
			{ role: 'user', content: question.trim() }
		];

		try {
			const response = await this.llmService.chat(messages, {
				max_tokens: 1024,
				temperature: 0.1 // Low temperature for more deterministic SQL
			});

			return this.parseResponse(response.content);
		} catch (error) {
			if ((error as LocationQueryError).code) {
				throw error;
			}
			throw {
				code: 'LLM_ERROR',
				message: 'Failed to generate query',
				details: error instanceof Error ? error.message : String(error)
			} as LocationQueryError;
		}
	}

	/**
	 * Parse the LLM response into a LocationQueryResult
	 */
	private parseResponse(content: string): LocationQueryResult {
		try {
			// Extract JSON from response (handle potential markdown code blocks)
			let jsonStr = content;
			const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
			if (jsonMatch) {
				jsonStr = jsonMatch[1];
			}

			const parsed = JSON.parse(jsonStr.trim());

			// Validate required fields
			if (parsed.sql === null) {
				return {
					sql: '',
					explanation: parsed.explanation || 'Could not generate query',
					tables: [],
					confidence: 0,
					raw_response: content
				};
			}

			// Basic SQL injection prevention (parameterized queries should prevent most)
			const sql = this.sanitizeSQL(parsed.sql);

			return {
				sql,
				explanation: parsed.explanation || '',
				tables: parsed.tables || [],
				confidence: Math.min(Math.max(parsed.confidence || 0, 0), 1),
				raw_response: content
			};
		} catch (error) {
			throw {
				code: 'PARSE_ERROR',
				message: 'Failed to parse LLM response',
				details: content
			} as LocationQueryError;
		}
	}

	/**
	 * Basic SQL sanitization
	 */
	private sanitizeSQL(sql: string): string {
		// Ensure it starts with SELECT (read-only)
		const trimmed = sql.trim().toUpperCase();
		if (!trimmed.startsWith('SELECT')) {
			throw {
				code: 'PARSE_ERROR',
				message: 'Generated query is not a SELECT statement'
			} as LocationQueryError;
		}

		// Check for dangerous keywords
		const dangerous = ['DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'CREATE', 'TRUNCATE', 'EXEC', 'EXECUTE'];
		for (const keyword of dangerous) {
			if (trimmed.includes(keyword)) {
				throw {
					code: 'PARSE_ERROR',
					message: `Generated query contains forbidden keyword: ${keyword}`
				} as LocationQueryError;
			}
		}

		// Ensure user_id filter is present
		if (!sql.toLowerCase().includes('user_id')) {
			throw {
				code: 'PARSE_ERROR',
				message: 'Generated query missing user_id filter'
			} as LocationQueryError;
		}

		return sql;
	}

	/**
	 * Validate a SQL query (dry run) - to be implemented with actual DB
	 */
	async validateQuery(sql: string): Promise<{ valid: boolean; error?: string }> {
		// This would use EXPLAIN to validate the query without executing it
		// For now, just return true if we got this far
		return { valid: true };
	}

	/**
	 * Get suggested questions for the user
	 */
	getSuggestedQuestions(): string[] {
		return [
			'Which restaurants did I visit last month?',
			'What museums have I been to this year?',
			'Show me all the cafes I visited in Europe',
			'Which vegan places have I visited?',
			'What countries did I visit in 2024?',
			'Where did I spend the most time last week?',
			'Show me my visits to bars and pubs',
			'Which places did I visit multiple times?'
		];
	}

	/**
	 * Update the LLM configuration
	 */
	updateConfig(config: MergedAIConfig): void {
		this.llmService.updateConfig(config);
	}

	/**
	 * Check if the service is configured
	 */
	isConfigured(): boolean {
		return this.llmService.isConfigured();
	}
}

/**
 * Create a location query service with configuration
 */
export function createLocationQueryService(config: MergedAIConfig): LocationQueryService {
	return new LocationQueryService(config);
}

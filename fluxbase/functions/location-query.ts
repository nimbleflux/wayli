/**
 * Location Query Edge Function
 *
 * Translates natural language questions about travel history into SQL queries
 * using an LLM provider. Executes the query and returns results.
 *
 * Example: "Which vegan restaurant did I visit in Vietnam in May?"
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:allow-net
 * @fluxbase:allow-env
 */

import { createClient } from '@fluxbase/sdk';

// Schema information for the LLM
const SCHEMA_CONTEXT = `
You have access to these tables for answering location questions:

1. place_visits table - Detected venue/POI visits (optimized for questions about specific venues)
   Columns:
   - id: UUID
   - user_id: UUID
   - started_at, ended_at: TIMESTAMPTZ
   - duration_minutes: INTEGER (generated)
   - location: GEOMETRY(Point, 4326)
   - poi_name: TEXT (place name)
   - poi_amenity: TEXT (restaurant, cafe, museum, etc.)
   - poi_cuisine: TEXT (vietnamese, italian, vegan, etc.)
   - poi_category: TEXT (food, entertainment, culture, shopping, wellness, accommodation)
   - poi_tags: JSONB (full OSM tags like diet:vegan, wheelchair, etc.)
   - city, country: TEXT
   - country_code: VARCHAR(2)
   - confidence_score: NUMERIC(3,2)

2. tracker_data table - Raw GPS points with geocoding
   Key columns:
   - user_id: UUID
   - recorded_at: TIMESTAMPTZ
   - location: GEOMETRY(Point, 4326)
   - country_code: VARCHAR(2)
   - geocode: JSONB (contains address, nearby_pois, addendum with OSM tags)
   - accuracy: NUMERIC (GPS accuracy in meters)

Query patterns:
- Restaurants in a country: WHERE poi_amenity = 'restaurant' AND country_code = 'vn'
- Vegan places: WHERE poi_tags->>'diet:vegan' = 'yes' OR poi_cuisine ILIKE '%vegan%'
- Date ranges: WHERE started_at >= '2024-05-01' AND started_at < '2024-06-01'
- High confidence: WHERE confidence_score >= 0.8
`;

const SYSTEM_PROMPT = `You are a SQL query generator for a travel tracking application. Your job is to translate natural language questions about a user's travel history into valid PostgreSQL queries.

${SCHEMA_CONTEXT}

IMPORTANT RULES:
1. Always generate valid PostgreSQL syntax
2. Always include "WHERE user_id = $1" to filter by user
3. Use parameterized queries ($1 for user_id)
4. Prefer place_visits for questions about specific venues
5. Use tracker_data for general location history
6. For dates, use >= and < (not BETWEEN)
7. Use ILIKE for case-insensitive text matching
8. Limit to 100 rows unless asked otherwise
9. Order by date DESC unless otherwise specified
10. Only generate SELECT queries

OUTPUT FORMAT (JSON only):
{
  "sql": "SELECT ... FROM ... WHERE user_id = $1 ...",
  "explanation": "Brief explanation of what this query finds",
  "table": "place_visits or tracker_data"
}

If you cannot generate a valid query:
{
  "sql": null,
  "explanation": "Reason why",
  "table": null
}`;

interface QueryResult {
	sql: string | null;
	explanation: string;
	table: string | null;
	results?: unknown[];
	error?: string;
}

async function callLLM(
	question: string,
	config: { provider: string; model: string; api_key: string; api_endpoint?: string }
): Promise<{ sql: string | null; explanation: string; table: string | null }> {
	const messages = [
		{ role: 'system', content: SYSTEM_PROMPT },
		{ role: 'user', content: question }
	];

	let response: Response;
	let data: any;

	switch (config.provider) {
		case 'openai':
			response = await fetch(config.api_endpoint || 'https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${config.api_key}`
				},
				body: JSON.stringify({
					model: config.model,
					messages,
					max_tokens: 1024,
					temperature: 0.1
				})
			});
			data = await response.json();
			return JSON.parse(data.choices?.[0]?.message?.content || '{}');

		case 'anthropic':
			response = await fetch(config.api_endpoint || 'https://api.anthropic.com/v1/messages', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-api-key': config.api_key,
					'anthropic-version': '2023-06-01'
				},
				body: JSON.stringify({
					model: config.model,
					max_tokens: 1024,
					system: SYSTEM_PROMPT,
					messages: [{ role: 'user', content: question }],
					temperature: 0.1
				})
			});
			data = await response.json();
			return JSON.parse(data.content?.[0]?.text || '{}');

		case 'ollama':
			response = await fetch(`${config.api_endpoint}/api/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					model: config.model,
					messages,
					stream: false,
					options: { temperature: 0.1 }
				})
			});
			data = await response.json();
			return JSON.parse(data.message?.content || '{}');

		default:
			// Generic OpenAI-compatible endpoint
			response = await fetch(`${config.api_endpoint}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(config.api_key ? { Authorization: `Bearer ${config.api_key}` } : {})
				},
				body: JSON.stringify({
					model: config.model,
					messages,
					max_tokens: 1024,
					temperature: 0.1
				})
			});
			data = await response.json();
			return JSON.parse(data.choices?.[0]?.message?.content || '{}');
	}
}

function validateSQL(sql: string): { valid: boolean; error?: string } {
	const upper = sql.trim().toUpperCase();

	// Must be SELECT
	if (!upper.startsWith('SELECT')) {
		return { valid: false, error: 'Only SELECT queries are allowed' };
	}

	// Check for dangerous keywords
	const dangerous = ['DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'CREATE', 'TRUNCATE', 'EXEC'];
	for (const keyword of dangerous) {
		if (upper.includes(keyword)) {
			return { valid: false, error: `Forbidden keyword: ${keyword}` };
		}
	}

	// Must have user_id filter
	if (!sql.toLowerCase().includes('user_id')) {
		return { valid: false, error: 'Missing user_id filter' };
	}

	return { valid: true };
}

async function handler(req: Request): Promise<Response> {
	try {
		// Parse request
		const body = await req.json();
		const { question, execute = false } = body;

		if (!question || typeof question !== 'string' || question.trim().length < 5) {
			return new Response(
				JSON.stringify({ error: 'Invalid question', code: 'INVALID_INPUT' }),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			);
		}

		// Get user from request (set by Fluxbase auth middleware)
		const userId = (req as any).user?.id;
		if (!userId) {
			return new Response(
				JSON.stringify({ error: 'Unauthorized', code: 'UNAUTHORIZED' }),
				{ status: 401, headers: { 'Content-Type': 'application/json' } }
			);
		}

		// Get Fluxbase client
		const fluxbaseUrl = Deno.env.get('FLUXBASE_BASE_URL') ?? '';
		const fluxbaseKey = Deno.env.get('FLUXBASE_SERVICE_ROLE_KEY') ?? '';
		const fluxbase = createClient(fluxbaseUrl, fluxbaseKey);

		// Get AI config (server-level, then user override)
		let aiConfig: { provider: string; model: string; api_key: string; api_endpoint?: string } | null = null;

		// Try server config first
		const { data: serverConfig } = await fluxbase
			.from('ai_config')
			.select('*')
			.eq('name', 'location_query')
			.eq('enabled', true)
			.single();

		if (serverConfig) {
			aiConfig = {
				provider: serverConfig.provider,
				model: serverConfig.model,
				api_key: serverConfig.api_key_encrypted || '', // Would need decryption in production
				api_endpoint: serverConfig.api_endpoint
			};
		}

		// Check for user override
		const { data: userPrefs } = await fluxbase
			.from('user_preferences')
			.select('ai_config')
			.eq('id', userId)
			.single();

		if (userPrefs?.ai_config?.enabled && userPrefs?.ai_config?.api_key) {
			aiConfig = {
				provider: userPrefs.ai_config.provider || aiConfig?.provider || 'openai',
				model: userPrefs.ai_config.model || aiConfig?.model || 'gpt-4o-mini',
				api_key: userPrefs.ai_config.api_key,
				api_endpoint: userPrefs.ai_config.api_endpoint || aiConfig?.api_endpoint
			};
		}

		if (!aiConfig || !aiConfig.api_key) {
			return new Response(
				JSON.stringify({
					error: 'AI not configured. Please configure an AI provider in settings.',
					code: 'AI_NOT_CONFIGURED'
				}),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			);
		}

		// Generate SQL using LLM
		console.log(`🤖 Generating SQL for question: "${question.substring(0, 50)}..."`);
		const llmResult = await callLLM(question, aiConfig);

		if (!llmResult.sql) {
			return new Response(
				JSON.stringify({
					sql: null,
					explanation: llmResult.explanation || 'Could not generate query',
					table: null,
					results: []
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } }
			);
		}

		// Validate SQL
		const validation = validateSQL(llmResult.sql);
		if (!validation.valid) {
			return new Response(
				JSON.stringify({
					error: validation.error,
					code: 'INVALID_SQL',
					sql: llmResult.sql
				}),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			);
		}

		const result: QueryResult = {
			sql: llmResult.sql,
			explanation: llmResult.explanation,
			table: llmResult.table
		};

		// Execute query if requested
		if (execute) {
			console.log(`🔍 Executing query: ${llmResult.sql.substring(0, 100)}...`);
			try {
				// Use raw SQL execution
				const { data: queryResults, error: queryError } = await fluxbase.rpc('execute_user_query', {
					query_sql: llmResult.sql,
					query_user_id: userId
				});

				if (queryError) {
					result.error = queryError.message;
				} else {
					result.results = queryResults || [];
				}
			} catch (execError: any) {
				result.error = execError.message;
			}
		}

		return new Response(JSON.stringify(result), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error: any) {
		console.error('Location query error:', error);
		return new Response(
			JSON.stringify({ error: error.message, code: 'INTERNAL_ERROR' }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
}

export { handler };

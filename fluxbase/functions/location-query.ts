/**
 * Location Query Edge Function
 *
 * Translates natural language questions about travel history into SQL queries
 * using an LLM provider. Executes the query and returns results.
 *
 * Features:
 * - Natural language to SQL translation
 * - Rate limiting (10 queries/minute)
 * - Query examples for guidance
 * - Feedback collection for improving accuracy
 * - Retry logic for transient failures
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:allow-net
 * @fluxbase:allow-env
 */

import { createClient } from '@fluxbase/sdk';

// =============================================================================
// Query Examples (shown to users and used for LLM context)
// =============================================================================

const QUERY_EXAMPLES = [
	{
		question: 'Which restaurants did I visit in Vietnam?',
		description: 'Find all restaurant visits in a specific country'
	},
	{
		question: 'What vegan places did I go to last month?',
		description: 'Filter by cuisine type and date range'
	},
	{
		question: 'Show me cafes I visited in Tokyo',
		description: 'Find cafes in a specific city'
	},
	{
		question: 'Where did I spend the most time eating?',
		description: 'Find longest restaurant visits'
	},
	{
		question: 'List all museums I visited in 2024',
		description: 'Find cultural venues by year'
	},
	{
		question: 'Which bars did I visit in Barcelona in summer?',
		description: 'Combine location, venue type, and season'
	}
];

// =============================================================================
// User-Friendly Error Messages
// =============================================================================

const ERROR_MESSAGES: Record<string, { title: string; suggestion: string }> = {
	RATE_LIMITED: {
		title: 'Too many requests',
		suggestion: 'Please wait a moment before trying again. You can make up to 10 queries per minute.'
	},
	AI_NOT_CONFIGURED: {
		title: 'AI not set up',
		suggestion:
			'To use natural language queries, please configure an AI provider in your settings, or ask the administrator to enable it.'
	},
	INVALID_SQL: {
		title: 'Query generation failed',
		suggestion:
			"The AI couldn't create a valid query. Try rephrasing your question or use simpler terms."
	},
	QUERY_TIMEOUT: {
		title: 'Query took too long',
		suggestion:
			'The query was too complex. Try narrowing down your search with specific dates or locations.'
	},
	UNAUTHORIZED: {
		title: 'Not logged in',
		suggestion: 'Please log in to access your travel history.'
	},
	INTERNAL_ERROR: {
		title: 'Something went wrong',
		suggestion: "We're having technical difficulties. Please try again later."
	}
};

// =============================================================================
// Schema Context for LLM
// =============================================================================

const SCHEMA_CONTEXT = `
You have access to these VIEWS for answering location questions.
IMPORTANT: You MUST use my_place_visits and my_tracker_data views.
These views are automatically filtered to the current user's data - do NOT add user_id filters.

1. my_place_visits view - Detected venue/POI visits (use for questions about specific venues)
   Columns:
   - id: UUID
   - started_at, ended_at: TIMESTAMPTZ
   - duration_minutes: INTEGER
   - longitude, latitude: FLOAT (coordinates)
   - poi_name: TEXT (place name)
   - poi_amenity: TEXT (restaurant, cafe, museum, etc.)
   - poi_cuisine: TEXT (vietnamese, italian, vegan, etc.)
   - poi_category: TEXT (food, entertainment, culture, shopping, wellness, accommodation)
   - poi_tags: JSONB (full OSM tags like diet:vegan, wheelchair, etc.)
   - city, country: TEXT
   - country_code: VARCHAR(2)
   - confidence_score: NUMERIC(3,2)

2. my_tracker_data view - Raw GPS points with geocoding
   Columns:
   - id: UUID
   - recorded_at: TIMESTAMPTZ
   - longitude, latitude: FLOAT (coordinates)
   - country_code: VARCHAR(2)
   - geocode: JSONB (contains address, nearby_pois, addendum with OSM tags)
   - accuracy: NUMERIC (GPS accuracy in meters)

Query examples:
- Restaurants in Vietnam: SELECT * FROM my_place_visits WHERE poi_amenity = 'restaurant' AND country_code = 'vn'
- Vegan places: SELECT * FROM my_place_visits WHERE poi_tags->>'diet:vegan' = 'yes' OR poi_cuisine ILIKE '%vegan%'
- Date ranges: SELECT * FROM my_place_visits WHERE started_at >= '2024-05-01' AND started_at < '2024-06-01'
- High confidence: SELECT * FROM my_place_visits WHERE confidence_score >= 0.8
- Last month: SELECT * FROM my_place_visits WHERE started_at >= NOW() - INTERVAL '1 month'
`;

const SYSTEM_PROMPT = `You are a SQL query generator for a travel tracking application. Your job is to translate natural language questions about a user's travel history into valid PostgreSQL queries.

${SCHEMA_CONTEXT}

CRITICAL RULES:
1. ALWAYS use my_place_visits or my_tracker_data views (NEVER use place_visits or tracker_data directly)
2. Do NOT include user_id in queries - the views automatically filter by the current user
3. Always generate valid PostgreSQL syntax
4. Prefer my_place_visits for questions about specific venues (restaurants, cafes, museums)
5. Use my_tracker_data for general location history and GPS tracks
6. For dates, use >= and < (not BETWEEN)
7. Use ILIKE for case-insensitive text matching
8. Limit to 100 rows unless asked otherwise
9. Order by date DESC unless otherwise specified
10. Only generate SELECT queries

OUTPUT FORMAT (JSON only):
{
  "sql": "SELECT ... FROM my_place_visits WHERE ...",
  "explanation": "Brief explanation of what this query finds",
  "table": "my_place_visits or my_tracker_data"
}

If you cannot generate a valid query:
{
  "sql": null,
  "explanation": "Reason why",
  "table": null
}`;

// =============================================================================
// Types
// =============================================================================

interface QueryResult {
	sql: string | null;
	explanation: string;
	table: string | null;
	results?: unknown[];
	error?: string;
	errorCode?: string;
	errorSuggestion?: string;
}

interface FeedbackRequest {
	question: string;
	generated_sql: string | null;
	was_helpful: boolean;
	feedback_type?: 'wrong_results' | 'syntax_error' | 'missing_data' | 'perfect' | 'other';
	feedback_text?: string;
}

interface HistoryEntry {
	id: string;
	question: string;
	generated_sql: string | null;
	explanation: string | null;
	result_count: number | null;
	execution_time_ms: number | null;
	is_favorite: boolean;
	created_at: string;
}

// =============================================================================
// LLM Call with Retry
// =============================================================================

async function callLLMWithRetry(
	question: string,
	config: { provider: string; model: string; api_key: string; api_endpoint?: string },
	maxRetries = 3
): Promise<{ sql: string | null; explanation: string; table: string | null }> {
	let lastError: Error | null = null;

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		try {
			return await callLLM(question, config);
		} catch (error) {
			lastError = error as Error;
			const isRetryable =
				error instanceof Error &&
				(error.message.includes('rate limit') ||
					error.message.includes('timeout') ||
					error.message.includes('503') ||
					error.message.includes('502'));

			if (!isRetryable || attempt === maxRetries - 1) {
				throw error;
			}

			// Exponential backoff: 1s, 2s, 4s
			const delay = 1000 * Math.pow(2, attempt);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	throw lastError;
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
	let data: unknown;

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
			return JSON.parse((data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content || '{}');

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
			return JSON.parse((data as { content?: Array<{ text?: string }> }).content?.[0]?.text || '{}');

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
			return JSON.parse((data as { message?: { content?: string } }).message?.content || '{}');

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
			return JSON.parse((data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content || '{}');
	}
}

// =============================================================================
// SQL Validation (improved)
// =============================================================================

function validateSQL(sql: string): { valid: boolean; error?: string; errorCode?: string } {
	// Strip comments first
	const stripped = sql
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.replace(/--[^\n\r]*/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	const upper = stripped.toUpperCase();

	// Must be SELECT
	if (!/^\s*SELECT\b/.test(upper)) {
		return { valid: false, error: 'Only SELECT queries are allowed', errorCode: 'INVALID_SQL' };
	}

	// Check for dangerous keywords with word boundaries
	const dangerous = [
		'DROP',
		'DELETE',
		'UPDATE',
		'INSERT',
		'ALTER',
		'CREATE',
		'TRUNCATE',
		'EXEC',
		'GRANT',
		'REVOKE'
	];
	for (const keyword of dangerous) {
		const regex = new RegExp(`\\b${keyword}\\b`, 'i');
		if (regex.test(stripped)) {
			return { valid: false, error: `Forbidden keyword: ${keyword}`, errorCode: 'INVALID_SQL' };
		}
	}

	// Must have user_id filter
	if (!/user_id\s*=/i.test(stripped)) {
		return { valid: false, error: 'Missing user_id filter', errorCode: 'INVALID_SQL' };
	}

	return { valid: true };
}

// =============================================================================
// Request Handlers
// =============================================================================

async function handleQuery(req: Request, fluxbase: ReturnType<typeof createClient>, userId: string): Promise<Response> {
	const body = await req.json();
	const { question, execute = false, save_to_history = true } = body;

	if (!question || typeof question !== 'string' || question.trim().length < 5) {
		return errorResponse('Please enter a question with at least 5 characters.', 'INVALID_INPUT', 400);
	}

	// Check rate limit
	const { data: withinLimit } = await fluxbase.rpc('check_rate_limit', {
		p_user_id: userId,
		p_action: 'location_query',
		p_max_requests: 10,
		p_window_minutes: 1
	});

	if (withinLimit === false) {
		return errorResponse('RATE_LIMITED', 'RATE_LIMITED', 429);
	}

	// Get AI config
	const aiConfig = await getAIConfig(fluxbase, userId);
	if (!aiConfig) {
		return errorResponse('AI_NOT_CONFIGURED', 'AI_NOT_CONFIGURED', 400);
	}

	// Generate SQL using LLM
	console.log(`🤖 Generating SQL for question: "${question.substring(0, 50)}..."`);
	const startTime = Date.now();

	let llmResult: { sql: string | null; explanation: string; table: string | null };
	try {
		llmResult = await callLLMWithRetry(question, aiConfig);
	} catch (error) {
		console.error('LLM call failed:', error);
		return errorResponse('INTERNAL_ERROR', 'INTERNAL_ERROR', 500);
	}

	if (!llmResult.sql) {
		return new Response(
			JSON.stringify({
				sql: null,
				explanation: llmResult.explanation || "I couldn't understand that question. Try rephrasing it.",
				table: null,
				results: [],
				examples: QUERY_EXAMPLES.slice(0, 3)
			}),
			{ status: 200, headers: { 'Content-Type': 'application/json' } }
		);
	}

	// Validate SQL
	const validation = validateSQL(llmResult.sql);
	if (!validation.valid) {
		const errorInfo = ERROR_MESSAGES[validation.errorCode || 'INVALID_SQL'];
		return new Response(
			JSON.stringify({
				error: errorInfo.title,
				errorCode: validation.errorCode,
				errorSuggestion: errorInfo.suggestion,
				sql: llmResult.sql,
				examples: QUERY_EXAMPLES.slice(0, 3)
			}),
			{ status: 400, headers: { 'Content-Type': 'application/json' } }
		);
	}

	const result: QueryResult = {
		sql: llmResult.sql,
		explanation: llmResult.explanation,
		table: llmResult.table
	};

	let resultCount = 0;

	// Execute query if requested
	if (execute) {
		console.log(`🔍 Executing query: ${llmResult.sql.substring(0, 100)}...`);
		try {
			const { data: queryResults, error: queryError } = await fluxbase.rpc('execute_user_query', {
				query_sql: llmResult.sql,
				query_user_id: userId,
				max_rows: 100,
				timeout_ms: 5000
			});

			if (queryError) {
				if (queryError.message.includes('timed out')) {
					result.errorCode = 'QUERY_TIMEOUT';
					result.error = ERROR_MESSAGES.QUERY_TIMEOUT.title;
					result.errorSuggestion = ERROR_MESSAGES.QUERY_TIMEOUT.suggestion;
				} else {
					result.error = queryError.message;
				}
			} else {
				result.results = queryResults || [];
				resultCount = result.results.length;
			}
		} catch (execError) {
			result.error = (execError as Error).message;
		}
	}

	const executionTime = Date.now() - startTime;

	// Save to query history (non-blocking)
	if (save_to_history && !result.error) {
		fluxbase.from('query_history').insert({
			user_id: userId,
			question: question.trim(),
			generated_sql: llmResult.sql,
			explanation: llmResult.explanation,
			result_count: execute ? resultCount : null,
			execution_time_ms: executionTime
		}).then(({ error }) => {
			if (error) console.error('Failed to save query history:', error);
		});
	}

	return new Response(JSON.stringify(result), {
		status: 200,
		headers: { 'Content-Type': 'application/json' }
	});
}

async function handleFeedback(req: Request, fluxbase: ReturnType<typeof createClient>, userId: string): Promise<Response> {
	const body: FeedbackRequest = await req.json();

	if (!body.question) {
		return errorResponse('Question is required', 'INVALID_INPUT', 400);
	}

	const { error } = await fluxbase.from('query_feedback').insert({
		user_id: userId,
		question: body.question,
		generated_sql: body.generated_sql,
		was_helpful: body.was_helpful,
		feedback_type: body.feedback_type,
		feedback_text: body.feedback_text
	});

	if (error) {
		console.error('Failed to save feedback:', error);
		return errorResponse('Failed to save feedback', 'INTERNAL_ERROR', 500);
	}

	return new Response(
		JSON.stringify({ success: true, message: 'Thank you for your feedback!' }),
		{ status: 200, headers: { 'Content-Type': 'application/json' } }
	);
}

async function handleExamples(): Promise<Response> {
	return new Response(JSON.stringify({ examples: QUERY_EXAMPLES }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' }
	});
}

async function handleHistory(req: Request, fluxbase: ReturnType<typeof createClient>, userId: string): Promise<Response> {
	const url = new URL(req.url);
	const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
	const offset = parseInt(url.searchParams.get('offset') || '0');
	const favoritesOnly = url.searchParams.get('favorites') === 'true';

	let query = fluxbase
		.from('query_history')
		.select('*')
		.eq('user_id', userId)
		.order('created_at', { ascending: false })
		.range(offset, offset + limit - 1);

	if (favoritesOnly) {
		query = query.eq('is_favorite', true);
	}

	const { data, error, count } = await query;

	if (error) {
		console.error('Failed to fetch history:', error);
		return errorResponse('Failed to fetch history', 'INTERNAL_ERROR', 500);
	}

	return new Response(
		JSON.stringify({
			history: data || [],
			total: count,
			limit,
			offset
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } }
	);
}

async function handleToggleFavorite(req: Request, fluxbase: ReturnType<typeof createClient>, userId: string): Promise<Response> {
	const body = await req.json();
	const { history_id, is_favorite } = body;

	if (!history_id) {
		return errorResponse('history_id is required', 'INVALID_INPUT', 400);
	}

	const { error } = await fluxbase
		.from('query_history')
		.update({ is_favorite: is_favorite ?? true })
		.eq('id', history_id)
		.eq('user_id', userId);

	if (error) {
		console.error('Failed to update favorite:', error);
		return errorResponse('Failed to update favorite', 'INTERNAL_ERROR', 500);
	}

	return new Response(
		JSON.stringify({ success: true, is_favorite: is_favorite ?? true }),
		{ status: 200, headers: { 'Content-Type': 'application/json' } }
	);
}

async function handleDeleteHistory(req: Request, fluxbase: ReturnType<typeof createClient>, userId: string): Promise<Response> {
	const body = await req.json();
	const { history_id, clear_all = false } = body;

	if (clear_all) {
		const { error } = await fluxbase
			.from('query_history')
			.delete()
			.eq('user_id', userId);

		if (error) {
			console.error('Failed to clear history:', error);
			return errorResponse('Failed to clear history', 'INTERNAL_ERROR', 500);
		}

		return new Response(
			JSON.stringify({ success: true, message: 'History cleared' }),
			{ status: 200, headers: { 'Content-Type': 'application/json' } }
		);
	}

	if (!history_id) {
		return errorResponse('history_id is required', 'INVALID_INPUT', 400);
	}

	const { error } = await fluxbase
		.from('query_history')
		.delete()
		.eq('id', history_id)
		.eq('user_id', userId);

	if (error) {
		console.error('Failed to delete history entry:', error);
		return errorResponse('Failed to delete history entry', 'INTERNAL_ERROR', 500);
	}

	return new Response(
		JSON.stringify({ success: true }),
		{ status: 200, headers: { 'Content-Type': 'application/json' } }
	);
}

async function handleSuggestions(fluxbase: ReturnType<typeof createClient>, userId: string): Promise<Response> {
	const { data, error } = await fluxbase.rpc('get_personalized_suggestions', {
		p_user_id: userId
	});

	if (error) {
		console.error('Failed to get suggestions:', error);
		// Return default examples on error
		return new Response(
			JSON.stringify({
				suggestions: QUERY_EXAMPLES.map(e => ({
					question: e.question,
					description: e.description,
					category: 'example'
				})),
				stats: null
			}),
			{ status: 200, headers: { 'Content-Type': 'application/json' } }
		);
	}

	// Merge personalized suggestions with static examples
	const personalized = data?.suggestions || [];
	const staticExamples = QUERY_EXAMPLES.slice(0, Math.max(0, 6 - personalized.length)).map(e => ({
		question: e.question,
		description: e.description,
		category: 'example'
	}));

	return new Response(
		JSON.stringify({
			suggestions: [...personalized, ...staticExamples],
			stats: data?.stats || null
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } }
	);
}

async function handleVisitConfirmation(req: Request, fluxbase: ReturnType<typeof createClient>, userId: string): Promise<Response> {
	const body = await req.json();
	const { visit_id, action, corrected_poi } = body;

	if (!visit_id || !action) {
		return errorResponse('visit_id and action are required', 'INVALID_INPUT', 400);
	}

	if (!['confirm', 'reject', 'correct'].includes(action)) {
		return errorResponse('action must be confirm, reject, or correct', 'INVALID_INPUT', 400);
	}

	const { data, error } = await fluxbase.rpc('update_visit_confirmation', {
		p_visit_id: visit_id,
		p_action: action,
		p_corrected_poi: corrected_poi || null
	});

	if (error) {
		console.error('Failed to update visit:', error);
		return errorResponse('Failed to update visit', 'INTERNAL_ERROR', 500);
	}

	return new Response(JSON.stringify(data), {
		status: 200,
		headers: { 'Content-Type': 'application/json' }
	});
}

// =============================================================================
// Helpers
// =============================================================================

async function getAIConfig(
	fluxbase: ReturnType<typeof createClient>,
	userId: string
): Promise<{ provider: string; model: string; api_key: string; api_endpoint?: string } | null> {
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
			api_key: serverConfig.api_key_encrypted || '',
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
		return null;
	}

	return aiConfig;
}

function errorResponse(messageKey: string, code: string, status: number): Response {
	const errorInfo = ERROR_MESSAGES[messageKey] || {
		title: messageKey,
		suggestion: 'Please try again.'
	};

	return new Response(
		JSON.stringify({
			error: errorInfo.title,
			errorCode: code,
			errorSuggestion: errorInfo.suggestion
		}),
		{ status, headers: { 'Content-Type': 'application/json' } }
	);
}

// =============================================================================
// Main Handler
// =============================================================================

async function handler(req: Request): Promise<Response> {
	try {
		// Get user from request (set by Fluxbase auth middleware)
		const userId = (req as unknown as { user?: { id?: string } }).user?.id;
		if (!userId) {
			return errorResponse('UNAUTHORIZED', 'UNAUTHORIZED', 401);
		}

		// Get Fluxbase client
		const fluxbaseUrl = Deno.env.get('FLUXBASE_BASE_URL') ?? '';
		const fluxbaseKey = Deno.env.get('FLUXBASE_SERVICE_ROLE_KEY') ?? '';
		const fluxbase = createClient(fluxbaseUrl, fluxbaseKey);

		// Route based on method and path
		const url = new URL(req.url);
		const pathParts = url.pathname.split('/').filter(Boolean);
		const path = pathParts[pathParts.length - 1];

		// GET endpoints
		if (req.method === 'GET') {
			switch (path) {
				case 'examples':
					return handleExamples();
				case 'history':
					return handleHistory(req, fluxbase, userId);
				case 'suggestions':
					return handleSuggestions(fluxbase, userId);
				default:
					break;
			}
		}

		// POST endpoints
		if (req.method === 'POST') {
			switch (path) {
				case 'feedback':
					return handleFeedback(req, fluxbase, userId);
				case 'favorite':
					return handleToggleFavorite(req, fluxbase, userId);
				case 'visit':
					return handleVisitConfirmation(req, fluxbase, userId);
				default:
					// Default POST is the query endpoint
					return handleQuery(req, fluxbase, userId);
			}
		}

		// DELETE endpoints
		if (req.method === 'DELETE' && path === 'history') {
			return handleDeleteHistory(req, fluxbase, userId);
		}

		return new Response(JSON.stringify({ error: 'Method not allowed' }), {
			status: 405,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (error) {
		console.error('Location query error:', error);
		return errorResponse('INTERNAL_ERROR', 'INTERNAL_ERROR', 500);
	}
}

export { handler };

/**
 * Types for AI/LLM provider configuration and usage
 */

/**
 * Supported LLM providers
 */
export const AI_PROVIDERS = [
	'openai',
	'anthropic',
	'ollama',
	'openrouter',
	'azure',
	'custom'
] as const;

export type AIProvider = (typeof AI_PROVIDERS)[number];

/**
 * Server-level AI configuration (stored in ai_config table)
 */
export interface AIConfig {
	id: string;
	name: string; // Config name: 'default', 'location_query', etc.
	provider: AIProvider;
	model: string;
	api_endpoint?: string; // Custom endpoint for Ollama, OpenRouter, etc.
	api_key_encrypted?: string; // Server-level API key (encrypted)
	max_tokens?: number;
	temperature?: number;
	enabled: boolean;
	config?: Record<string, unknown>; // Provider-specific config
	created_at?: string;
	updated_at?: string;
}

/**
 * User-level AI configuration override (stored in user_preferences.ai_config)
 */
export interface UserAIConfig {
	provider?: AIProvider;
	model?: string;
	api_key?: string; // User's own API key
	api_endpoint?: string; // Custom endpoint override
	enabled?: boolean;
	max_tokens?: number;
	temperature?: number;
}

/**
 * Merged AI configuration (server defaults + user overrides)
 */
export interface MergedAIConfig {
	provider: AIProvider;
	model: string;
	api_key?: string;
	api_endpoint?: string;
	max_tokens: number;
	temperature: number;
	enabled: boolean;
	system_prompt?: string;
	config?: Record<string, unknown>;
}

/**
 * Chat message format (OpenAI-compatible)
 */
export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

/**
 * Request to LLM provider
 */
export interface LLMRequest {
	messages: ChatMessage[];
	max_tokens?: number;
	temperature?: number;
	stop?: string[];
	stream?: boolean;
}

/**
 * Response from LLM provider
 */
export interface LLMResponse {
	content: string;
	model: string;
	provider: AIProvider;
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
	finish_reason?: 'stop' | 'length' | 'content_filter' | 'tool_calls';
}

/**
 * Error from LLM provider
 */
export interface LLMError {
	provider: AIProvider;
	code: string;
	message: string;
	retryable: boolean;
}

/**
 * Schema information for the geocode column (for LLM context)
 */
export const GEOCODE_SCHEMA_DESCRIPTION = `
The geocode column is a JSONB field containing a GeoJSON Feature with the following structure:

{
  "type": "Feature",
  "geometry": {
    "type": "Point",
    "coordinates": [longitude, latitude]
  },
  "properties": {
    "display_name": "Full address string",
    "label": "Short label",
    "city": "City name",
    "country": "Country name",
    "locality": "Locality/city from Pelias",
    "region": "State/province",
    "neighbourhood": "Neighbourhood name",
    "borough": "Borough name",
    "layer": "Pelias layer: venue, address, street, etc.",
    "category": ["array", "of", "categories"],
    "confidence": 0.8,
    "address": {
      "city": "City",
      "state": "State",
      "country": "Country",
      "country_code": "us",
      "road": "Street name",
      "house_number": "123",
      "postcode": "12345"
    },
    "addendum": {
      "osm": {
        "amenity": "restaurant",
        "cuisine": "vietnamese",
        "opening_hours": "10:00-22:00",
        "phone": "+1234567890",
        "website": "https://example.com",
        "wheelchair": "yes",
        "diet:vegan": "yes",
        "diet:vegetarian": "yes"
      }
    },
    "nearby_pois": [
      {
        "name": "POI Name",
        "layer": "venue",
        "distance_meters": 15.5,
        "category": ["food", "restaurant"],
        "osm_id": "node/123456",
        "confidence": 0.9,
        "addendum": {
          "osm": { ... }
        }
      }
    ],
    "geocoded_at": "2025-01-15T10:30:00Z",
    "geocoding_provider": "pelias"
  }
}

Key fields for querying:
- geocode->'properties'->>'city' - City name
- geocode->'properties'->>'country' - Country name
- geocode->'properties'->'address'->>'country_code' - 2-letter country code
- geocode->'properties'->>'layer' - 'venue' for POIs, 'address' for addresses
- geocode->'properties'->'addendum'->'osm'->>'amenity' - OSM amenity type
- geocode->'properties'->'addendum'->'osm'->>'cuisine' - Cuisine type
- geocode->'properties'->'nearby_pois' - Array of nearby venues
`;

/**
 * Schema information for the place_visits table (for LLM context)
 */
export const PLACE_VISITS_SCHEMA_DESCRIPTION = `
The place_visits table stores detected POI/venue visits with the following columns:

- id: UUID primary key
- user_id: UUID of the user
- started_at: TIMESTAMPTZ when the visit started
- ended_at: TIMESTAMPTZ when the visit ended
- duration_minutes: INTEGER (generated) duration in minutes
- location: GEOMETRY(Point, 4326) PostGIS point
- poi_name: TEXT name of the place visited
- poi_layer: TEXT 'venue' or 'address'
- poi_amenity: TEXT OSM amenity type (restaurant, cafe, museum, etc.)
- poi_cuisine: TEXT cuisine type if applicable (vietnamese, italian, vegan)
- poi_category: TEXT high-level category (food, entertainment, culture, shopping, wellness, accommodation)
- poi_tags: JSONB full OSM tags for complex queries
- city: TEXT city name
- country: TEXT country name
- country_code: VARCHAR(2) ISO 2-letter country code
- confidence_score: NUMERIC(3,2) 0.00-1.00 match confidence
- gps_points_count: INTEGER GPS points in the visit cluster
- avg_accuracy_meters: NUMERIC average GPS accuracy
- detection_method: TEXT 'time_cluster' or 'user_confirmed'
- candidates: JSONB alternative POI matches if ambiguous
- created_at: TIMESTAMPTZ
- updated_at: TIMESTAMPTZ

Common query patterns:
- Restaurants in a country: WHERE poi_amenity = 'restaurant' AND country_code = 'vn'
- Vegan places: WHERE poi_tags->>'diet:vegan' = 'yes' OR poi_cuisine ILIKE '%vegan%'
- Visits in a month: WHERE started_at >= '2024-05-01' AND started_at < '2024-06-01'
- Long visits: WHERE duration_minutes > 60
- High confidence: WHERE confidence_score >= 0.8
`;

/**
 * Combined schema for location queries
 */
export const LOCATION_QUERY_SCHEMA = `
You have access to two main data sources for answering location questions:

1. tracker_data table - Raw GPS points with geocoding
   - user_id, recorded_at, location (PostGIS Point)
   - geocode (JSONB) - see structure below
   - country_code, accuracy, speed, activity_type

2. place_visits table - Detected venue/POI visits
   - Optimized for questions like "which restaurant did I visit"
   - Has denormalized columns for easy filtering

${GEOCODE_SCHEMA_DESCRIPTION}

${PLACE_VISITS_SCHEMA_DESCRIPTION}

When generating SQL:
- Use place_visits for questions about specific venues visited
- Use tracker_data for questions about general location history
- Always include user_id = $1 in WHERE clause
- Use appropriate date range filters
- For text search, use ILIKE for case-insensitive matching
`;

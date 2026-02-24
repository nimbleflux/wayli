/**
 * Sync POI data to knowledge base
 *
 * Updates the "wayli-pois" knowledge base with POI data from my_poi_summary.
 * Creates rich documents with behavioral context for semantic search.
 * Uses user-scoped RAG: documents include user_id in metadata for automatic filtering.
 *
 * This job can be triggered:
 * - Manually via API call
 * - After place visits detection completes (via job chaining from detect-place-visits.ts)
 * - On a schedule via scheduled-sync-poi-to-kb.ts
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 1800
 * @fluxbase:allow-net true
 * @fluxbase:allow-env true
 */

import type {
	FluxbaseClient,
	JobUtils,
	KnowledgeBase,
	CreateKnowledgeBaseRequest,
	AddDocumentRequest,
	DeleteDocumentsByFilterRequest
} from './types';

interface SyncPoiToKbPayload {
	/** Force refresh all documents, even unchanged ones */
	force_refresh?: boolean;
	/** Maximum number of POIs to process (for testing) */
	limit?: number;
}

interface OsmAmenities {
	outdoor_seating: boolean;
	wifi: boolean;
	wheelchair: boolean;
	takeaway: boolean;
	delivery: boolean;
	smoking: boolean;
	air_conditioning: boolean;
}

interface TimePattern {
	morning: number;
	afternoon: number;
	evening: number;
	night: number;
}

interface DayPattern {
	weekend_visits: number;
	weekday_visits: number;
}

interface PoiSummary {
	poi_name: string;
	poi_amenity: string | null;
	poi_category: string | null;
	poi_cuisine?: string | null;
	poi_sport?: string | null;
	city: string | null;
	country_code: string | null;
	visit_count: number;
	avg_duration_minutes: number | null;
	osm_amenities?: OsmAmenities | null;
	time_pattern?: TimePattern | null;
	day_pattern?: DayPattern | null;
}

const KB_NAME = 'wayli-pois';
const KB_NAMESPACE = 'wayli';
const BATCH_SIZE = 20;

// Safe wrapper for reportProgress
function safeReportProgress(job: JobUtils, percent: number, message: string): void {
	if (typeof (job as any)?.reportProgress === 'function') {
		try {
			job.reportProgress(percent, message);
		} catch (e) {
			console.log(`[Progress ${percent}%] ${message}`);
		}
	} else {
		console.log(`[Progress ${percent}%] ${message}`);
	}
}

/**
 * Build rich semantic document text from POI data
 * Encodes behavioral insights in natural language for semantic search
 */
function buildPoiDocumentText(poi: PoiSummary): string {
	const parts: string[] = [];

	// Natural language name + type
	if (poi.poi_name && poi.poi_amenity) {
		parts.push(`${poi.poi_name} is a ${poi.poi_amenity}`);
	} else if (poi.poi_name) {
		parts.push(poi.poi_name);
	}

	// Location context
	if (poi.city && poi.country_code) {
		parts.push(`located in ${poi.city}, ${poi.country_code}`);
	} else if (poi.city) {
		parts.push(`in ${poi.city}`);
	} else if (poi.country_code) {
		parts.push(`in ${poi.country_code}`);
	}

	// Category and cuisine as descriptive text
	if (poi.poi_cuisine) {
		parts.push(`specializing in ${poi.poi_cuisine} cuisine`);
	}
	if (poi.poi_sport) {
		parts.push(`for ${poi.poi_sport}`);
	}

	// OSM amenity descriptors (enables "wifi cafe", "outdoor seating" queries)
	if (poi.osm_amenities) {
		const amenities: string[] = [];
		if (poi.osm_amenities.outdoor_seating) amenities.push('outdoor seating');
		if (poi.osm_amenities.wifi) amenities.push('free wifi');
		if (poi.osm_amenities.wheelchair) amenities.push('wheelchair accessible');
		if (poi.osm_amenities.takeaway) amenities.push('takeaway available');
		if (poi.osm_amenities.delivery) amenities.push('delivery service');
		if (poi.osm_amenities.air_conditioning) amenities.push('air conditioned');
		if (amenities.length > 0) {
			parts.push(`with ${amenities.join(', ')}`);
		}
	}

	// Time-of-day pattern (enables "morning cafe", "late night spot" queries)
	if (poi.time_pattern) {
		const { morning, afternoon, evening, night } = poi.time_pattern;
		const total = morning + afternoon + evening + night;
		if (total > 0) {
			const morningPct = morning / total;
			const eveningPct = evening / total;
			const nightPct = night / total;
			const afternoonPct = afternoon / total;

			if (morningPct > 0.5) {
				parts.push('popular for morning visits');
			} else if (eveningPct > 0.5) {
				parts.push('popular in the evening');
			} else if (nightPct > 0.3) {
				parts.push('late night spot');
			} else if (morningPct > 0.3 && afternoonPct > 0.3) {
				parts.push('daytime favorite');
			}
		}
	}

	// Weekend preference (enables "weekend brunch", "weekday lunch" queries)
	if (poi.day_pattern) {
		const { weekend_visits, weekday_visits } = poi.day_pattern;
		const total = weekend_visits + weekday_visits;
		if (total >= 3) {
			const weekendPct = weekend_visits / total;
			if (weekendPct > 0.7) {
				parts.push('weekend favorite');
			} else if (weekendPct < 0.3) {
				parts.push('weekday spot');
			}
		}
	}

	// Infer vibe from visit duration + category (enables "cozy", "quick bite" queries)
	if (poi.avg_duration_minutes && poi.poi_category === 'food') {
		if (poi.avg_duration_minutes > 90) {
			parts.push('great for leisurely dining');
		} else if (poi.avg_duration_minutes > 60) {
			parts.push('relaxed atmosphere');
		} else if (poi.avg_duration_minutes < 20) {
			parts.push('quick service');
		}
	} else if (poi.avg_duration_minutes) {
		// Non-food categories
		if (poi.avg_duration_minutes > 90) {
			parts.push('with leisurely extended visits');
		} else if (poi.avg_duration_minutes > 45) {
			parts.push('with moderate length visits');
		} else {
			parts.push('for quick stops');
		}
	}

	// Visit frequency context (semantic signal for recommendations)
	if (poi.visit_count >= 10) {
		parts.push('This is a frequently visited favorite location');
	} else if (poi.visit_count >= 5) {
		parts.push('This is a regular spot');
	} else if (poi.visit_count >= 2) {
		parts.push('Visited occasionally');
	} else {
		parts.push('Visited once');
	}

	return parts.join(' ') + '.';
}

/**
 * Get or create the knowledge base for POIs using Admin SDK
 */
async function getOrCreateKnowledgeBase(
	fluxbaseService: FluxbaseClient
): Promise<{ data: KnowledgeBase | null; error: Error | null }> {
	try {
		// List existing KBs to find ours
		const { data: kbList, error: listError } = await fluxbaseService.admin.ai.listKnowledgeBases(KB_NAMESPACE);

		if (!listError && kbList) {
			const existingKb = kbList.find((kb) => kb.name === KB_NAME);
			if (existingKb) {
				console.log(`Found existing knowledge base: ${existingKb.id}`);
				return { data: existingKb, error: null };
			}
		}
	} catch (e) {
		console.log('Could not list knowledge bases, creating new one');
	}

	// Create new knowledge base
	const createRequest: CreateKnowledgeBaseRequest = {
		name: KB_NAME,
		namespace: KB_NAMESPACE,
		description: 'User POI visits with behavioral context for semantic search',
		chunk_size: 500,
		chunk_overlap: 50,
		chunk_strategy: 'recursive',
		embedding_model: 'text-embedding-3-small',
		embedding_dimensions: 1536
	};

	const { data: kb, error: createError } = await fluxbaseService.admin.ai.createKnowledgeBase(createRequest);

	if (createError) {
		return { data: null, error: createError };
	}

	console.log(`Created knowledge base: ${kb!.id}`);
	return { data: kb, error: null };
}

/**
 * Delete all existing documents for a user before re-sync
 * This ensures clean upsert - stale POIs are removed
 */
async function deleteUserDocuments(
	fluxbaseService: FluxbaseClient,
	knowledgeBaseId: string,
	userId: string
): Promise<{ deletedCount: number; error: Error | null }> {
	const filter: DeleteDocumentsByFilterRequest = {
		metadata: { user_id: userId }
	};

	const { data, error } = await fluxbaseService.admin.ai.deleteDocumentsByFilter(knowledgeBaseId, filter);

	if (error) {
		return { deletedCount: 0, error };
	}

	const deletedCount = data?.deleted_count || 0;
	console.log(`Deleted ${deletedCount} existing documents for user ${userId}`);
	return { deletedCount, error: null };
}

/**
 * Add a document to the knowledge base using Admin SDK
 */
async function addDocument(
	fluxbaseService: FluxbaseClient,
	knowledgeBaseId: string,
	title: string,
	content: string,
	metadata: Record<string, string>
): Promise<{ success: boolean; error: Error | null }> {
	const request: AddDocumentRequest = {
		title,
		content,
		metadata
	};

	const { error } = await fluxbaseService.admin.ai.addDocument(knowledgeBaseId, request);

	if (error) {
		return { success: false, error };
	}

	return { success: true, error: null };
}

export async function handler(
	_req: Request,
	fluxbase: FluxbaseClient,
	fluxbaseService: FluxbaseClient,
	job: JobUtils
) {
	const context = job.getJobContext();
	const payload = context.payload as SyncPoiToKbPayload;
	const userId = context.user?.id;

	if (!userId) {
		return {
			success: false,
			error: 'No user context available. Submit job with onBehalfOf option or as authenticated user.'
		};
	}

	const maxLimit = payload?.limit;

	safeReportProgress(job, 5, 'Initializing knowledge base...');

	// 1. Get or create the knowledge base
	const { data: kb, error: kbError } = await getOrCreateKnowledgeBase(fluxbaseService);

	if (kbError || !kb) {
		console.error('Failed to get/create knowledge base:', kbError);
		return {
			success: false,
			error: kbError?.message || 'Failed to create knowledge base'
		};
	}

	safeReportProgress(job, 10, 'Fetching POIs from visit history...');

	// 2. Fetch POIs from my_poi_summary
	let poiQuery = fluxbase
		.from('my_poi_summary')
		.select('*')
		.not('poi_name', 'is', null);

	if (maxLimit) {
		poiQuery = poiQuery.limit(maxLimit);
	}

	const { data: pois, error: poisError } = await poiQuery;

	if (poisError) {
		console.error('Failed to fetch POIs:', poisError);
		return {
			success: false,
			error: `Failed to fetch POIs: ${poisError.message}`
		};
	}

	if (!pois || pois.length === 0) {
		safeReportProgress(job, 100, 'No POIs found to sync');
		return {
			success: true,
			result: { processed: 0, errors: 0, deleted: 0, kb_id: kb.id }
		};
	}

	console.log(`📊 Found ${pois.length} POIs to sync to knowledge base`);

	// 3. Delete existing documents for this user (clean upsert)
	safeReportProgress(job, 12, 'Removing stale documents...');
	const { deletedCount, error: deleteError } = await deleteUserDocuments(fluxbaseService, kb.id, userId);

	if (deleteError) {
		console.warn(`⚠️ Failed to delete existing documents:`, deleteError);
		// Continue anyway - old documents will be supplemented
	}

	safeReportProgress(job, 15, `Processing ${pois.length} POIs...`);

	// 4. Process POIs in batches
	let processed = 0;
	let errors = 0;

	for (let i = 0; i < pois.length; i += BATCH_SIZE) {
		// Check for cancellation
		const cancelled = await job.isCancelled();
		if (cancelled) {
			safeReportProgress(job, 0, 'Job cancelled');
			return {
				success: false,
				error: 'Job cancelled',
				result: { processed, errors, deleted: deletedCount, kb_id: kb.id }
			};
		}

		const batch = pois.slice(i, i + BATCH_SIZE);

		for (const poi of batch as PoiSummary[]) {
			const title = `${poi.poi_name} - ${poi.city || 'Unknown Location'}`;
			const content = buildPoiDocumentText(poi);

			// Include user_id in metadata for user-scoped RAG retrieval
			const metadata: Record<string, string> = {
				user_id: userId, // Enables automatic user-scoped filtering in RAG
				category: poi.poi_category || '',
				city: poi.city || '',
				country_code: poi.country_code || ''
			};

			// Add optional metadata
			if (poi.poi_cuisine) metadata.cuisine = poi.poi_cuisine;
			if (poi.poi_amenity) metadata.amenity = poi.poi_amenity;
			if (poi.poi_sport) metadata.sport = poi.poi_sport;

			const { success, error } = await addDocument(fluxbaseService, kb.id, title, content, metadata);

			if (!success) {
				console.error(`Failed to add document for ${poi.poi_name}:`, error);
				errors++;
			} else {
				processed++;
			}
		}

		// Update progress
		const progress = Math.min(95, 15 + Math.round(((processed + errors) / pois.length) * 80));
		safeReportProgress(
			job,
			progress,
			`Processed ${processed + errors}/${pois.length} POIs (${processed} synced, ${errors} errors)`
		);
	}

	safeReportProgress(
		job,
		100,
		`Completed: ${processed} POIs synced to knowledge base, ${errors} errors`
	);

	console.log(`✅ POI to KB sync complete: ${processed} synced, ${errors} errors, ${deletedCount} deleted`);

	return {
		success: errors === 0,
		result: {
			processed,
			errors,
			deleted: deletedCount,
			kb_id: kb.id,
			kb_name: kb.name
		}
	};
}

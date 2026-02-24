/**
 * Export KB Tables
 *
 * Exports database table schemas to knowledge base for AI understanding.
 * Attempts export and handles errors gracefully if embedding provider isn't configured.
 *
 * Triggered:
 * - On init (via startup.sh)
 * - When AI settings are saved
 *
 * @fluxbase:allow-unauthenticated
 * @fluxbase:allow-net true
 */
import type { FluxbaseClient } from '../jobs/types';

interface ExportResult {
	success: boolean;
	message: string;
	tables_exported: number;
	skipped_reason?: string;
	errors: string[];
}

function successResponse<T>(data: T, status = 200): Response {
	return new Response(JSON.stringify({ success: true, data }), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

function errorResponse(message: string, errors: string[] = [], status = 500): Response {
	return new Response(
		JSON.stringify({
			success: false,
			message,
			errors
		} as ExportResult),
		{
			status,
			headers: { 'Content-Type': 'application/json' }
		}
	);
}

export async function handler(
	_req: Request,
	_fluxbase: FluxbaseClient,
	fluxbaseService: FluxbaseClient
): Promise<Response> {
	try {
		// Get or create the wayli-pois KB
		const { data: existingKBs, error: listError } = await fluxbaseService.admin.ai.listKnowledgeBases('wayli');

		if (listError) {
			return errorResponse(`Failed to list knowledge bases: ${listError.message}`);
		}

		let kbId = existingKBs?.find((kb: { name: string }) => kb.name === 'wayli-pois')?.id;

		if (!kbId) {
			const { data: newKB, error: createError } = await fluxbaseService.admin.ai.createKnowledgeBase({
				name: 'wayli-pois',
				namespace: 'wayli',
				description: 'User POI visits with behavioral context for semantic search',
				chunk_size: 500,
				embedding_model: 'text-embedding-3-small',
				embedding_dimensions: 1536
			});

			if (createError) {
				return errorResponse(`Failed to create KB: ${createError.message}`);
			}
			kbId = newKB?.id;
		}

		if (!kbId) {
			return errorResponse('Could not get or create knowledge base');
		}

		// Export tables using the table export functionality
		// Note: This is idempotent - we check if documents exist before adding
		const tablesToExport = ['place_visits', 'user_preferences'];

		// First, list existing documents to avoid duplicates
		// Use the endpoint that returns documents for a knowledge base
		const { data: docsResponse } = await fluxbaseService
			.from('ai.documents')
			.select('*')
			.eq('knowledge_base_id', kbId);

		const existingTableDocs = new Set(
			docsResponse
				?.filter((doc: { metadata?: { type?: string; table?: string } }) =>
					doc.metadata?.type === 'table_schema_reference' && doc.metadata?.table
				)
				.map((doc: { metadata?: { table?: string } }) => doc.metadata?.table) || []
		);

		// Only export tables that don't already have placeholder documents
		const tablesToProcess = tablesToExport.filter((table) => !existingTableDocs.has(table));

		const results = await Promise.allSettled(
			tablesToProcess.map((tableName) =>
				fluxbaseService.admin.ai.addDocument(kbId, {
					title: `Table Schema: ${tableName}`,
					content: `Table schema: ${tableName}\n\nThis table should be exported using the exportTable API.`,
					metadata: {
						type: 'table_schema_reference',
						table: tableName,
						schema: 'public'
					}
				})
			)
		);

		const errors: string[] = [];
		let exportedCount = 0;

		results.forEach((result, i) => {
			const tableName = tablesToProcess[i];
			if (result.status === 'fulfilled' && result.value.data) {
				exportedCount++;
			} else {
				const error =
					result.status === 'rejected'
						? result.reason
						: (result.value.error as Error);
				if (error?.message.includes('embedding') || error?.message.includes('model')) {
					// Embedding provider not configured
					errors.push(`${tableName}: Embedding provider not configured`);
				} else {
					errors.push(`${tableName}: ${error?.message || 'Unknown error'}`);
				}
			}
		});

		if (errors.length > 0 && errors.every((e) => e.includes('Embedding provider'))) {
			return successResponse({
				success: false,
				message: 'No embedding provider configured - tables not exported',
				tables_exported: 0,
				skipped_reason: 'no_embedding_provider',
				errors
			} as ExportResult);
		}

		return successResponse({
			success: errors.length === 0,
			message: `Processed ${exportedCount} table(s)`,
			tables_exported: exportedCount,
			errors
		} as ExportResult);
	} catch (error) {
		return errorResponse((error as Error).message, [(error as Error).message]);
	}
}

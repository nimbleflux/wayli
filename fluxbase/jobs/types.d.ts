/**
 * Type definitions for Fluxbase Jobs runtime
 *
 * These types describe the handler function parameters that will be provided
 * when job handlers run on the Fluxbase Jobs platform.
 */

/**
 * Fluxbase client for database, storage, and jobs operations
 * Two instances are provided: one with RLS (user context) and one with service role
 */
interface FluxbaseClient {
	/**
	 * Admin API for privileged operations (requires service_role)
	 */
	admin: {
		settings: {
			app: {
				/**
				 * Get the decrypted value of a user's secret setting
				 * @param userId - The user ID whose secret to retrieve
				 * @param key - Secret key
				 * @returns Promise resolving to the decrypted secret value
				 */
				getUserSecretValue(userId: string, key: string): Promise<string>;
			};
		};
		/**
		 * Admin AI operations for chatbots and knowledge bases
		 */
		ai: {
			/**
			 * List knowledge bases in a namespace
			 */
			listKnowledgeBases(namespace?: string): Promise<{
				data: KnowledgeBase[] | null;
				error: Error | null;
			}>;

			/**
			 * Create a knowledge base
			 */
			createKnowledgeBase(request: CreateKnowledgeBaseRequest): Promise<{
				data: KnowledgeBase | null;
				error: Error | null;
			}>;

			/**
			 * Add a document to a knowledge base
			 */
			addDocument(knowledgeBaseId: string, request: AddDocumentRequest): Promise<{
				data: { document_id: string } | null;
				error: Error | null;
			}>;

			/**
			 * Delete documents from a knowledge base by filter
			 */
			deleteDocumentsByFilter(
				knowledgeBaseId: string,
				filter: DeleteDocumentsByFilterRequest
			): Promise<{
				data: { deleted_count: number } | null;
				error: Error | null;
			}>;
		};
	};

	/**
	 * Storage API for file operations
	 */
	storage: {
		from(bucket: string): {
			download(path: string): Promise<{ data: Blob | null; error: Error | null }>;
			upload(
				path: string,
				file: File | Blob | Buffer,
				options?: { contentType?: string; upsert?: boolean }
			): Promise<{ data: any; error: Error | null }>;
			uploadStream(
				path: string,
				stream: ReadableStream<Uint8Array>,
				size: number,
				options?: { contentType?: string; upsert?: boolean }
			): Promise<{ data: any; error: Error | null }>;
			remove(paths: string[]): Promise<{ data: any; error: Error | null }>;
			list(
				path?: string,
				options?: { limit?: number; offset?: number; sortBy?: { column: string; order: string } }
			): Promise<{
				data: Array<{
					name: string;
					id?: string;
					updated_at?: string;
					created_at?: string;
					metadata?: any;
				}> | null;
				error: Error | null;
			}>;
		};
	};

	/**
	 * Query a database table
	 * @param table - Table name
	 */
	from<T = any>(table: string): QueryBuilder<T>;

	/**
	 * Call a PostgreSQL function (RPC)
	 * @param fn - Function name
	 * @param params - Function parameters
	 */
	rpc<T = any>(
		fn: string,
		params?: Record<string, unknown>
	): Promise<{ data: T | null; error: Error | null }>;

	/**
	 * Jobs API for submitting and querying jobs
	 */
	jobs: JobsClient;

	/**
	 * Vector API for embeddings and vector operations
	 */
	vector: VectorClient;
}

/**
 * Vector client for embedding generation and vector operations
 */
interface VectorClient {
	/**
	 * Generate embeddings for one or more texts
	 * @param options - Embedding options
	 * @returns Embedding vectors
	 */
	embed(options: {
		/** Array of texts to embed */
		texts: string[];
		/** Model to use (default: text-embedding-3-small) */
		model?: string;
	}): Promise<{
		data: {
			embeddings: number[][];
			model: string;
			dimensions: number;
			usage: { prompt_tokens: number; total_tokens: number };
		} | null;
		error: Error | null;
	}>;
}

/**
 * Job utilities for progress reporting, context, and cancellation
 */
interface JobUtils {
	/**
	 * Get the current job execution context
	 * Provides information about the job, user, and execution environment
	 */
	getJobContext(): JobContext;

	/**
	 * Report job progress
	 * Sends progress updates to the Fluxbase platform which are broadcast
	 * to clients via Realtime WebSocket connections
	 *
	 * @param percent - Progress percentage (0-100)
	 * @param message - Human-readable progress message
	 */
	reportProgress(percent: number, message: string): void;

	/**
	 * Check if the current job has been cancelled
	 * Jobs should periodically check this and exit gracefully if cancelled
	 */
	isCancelled(): Promise<boolean>;
}

/**
 * Query builder for database operations
 */
interface QueryBuilder<T = any> {
	select(
		columns?: string,
		options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }
	): QueryBuilder<T>;
	insert(data: Partial<T> | Partial<T>[]): QueryBuilder<T>;
	update(data: Partial<T>): QueryBuilder<T>;
	upsert(
		data: Partial<T> | Partial<T>[],
		options?: { onConflict?: string; ignoreDuplicates?: boolean }
	): QueryBuilder<T>;
	delete(): QueryBuilder<T>;

	eq(column: string, value: unknown): QueryBuilder<T>;
	neq(column: string, value: unknown): QueryBuilder<T>;
	gt(column: string, value: unknown): QueryBuilder<T>;
	gte(column: string, value: unknown): QueryBuilder<T>;
	lt(column: string, value: unknown): QueryBuilder<T>;
	lte(column: string, value: unknown): QueryBuilder<T>;
	like(column: string, pattern: string): QueryBuilder<T>;
	ilike(column: string, pattern: string): QueryBuilder<T>;
	is(column: string, value: unknown): QueryBuilder<T>;
	in(column: string, values: unknown[]): QueryBuilder<T>;
	not(column: string, operator: string, value: unknown): QueryBuilder<T>;
	or(filters: string): QueryBuilder<T>;
	filter(column: string, operator: string, value: unknown): QueryBuilder<T>;

	order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): QueryBuilder<T>;
	limit(count: number): QueryBuilder<T>;
	range(from: number, to: number): QueryBuilder<T>;
	single(): QueryBuilder<T>;
	maybeSingle(): QueryBuilder<T>;

	then<
		TResult1 = { data: T[] | T | null; error: Error | null; count?: number | null },
		TResult2 = never
	>(
		onfulfilled?:
			| ((value: {
					data: T[] | T | null;
					error: Error | null;
					count?: number | null;
			  }) => TResult1 | PromiseLike<TResult1>)
			| null,
		onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
	): Promise<TResult1 | TResult2>;
}

/**
 * User context for submitting jobs on behalf of another user
 */
interface OnBehalfOfUser {
	/** User UUID */
	user_id: string;
	/** User email address */
	user_email: string;
	/** User role (admin, dashboard_admin, authenticated, anon) */
	user_role: string;
}

/**
 * Jobs client for querying and submitting jobs
 */
interface JobsClient {
	/**
	 * Submit a new job
	 * Creates a new job that will be executed by the job worker
	 *
	 * @param jobName - Name of the job handler to execute
	 * @param payload - Data to pass to the job handler
	 * @param options - Job options (namespace, priority, onBehalfOf)
	 *
	 * @example
	 * // Submit a job with user context from current session
	 * await fluxbase.jobs.submit('data-export', { format: 'csv' });
	 *
	 * @example
	 * // Submit a job on behalf of another user (from scheduled/cron jobs)
	 * await fluxbaseService.jobs.submit('user-task', payload, {
	 *   onBehalfOf: {
	 *     user_id: 'target-user-uuid',
	 *     user_email: 'user@example.com',
	 *     user_role: 'authenticated'
	 *   }
	 * });
	 */
	submit(
		jobName: string,
		payload: Record<string, unknown>,
		options?: {
			namespace?: string;
			priority?: number;
			/**
			 * Submit the job on behalf of another user.
			 * Useful for scheduled/cron jobs that need to create user-specific jobs
			 * without a user session context.
			 *
			 * When provided, the job's user context (accessible via job.getJobContext().user)
			 * will be set to this user instead of the submitting user/service.
			 */
			onBehalfOf?: OnBehalfOfUser;
		}
	): Promise<{ data: { job_id: string; status: string } | null; error: Error | null }>;

	/**
	 * List jobs with optional filtering
	 */
	list(options?: {
		status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
		job_name?: string;
		limit?: number;
		offset?: number;
	}): Promise<{ data: JobRecord[] | null; error: Error | null }>;

	/**
	 * Get a specific job by ID
	 */
	get(jobId: string): Promise<{ data: JobRecord | null; error: Error | null }>;
}

/**
 * Job record from jobs.list() or jobs.get()
 */
interface JobRecord {
	id: string;
	job_name: string;
	namespace: string;
	status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
	payload?: any;
	result?: any;
	error?: string;
	progress_percent?: number;
	progress_message?: string;
	created_at: string;
	started_at?: string;
	completed_at?: string;
	created_by: string;
}

/**
 * Job execution context provided by Fluxbase
 */
interface JobContext {
	/** UUID of the job */
	job_id: string;

	/** Name of the job function (matches filename) */
	job_name: string;

	/** Job namespace (e.g., "wayli") */
	namespace: string;

	/** Current retry attempt (0 for first attempt) */
	retry_count: number;

	/** Job input data/payload */
	payload: any;

	/** User context (null for scheduled/system jobs) */
	user?: {
		/** User UUID */
		id: string;

		/** User email address */
		email: string;

		/** User role (admin, dashboard_admin, authenticated, anon) */
		role: string;
	} | null;
}

/**
 * Knowledge base configuration
 */
interface KnowledgeBase {
	id: string;
	name: string;
	namespace: string;
	description?: string;
	document_count: number;
	chunk_count: number;
	created_at: string;
	updated_at: string;
}

/**
 * Request to create a knowledge base
 */
interface CreateKnowledgeBaseRequest {
	name: string;
	namespace: string;
	description?: string;
	chunk_size?: number;
	chunk_overlap?: number;
	chunk_strategy?: 'recursive' | 'simple' | 'semantic';
	embedding_model?: string;
	embedding_dimensions?: number;
}

/**
 * Request to add a document to a knowledge base
 */
interface AddDocumentRequest {
	title: string;
	content: string;
	tags?: string[];
	metadata?: Record<string, string>;
}

/**
 * Request to delete documents by filter
 */
interface DeleteDocumentsByFilterRequest {
	tags?: string[];
	metadata?: Record<string, string>;
}

export {
	FluxbaseClient,
	JobUtils,
	QueryBuilder,
	JobsClient,
	JobRecord,
	JobContext,
	OnBehalfOfUser,
	KnowledgeBase,
	CreateKnowledgeBaseRequest,
	AddDocumentRequest,
	DeleteDocumentsByFilterRequest
};

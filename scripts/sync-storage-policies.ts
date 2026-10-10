/**
 * Sync storage.objects RLS policies for the private trip-images bucket
 * (signed-media migration, #265 / docs/signed-media-migration.md).
 *
 * Uses the Fluxbase admin policies API (POST/DELETE /api/v1/admin/policies)
 * — pgschema's declarative sync cannot express policies on the platform-owned
 * `storage` schema (verified: its plan shadows the schema, so the referenced
 * tables don't exist). Storage is a protected schema: the caller needs
 * instance-level privileges — the service key satisfies that.
 *
 * Semantics: every managed policy is dropped and recreated (atomic per
 * policy), so a sync always converges to the definitions below.
 *
 * Usage:
 *   FLUXBASE_URL=https://… FLUXBASE_SERVICE_ROLE_KEY=… \
 *     bun run scripts/sync-storage-policies.ts
 */

interface PolicyDef {
	name: string;
	command: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL';
	roles: string[];
	using?: string;
	withCheck?: string;
}

const SCHEMA = 'storage';
const TABLE = 'objects';
const BUCKET = 'trip-images';

const OWNER_PREDICATE =
	"bucket_id = 'trip-images' AND ((storage.foldername(name))[1] = (auth.uid())::text OR owner_id = auth.uid())";

const POLICIES: PolicyDef[] = [
	{ name: 'trip_images_owner_select', command: 'SELECT', roles: ['authenticated'], using: OWNER_PREDICATE },
	{
		name: 'trip_images_owner_insert',
		command: 'INSERT',
		roles: ['authenticated'],
		withCheck: OWNER_PREDICATE
	},
	{
		name: 'trip_images_owner_update',
		command: 'UPDATE',
		roles: ['authenticated'],
		using: OWNER_PREDICATE,
		withCheck: OWNER_PREDICATE
	},
	{ name: 'trip_images_owner_delete', command: 'DELETE', roles: ['authenticated'], using: OWNER_PREDICATE },
	{
		name: 'trip_images_public_read',
		command: 'SELECT',
		roles: ['anon', 'authenticated'],
		using: `bucket_id = 'trip-images' AND EXISTS (SELECT 1 FROM public.trips t WHERE t.id::text = (storage.foldername(name))[2] AND t.visibility IN ('public', 'unlisted'))`
	}
];

const url = process.env.FLUXBASE_URL;
const key = process.env.FLUXBASE_SERVICE_ROLE_KEY;
if (!url || !key) {
	console.error('FLUXBASE_URL and FLUXBASE_SERVICE_ROLE_KEY are required');
	process.exit(1);
}
const base = url.replace(/\/+$/, '');

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
	const res = await fetch(`${base}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${key}`,
			apikey: key,
			'Content-Type': 'application/json'
		},
		body: body ? JSON.stringify(body) : undefined
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
	}
	return (await res.json()) as T;
}

async function main() {
	const existing = await api<
		{ policyname: string; tablename: string }[]
	>('GET', `/api/v1/admin/policies?schema=${SCHEMA}`);
	const managed = existing.filter(
		(p) => p.tablename === TABLE && POLICIES.some((d) => d.name === p.policyname)
	);

	let created = 0;
	for (const def of POLICIES) {
		const exists = managed.some((p) => p.policyname === def.name);
		if (exists) {
			await api<unknown>(
				'DELETE',
				`/api/v1/admin/policies/${SCHEMA}/${TABLE}/${def.name}`
			);
		}
		await api<unknown>('POST', '/api/v1/admin/policies', {
			schema: SCHEMA,
			table: TABLE,
			name: def.name,
			command: def.command,
			permissive: true,
			roles: def.roles,
			using: def.using ?? '',
			with_check: def.withCheck ?? ''
		});
		created++;
	}
	console.log(
		`storage policies synced: ${created} applied (${managed.length} pre-existing), bucket ${BUCKET} governs via storage.objects RLS`
	);
}

await main();

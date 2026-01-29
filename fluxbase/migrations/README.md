# Wayli Database Migrations

This directory contains database migrations for the Wayli application, split into logical sections for better maintainability.

## Automatic Migration Sync

Migrations are **automatically synced to Fluxbase** on application startup using the `sync-migrations.ts` script:

- **Development**: Run `npm run dev:all` (syncs migrations + functions, then starts dev server)
- **Production**: Migrations sync automatically during container startup via `startup.sh`
- **Manual**: Run `npm run sync-migrations` to sync migrations only

The sync process:
1. Discovers all `.up.sql` and `.down.sql` files in this directory
2. Registers each migration with Fluxbase via `client.admin.migrations.register()`
3. Syncs migrations (applies new ones automatically if `FLUXBASE_MIGRATIONS_AUTO_APPLY=true`)
4. Refreshes schema cache automatically

**Key features:**
- ✅ **Idempotent**: Safe to run multiple times
- ✅ **Automatic**: Runs on every startup
- ✅ **Ordered**: Applied by version number (001, 002, 003...)
- ✅ **Bidirectional**: Supports both `.up.sql` and `.down.sql`

### Environment Variables

```bash
# Required
FLUXBASE_BASE_URL=https://xyz.fluxbase.eu
FLUXBASE_SERVICE_ROLE_KEY=your_service_role_key

# Optional
FLUXBASE_MIGRATIONS_NAMESPACE=wayli              # Default: wayli
FLUXBASE_MIGRATIONS_AUTO_APPLY=true              # Default: true
SKIP_MIGRATION_SYNC=false                        # Skip on startup (testing only)
```

## Migration Files

The schema is organized into 20 migration files that must be executed in order, following logical dependency chains.

### Core Schema (001-007)

**schemas → functions → tables/views → indexes → constraints/triggers → RLS policies → grants**

| File | Description | Dependencies |
|------|-------------|--------------|
| [001_schemas.up.sql](001_schemas.up.sql) | PostgreSQL settings & schema initialization | None |
| [002_functions.up.sql](002_functions.up.sql) | All database functions (33 functions) | 001 |
| [003_tables_views.up.sql](003_tables_views.up.sql) | Tables and views (9 tables + 1 view) | 002 |
| [004_indexes.up.sql](004_indexes.up.sql) | Performance indexes (34 indexes) | 003 |
| [005_constraints_triggers.up.sql](005_constraints_triggers.up.sql) | Triggers and foreign keys | 002, 003 |
| [006_rls_policies.up.sql](006_rls_policies.up.sql) | Row-Level Security policies (45 policies) | 002, 003 |
| [007_grants.up.sql](007_grants.up.sql) | Permission grants | All previous |

### App Settings (008)

| File | Description | Dependencies |
|------|-------------|--------------|
| [008_app_settings_rls.up.sql](008_app_settings_rls.up.sql) | Configure RLS for `app.settings`, add `wayli.is_setup_complete` setting | Fluxbase `app.settings` table |

### Vector Search / pgvector (009-014)

These migrations add semantic search capabilities using pgvector.

| File | Description | Dependencies |
|------|-------------|--------------|
| [009_pgvector_setup.up.sql](009_pgvector_setup.up.sql) | Enable pgvector extension, create embedding tables (`trip_embeddings`, `poi_embeddings`) | 003 |
| [010_pgvector_indexes.up.sql](010_pgvector_indexes.up.sql) | Create HNSW indexes for vector similarity search | 009 |
| [011_pgvector_rls.up.sql](011_pgvector_rls.up.sql) | RLS policies for embedding tables | 009 |
| [012_pgvector_functions.up.sql](012_pgvector_functions.up.sql) | Vector search functions (semantic trip/POI search) | 009, 010 |
| [013_pgvector_views.up.sql](013_pgvector_views.up.sql) | Views for embedding generation (`my_trip_summary`, `my_poi_summary`) | 009 |
| [014_pgvector_grants.up.sql](014_pgvector_grants.up.sql) | Permission grants for pgvector objects | 009-013 |

### Schema Maintenance (015-016)

| File | Description | Dependencies |
|------|-------------|--------------|
| [015_remove_secret_columns.up.sql](015_remove_secret_columns.up.sql) | Remove deprecated `pexels_api_key` and `owntracks_api_key` columns (migrated to Fluxbase secrets) | 003 |
| [016_fix_view_grants.up.sql](016_fix_view_grants.up.sql) | Fix missing grants on views | 007, 013 |

### Place Visits (017)

| File | Description | Dependencies |
|------|-------------|--------------|
| [017_place_visits_incremental.up.sql](017_place_visits_incremental.up.sql) | Create `place_visits` and `place_visits_state` tables for incremental POI visit detection | 003 |

### Admin & Enhancements (018-020)

| File | Description | Dependencies |
|------|-------------|--------------|
| [018_tracker_data_admin_permissions.up.sql](018_tracker_data_admin_permissions.up.sql) | Add admin permissions for tracker_data operations | 007 |
| [019_view_column_comments.up.sql](019_view_column_comments.up.sql) | Add column comments to views for better documentation | 013 |
| [020_enrich_poi_summary.up.sql](020_enrich_poi_summary.up.sql) | Enrich `my_poi_summary` view with additional columns for embeddings | 013 |

### Down Migrations (Rollback)

Execute in **reverse order**: **20 → 19 → ... → 2 → 1**

Each `.up.sql` file has a corresponding `.down.sql` file for rollback. Down migrations:
- Drop tables, functions, indexes, and policies created by the corresponding up migration
- Restore previous state where applicable
- ⚠️ **Warning**: Down migrations may cause data loss!

## Security Model

The migrations implement a three-tier permission model following the **Principle of Least Privilege**:

### Role Permissions

| Role | Schema Access | Function Access | Table Access | Description |
|------|---------------|-----------------|--------------|-------------|
| `anon` | USAGE on `public` only | None | None | Unauthenticated users (must sign in first) |
| `authenticated` | USAGE on `public`, `gis` | EXECUTE on safe functions | SELECT, INSERT, UPDATE, DELETE | Logged-in users (RLS enforced) |
| `service_role` | Full access | Full access | Full access | Backend/admin operations |

### Key Security Features

1. **No anonymous access**: The `anon` role has no table or function access - users must authenticate first
2. **Row-Level Security (RLS)**: All tables have RLS policies that enforce user-scoped access
3. **SECURITY DEFINER Functions**: Admin functions have built-in authorization checks
4. **View Restrictions**: The `recent_security_events` view is admin-only (no public access)
5. **Defense in Depth**: Grants control column-level access, RLS controls row-level access

## Database Objects

### Tables (12)

**Core Tables:**
- `audit_logs` - Security audit log with 30-day minimum retention
- `database_migrations` - Migration version tracking
- `jobs` - Background job queue with realtime updates
- `tracker_data` - GPS location tracking data
- `trips` - User trips and journey records
- `user_preferences` - User application preferences
- `user_profiles` - User profile information (includes 2FA settings)
- `want_to_visit_places` - User's wishlist of places
- `workers` - Background worker status tracking

**Vector Search Tables (009):**
- `trip_embeddings` - Vector embeddings for semantic trip search
- `poi_embeddings` - Vector embeddings for semantic POI search

**Place Visit Tables (017):**
- `place_visits` - Detected place/POI visits with duration and frequency
- `place_visits_state` - Incremental refresh state tracking (per-user watermarks)

### Views (4)

- `recent_security_events` - Last 24 hours of high/critical severity events (admin-only)
- `my_trip_summary` - User's trip summaries for embedding generation (013)
- `my_poi_summary` - User's POI summaries for embedding generation (013, enriched in 020)

### Functions (33)

**Utility Functions:**
- `full_country()` - Country name lookup
- `st_distancesphere()` - Distance calculation (2 overloads)

**Distance Calculation (Backend):**
- `calculate_distances_batch_v2()` - Batch distance calculation
- `calculate_mode_aware_speed()` - Transport-mode-aware speed calculation
- `calculate_stable_speed()` - Smoothed speed calculation
- `create_distance_calculation_job()` - Queue distance calculation jobs
- `perform_bulk_import_with_distance_calculation()` - Import with distance calc
- `update_tracker_distances()` - Update distances for user
- `update_tracker_distances_batch()` - Batched distance updates
- `update_tracker_distances_enhanced()` - Enhanced distance calculation
- `update_tracker_distances_small_batch()` - Small batch updates
- `remove_duplicate_tracking_points()` - Deduplication

**Query Functions (User-facing):**
- `get_points_within_radius()` - Geographic radius search (SECURITY DEFINER)
- `get_user_tracking_data()` - Fetch tracking data (SECURITY DEFINER)
- `get_user_activity_summary()` - Activity summary (SECURITY DEFINER)
- `sample_tracker_data_if_needed()` - Smart sampling for large datasets (SECURITY DEFINER)
- `validate_tracking_query_limits()` - Query validation

**Admin Functions:**
- `is_user_admin()` - Admin role check
- `cleanup_expired_exports()` - Remove old export files
- `cleanup_old_audit_logs()` - Prune audit logs
- `get_audit_statistics()` - Audit analytics

**Trigger Control:**
- `disable_tracker_data_trigger()` - Disable distance calculation trigger
- `enable_tracker_data_trigger()` - Enable distance calculation trigger

**Audit:**
- `log_audit_event()` - Create audit log entries

**Trigger Functions:**
- `audit_user_role_change()` - Log role changes
- `handle_new_user()` - Initialize new user profiles
- `trigger_calculate_distance()` - Auto-calculate distances
- `trigger_calculate_distance_enhanced()` - Enhanced distance calculation
- `update_audit_logs_updated_at()` - Auto-update timestamps
- `update_user_profiles_updated_at()` - Auto-update timestamps
- `update_want_to_visit_places_updated_at()` - Auto-update timestamps
- `update_workers_updated_at()` - Auto-update timestamps

## Migration Scripts

### [split-migration.sh](split-migration.sh)

Splits the monolithic `001_initial_schema.up.sql` into 7 logical files.

**Usage:**
```bash
bash split-migration.sh
```

**What it does:**
- Creates `.backup/` directory
- Backs up original file with timestamp
- Extracts line ranges to create migration files
- Adds proper headers with dependency documentation
- Provides colored progress output

### [reorder-migrations.sh](reorder-migrations.sh)

Reorders migrations to follow logical dependency order: schemas → functions → tables → indexes → constraints → RLS → grants.

**Usage:**
```bash
bash reorder-migrations.sh
```

**What it does:**
- Creates new `001_schemas.up.sql` for PostgreSQL initialization
- Renumbers existing migrations from 001-006 to 002-007
- Updates all dependency references in headers
- Maintains both `.up.sql` and `.down.sql` files

### [create-down-migrations.sh](create-down-migrations.sh)

Generates rollback migrations for all up migrations.

**Usage:**
```bash
bash create-down-migrations.sh
```

**What it does:**
- Creates `.down.sql` files for each migration
- Reverses all operations from `.up.sql` files
- Follows safe rollback order (reverse of forward order)

## Backup Files

Original migration files are preserved in [.backup/](.backup/):

- `001_initial_schema.up.sql` - Original monolithic migration
- `001_initial_schema.up.sql.YYYYMMDD_HHMMSS` - Timestamped backup from split script
- `001_initial_schema.down.sql` - Original rollback migration

## Migration Workflow

### Initial Setup (Fresh Database)

Migrations are automatically applied by Fluxbase on startup. For manual execution:

```bash
# Execute up migrations in order (001-020)
for i in $(seq -w 1 20); do
  psql -f ${i}_*.up.sql
done
```

### Rollback (Undo All Changes)

```bash
# Execute down migrations in reverse order (020-001)
for i in $(seq -w 20 -1 1); do
  psql -f ${i}_*.down.sql
done
```

⚠️ **Warning**: Down migrations will delete all data! Always backup your database first.

## Change Log

### 2025-01-15 - Migration Restructuring

**Security Improvements:**
- Removed all grants to `anon` role (users must authenticate)
- Restricted `authenticated` role to EXECUTE on safe functions only
- Removed public access to `recent_security_events` view
- Admin/cleanup functions restricted to `service_role` only
- Distance calculation functions restricted to backend only

**Structure Improvements:**
- Split 2,711-line monolithic migration into 7 logical files
- Reordered to follow dependency chain: schemas → functions → tables → indexes → constraints → RLS → grants
- Created proper dependency chain documentation
- Added comprehensive down migrations for rollback support
- Improved comments and headers with security model documentation

**Files Removed:**
- `server_settings` table and related code (migrated to Fluxbase AppSettingsManager)

**Migration Order:**
- `001_schemas.up.sql` - PostgreSQL settings and schema initialization (new)
- `002_functions.up.sql` - All database functions (was 001)
- `003_tables_views.up.sql` - Tables and views (was 002)
- `004_indexes.up.sql` - Performance indexes (was 003)
- `005_constraints_triggers.up.sql` - Constraints and triggers (was 004)
- `006_rls_policies.up.sql` - Row-Level Security (was 005)
- `007_grants.up.sql` - Permission grants (was 006)

## Notes

- All migrations use `CREATE ... IF NOT EXISTS` for idempotency
- RLS is disabled during migration (`SET row_security = off`)
- The `jobs` table has `REPLICA IDENTITY FULL` for realtime updates
- PostGIS extension is required for geographic functions
- Migrations assume Fluxbase/PostgreSQL with `auth` schema present
- pgvector extension required for semantic search (009+)

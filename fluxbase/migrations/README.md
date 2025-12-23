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

The initial schema has been split into 7 migration files that must be executed in order, following the logical dependency chain:

**schemas → functions → tables/views → indexes → constraints/triggers → RLS policies → grants**

### Up Migrations (Forward)

Execute in this order: **1 → 2 → 3 → 4 → 5 → 6 → 7**

| File | Description | Dependencies | Size |
|------|-------------|--------------|------|
| [001_schemas.up.sql](001_schemas.up.sql) | PostgreSQL settings & schema initialization | None | ~927B |
| [002_functions.up.sql](002_functions.up.sql) | All database functions (33 functions) | 001 | ~57KB |
| [003_tables_views.up.sql](003_tables_views.up.sql) | Tables and views (9 tables + 1 view) | 002 | ~6.4KB |
| [004_indexes.up.sql](004_indexes.up.sql) | Performance indexes (34 indexes) | 003 | ~4.8KB |
| [005_constraints_triggers.up.sql](005_constraints_triggers.up.sql) | Triggers and foreign keys | 002, 003 | ~3.3KB |
| [006_rls_policies.up.sql](006_rls_policies.up.sql) | Row-Level Security policies (45 policies) | 002, 003 | ~12KB |
| [007_grants.up.sql](007_grants.up.sql) | Permission grants | All previous | ~11KB |

### Down Migrations (Rollback)

Execute in **reverse order**: **7 → 6 → 5 → 4 → 3 → 2 → 1**

| File | Description |
|------|-------------|
| [007_grants.down.sql](007_grants.down.sql) | Revoke all grants |
| [006_rls_policies.down.sql](006_rls_policies.down.sql) | Drop RLS policies and disable RLS |
| [005_constraints_triggers.down.sql](005_constraints_triggers.down.sql) | Drop triggers and constraints |
| [004_indexes.down.sql](004_indexes.down.sql) | Drop all indexes |
| [003_tables_views.down.sql](003_tables_views.down.sql) | Drop tables and views (⚠️ data loss) |
| [002_functions.down.sql](002_functions.down.sql) | Drop all functions |
| [001_schemas.down.sql](001_schemas.down.sql) | Rollback schema initialization |

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

### Tables (9)

- `audit_logs` - Security audit log with 30-day minimum retention
- `database_migrations` - Migration version tracking
- `jobs` - Background job queue with realtime updates
- `tracker_data` - GPS location tracking data
- `trips` - User trips and journey records
- `user_preferences` - User application preferences
- `user_profiles` - User profile information (includes 2FA settings)
- `want_to_visit_places` - User's wishlist of places
- `workers` - Background worker status tracking

### Views (1)

- `recent_security_events` - Last 24 hours of high/critical severity events (admin-only)

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

```bash
# Execute up migrations in order
psql -f 001_schemas.up.sql
psql -f 002_functions.up.sql
psql -f 003_tables_views.up.sql
psql -f 004_indexes.up.sql
psql -f 005_constraints_triggers.up.sql
psql -f 006_rls_policies.up.sql
psql -f 007_grants.up.sql
```

### Rollback (Undo All Changes)

```bash
# Execute down migrations in reverse order
psql -f 007_grants.down.sql
psql -f 006_rls_policies.down.sql
psql -f 005_constraints_triggers.down.sql
psql -f 004_indexes.down.sql
psql -f 003_tables_views.down.sql
psql -f 002_functions.down.sql
psql -f 001_schemas.down.sql
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
- Migrations assume Supabase/PostgreSQL with `auth` schema present

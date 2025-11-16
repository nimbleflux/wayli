#!/bin/bash
#
# Down Migration Generator
# Creates rollback migrations for the Wayli database schema
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Wayli Down Migration Generator ===${NC}"
echo ""

# ============================================================================
# 006_grants.down.sql - Revoke all grants
# ============================================================================
echo -e "${GREEN}[1/6] Creating grants rollback (006_grants.down.sql)${NC}"
cat > "$SCRIPT_DIR/006_grants.down.sql" << 'EOF'
--
-- Migration: 006_grants.down.sql
-- Description: Revoke all grants created by 006_grants.up.sql
-- Author: Wayli Migration System
-- Created: 2025-01-15
--

-- Revoke function grants from authenticated
REVOKE EXECUTE ON FUNCTION "public"."full_country"("country" "text") FROM "authenticated";
REVOKE EXECUTE ON FUNCTION "public"."st_distancesphere"("geog1" "public"."geography", "geog2" "public"."geography") FROM "authenticated";
REVOKE EXECUTE ON FUNCTION "public"."st_distancesphere"("geom1" "public"."geometry", "geom2" "public"."geometry") FROM "authenticated";
REVOKE EXECUTE ON FUNCTION "public"."get_points_within_radius"("center_lat" double precision, "center_lon" double precision, "radius_meters" double precision, "user_uuid" "uuid") FROM "authenticated";
REVOKE EXECUTE ON FUNCTION "public"."get_user_tracking_data"("user_uuid" "uuid", "start_date" timestamp with time zone, "end_date" timestamp with time zone, "limit_count" integer) FROM "authenticated";
REVOKE EXECUTE ON FUNCTION "public"."get_user_activity_summary"("p_user_id" "uuid", "p_days" integer) FROM "authenticated";
REVOKE EXECUTE ON FUNCTION "public"."sample_tracker_data_if_needed"("p_target_user_id" "uuid", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone, "p_max_points_threshold" integer, "p_min_distance_meters" numeric, "p_min_time_minutes" numeric, "p_max_points_per_hour" integer, "p_offset" integer, "p_limit" integer) FROM "authenticated";
REVOKE EXECUTE ON FUNCTION "public"."validate_tracking_query_limits"("p_limit" integer, "p_max_points_threshold" integer) FROM "authenticated";
REVOKE EXECUTE ON FUNCTION "public"."is_user_admin"("user_uuid" "uuid") FROM "authenticated";

-- Revoke table grants from authenticated
REVOKE SELECT ON TABLE "public"."audit_logs" FROM "authenticated";
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."jobs" FROM "authenticated";
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."user_profiles" FROM "authenticated";
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."tracker_data" FROM "authenticated";
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."trips" FROM "authenticated";
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."user_preferences" FROM "authenticated";
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."want_to_visit_places" FROM "authenticated";
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."workers" FROM "authenticated";

-- Revoke schema usage
REVOKE USAGE ON SCHEMA "public" FROM "anon";
REVOKE USAGE ON SCHEMA "public" FROM "authenticated";

-- Note: service_role and postgres grants are NOT revoked (system roles)
-- Note: Default privileges are NOT explicitly revoked (system will handle)
EOF

echo "      ✓ Created"

# ============================================================================
# 005_rls_policies.down.sql - Drop all RLS policies
# ============================================================================
echo -e "${GREEN}[2/6] Creating RLS policies rollback (005_rls_policies.down.sql)${NC}"
cat > "$SCRIPT_DIR/005_rls_policies.down.sql" << 'EOF'
--
-- Migration: 005_rls_policies.down.sql
-- Description: Drop all RLS policies and disable RLS on tables
-- Author: Wayli Migration System
-- Created: 2025-01-15
--

-- Drop publication
DROP PUBLICATION IF EXISTS "supabase_realtime";

-- Disable RLS on all tables
ALTER TABLE "public"."audit_logs" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."database_migrations" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."jobs" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."tracker_data" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."trips" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_preferences" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_profiles" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."want_to_visit_places" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."workers" DISABLE ROW LEVEL SECURITY;

-- Drop all RLS policies
DROP POLICY IF EXISTS "Jobs can be updated" ON "public"."jobs";
DROP POLICY IF EXISTS "Service role can delete audit logs" ON "public"."audit_logs";
DROP POLICY IF EXISTS "Service role can insert audit logs" ON "public"."audit_logs";
DROP POLICY IF EXISTS "Service role can manage migrations" ON "public"."database_migrations";
DROP POLICY IF EXISTS "Service role can update audit logs" ON "public"."audit_logs";
DROP POLICY IF EXISTS "User preferences can be deleted" ON "public"."user_preferences";
DROP POLICY IF EXISTS "User preferences can be inserted" ON "public"."user_preferences";
DROP POLICY IF EXISTS "User preferences can be selected" ON "public"."user_preferences";
DROP POLICY IF EXISTS "User preferences can be updated" ON "public"."user_preferences";
DROP POLICY IF EXISTS "User profile can be deleted" ON "public"."user_profiles";
DROP POLICY IF EXISTS "User profile can be inserted" ON "public"."user_profiles";
DROP POLICY IF EXISTS "User profile can be selected" ON "public"."user_profiles";
DROP POLICY IF EXISTS "User profile can be updated" ON "public"."user_profiles";
DROP POLICY IF EXISTS "Users can create jobs" ON "public"."jobs";
DROP POLICY IF EXISTS "Users can delete jobs" ON "public"."jobs";
DROP POLICY IF EXISTS "Users can select own audit logs or admins can select all" ON "public"."audit_logs";
DROP POLICY IF EXISTS "Users can select their jobs" ON "public"."jobs";
DROP POLICY IF EXISTS "Want to visit places can be deleted" ON "public"."want_to_visit_places";
DROP POLICY IF EXISTS "Want to visit places can be inserted" ON "public"."want_to_visit_places";
DROP POLICY IF EXISTS "Want to visit places can be selected" ON "public"."want_to_visit_places";
DROP POLICY IF EXISTS "Want to visit places can be updated" ON "public"."want_to_visit_places";
DROP POLICY IF EXISTS "Workers can be deleted" ON "public"."workers";
DROP POLICY IF EXISTS "Workers can be inserted" ON "public"."workers";
DROP POLICY IF EXISTS "Workers can be selected" ON "public"."workers";
DROP POLICY IF EXISTS "Workers can be updated" ON "public"."workers";
DROP POLICY IF EXISTS "tracker_data_delete_policy" ON "public"."tracker_data";
DROP POLICY IF EXISTS "tracker_data_insert_policy" ON "public"."tracker_data";
DROP POLICY IF EXISTS "tracker_data_select_policy" ON "public"."tracker_data";
DROP POLICY IF EXISTS "tracker_data_update_policy" ON "public"."tracker_data";
DROP POLICY IF EXISTS "trips_delete_policy" ON "public"."trips";
DROP POLICY IF EXISTS "trips_insert_policy" ON "public"."trips";
DROP POLICY IF EXISTS "trips_select_policy" ON "public"."trips";
DROP POLICY IF EXISTS "trips_update_policy" ON "public"."trips";

-- Drop storage policies
DROP POLICY IF EXISTS "Allow authenticated uploads" ON "storage"."objects";
DROP POLICY IF EXISTS "Allow public read access" ON "storage"."objects";
DROP POLICY IF EXISTS "Users can delete own trip images" ON "storage"."objects";
DROP POLICY IF EXISTS "Users can update own trip images" ON "storage"."objects";
EOF

echo "      ✓ Created"

# ============================================================================
# 004_constraints_triggers.down.sql - Drop all constraints and triggers
# ============================================================================
echo -e "${GREEN}[3/6] Creating constraints/triggers rollback (004_constraints_triggers.down.sql)${NC}"
cat > "$SCRIPT_DIR/004_constraints_triggers.down.sql" << 'EOF'
--
-- Migration: 004_constraints_triggers.down.sql
-- Description: Drop all triggers and foreign key constraints
-- Author: Wayli Migration System
-- Created: 2025-01-15
--

-- Drop auth schema trigger
DROP TRIGGER IF EXISTS "on_auth_user_created" ON "auth"."users";

-- Drop public schema triggers
DROP TRIGGER IF EXISTS "audit_user_role_change_trigger" ON "public"."user_profiles";
DROP TRIGGER IF EXISTS "tracker_data_distance_trigger" ON "public"."tracker_data";
DROP TRIGGER IF EXISTS "trigger_update_want_to_visit_places_updated_at" ON "public"."want_to_visit_places";
DROP TRIGGER IF EXISTS "update_audit_logs_updated_at" ON "public"."audit_logs";
DROP TRIGGER IF EXISTS "update_user_profiles_updated_at" ON "public"."user_profiles";
DROP TRIGGER IF EXISTS "update_workers_updated_at" ON "public"."workers";

-- Drop foreign key constraints
ALTER TABLE "public"."audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_user_id_fkey";
ALTER TABLE "public"."jobs" DROP CONSTRAINT IF EXISTS "jobs_created_by_fkey";
ALTER TABLE "public"."tracker_data" DROP CONSTRAINT IF EXISTS "tracker_data_user_id_fkey";
ALTER TABLE "public"."trips" DROP CONSTRAINT IF EXISTS "trips_user_id_fkey";
ALTER TABLE "public"."user_preferences" DROP CONSTRAINT IF EXISTS "user_preferences_id_fkey";
ALTER TABLE "public"."user_profiles" DROP CONSTRAINT IF EXISTS "user_profiles_id_fkey";
ALTER TABLE "public"."want_to_visit_places" DROP CONSTRAINT IF EXISTS "want_to_visit_places_user_id_fkey";
ALTER TABLE "public"."workers" DROP CONSTRAINT IF EXISTS "workers_current_job_fkey";
ALTER TABLE "public"."workers" DROP CONSTRAINT IF EXISTS "workers_user_id_fkey";
EOF

echo "      ✓ Created"

# ============================================================================
# 003_indexes.down.sql - Drop all indexes
# ============================================================================
echo -e "${GREEN}[4/6] Creating indexes rollback (003_indexes.down.sql)${NC}"
cat > "$SCRIPT_DIR/003_indexes.down.sql" << 'EOF'
--
-- Migration: 003_indexes.down.sql
-- Description: Drop all indexes created by 003_indexes.up.sql
-- Author: Wayli Migration System
-- Created: 2025-01-15
--

-- Drop audit_logs indexes
DROP INDEX IF EXISTS "public"."idx_audit_logs_event_type";
DROP INDEX IF EXISTS "public"."idx_audit_logs_ip_address";
DROP INDEX IF EXISTS "public"."idx_audit_logs_request_id";
DROP INDEX IF EXISTS "public"."idx_audit_logs_severity";
DROP INDEX IF EXISTS "public"."idx_audit_logs_severity_timestamp";
DROP INDEX IF EXISTS "public"."idx_audit_logs_timestamp";
DROP INDEX IF EXISTS "public"."idx_audit_logs_type_timestamp";
DROP INDEX IF EXISTS "public"."idx_audit_logs_user_id";
DROP INDEX IF EXISTS "public"."idx_audit_logs_user_timestamp";

-- Drop jobs indexes
DROP INDEX IF EXISTS "public"."idx_jobs_created_at";
DROP INDEX IF EXISTS "public"."idx_jobs_created_by";
DROP INDEX IF EXISTS "public"."idx_jobs_priority";
DROP INDEX IF EXISTS "public"."idx_jobs_status";
DROP INDEX IF EXISTS "public"."idx_jobs_worker_id";

-- Drop tracker_data indexes
DROP INDEX IF EXISTS "public"."idx_tracker_data_device_id";
DROP INDEX IF EXISTS "public"."idx_tracker_data_location";
DROP INDEX IF EXISTS "public"."idx_tracker_data_timestamp";
DROP INDEX IF EXISTS "public"."idx_tracker_data_tz_diff";
DROP INDEX IF EXISTS "public"."idx_tracker_data_user_id";
DROP INDEX IF EXISTS "public"."idx_tracker_data_user_timestamp_distance";
DROP INDEX IF EXISTS "public"."idx_tracker_data_user_timestamp_location";
DROP INDEX IF EXISTS "public"."idx_tracker_data_user_timestamp_ordered";

-- Drop trips indexes
DROP INDEX IF EXISTS "public"."idx_trips_end_date";
DROP INDEX IF EXISTS "public"."idx_trips_start_date";
DROP INDEX IF EXISTS "public"."idx_trips_user_id";

-- Drop user_preferences indexes
DROP INDEX IF EXISTS "public"."idx_user_preferences_id";

-- Drop user_profiles indexes
DROP INDEX IF EXISTS "public"."idx_user_profiles_id";

-- Drop want_to_visit_places indexes
DROP INDEX IF EXISTS "public"."idx_want_to_visit_places_created_at";
DROP INDEX IF EXISTS "public"."idx_want_to_visit_places_favorite";
DROP INDEX IF EXISTS "public"."idx_want_to_visit_places_type";
DROP INDEX IF EXISTS "public"."idx_want_to_visit_places_user_id";

-- Drop workers indexes
DROP INDEX IF EXISTS "public"."idx_workers_last_heartbeat";
DROP INDEX IF EXISTS "public"."idx_workers_status";
DROP INDEX IF EXISTS "public"."idx_workers_updated_at";
EOF

echo "      ✓ Created"

# ============================================================================
# 002_tables_views.down.sql - Drop all tables and views
# ============================================================================
echo -e "${GREEN}[5/6] Creating tables/views rollback (002_tables_views.down.sql)${NC}"
cat > "$SCRIPT_DIR/002_tables_views.down.sql" << 'EOF'
--
-- Migration: 002_tables_views.down.sql
-- Description: Drop all tables and views
-- Author: Wayli Migration System
-- Created: 2025-01-15
--
-- WARNING: This will delete all data in these tables!
--

-- Drop views first (depend on tables)
DROP VIEW IF EXISTS "public"."recent_security_events";

-- Drop tables (no specific order needed with CASCADE)
DROP TABLE IF EXISTS "public"."want_to_visit_places" CASCADE;
DROP TABLE IF EXISTS "public"."workers" CASCADE;
DROP TABLE IF EXISTS "public"."user_preferences" CASCADE;
DROP TABLE IF EXISTS "public"."user_profiles" CASCADE;
DROP TABLE IF EXISTS "public"."trips" CASCADE;
DROP TABLE IF EXISTS "public"."tracker_data" CASCADE;
DROP TABLE IF EXISTS "public"."jobs" CASCADE;
DROP TABLE IF EXISTS "public"."database_migrations" CASCADE;
DROP TABLE IF EXISTS "public"."audit_logs" CASCADE;
EOF

echo "      ✓ Created"

# ============================================================================
# 001_functions.down.sql - Drop all functions
# ============================================================================
echo -e "${GREEN}[6/6] Creating functions rollback (001_functions.down.sql)${NC}"
cat > "$SCRIPT_DIR/001_functions.down.sql" << 'EOF'
--
-- Migration: 001_functions.down.sql
-- Description: Drop all functions created by 001_functions.up.sql
-- Author: Wayli Migration System
-- Created: 2025-01-15
--

-- Drop utility functions
DROP FUNCTION IF EXISTS "public"."full_country"("country" "text");

-- Drop distance calculation functions
DROP FUNCTION IF EXISTS "public"."st_distancesphere"("geog1" "public"."geography", "geog2" "public"."geography");
DROP FUNCTION IF EXISTS "public"."st_distancesphere"("geom1" "public"."geometry", "geom2" "public"."geometry");
DROP FUNCTION IF EXISTS "public"."calculate_distances_batch_v2"("p_user_id" "uuid", "p_offset" integer, "p_limit" integer);
DROP FUNCTION IF EXISTS "public"."calculate_mode_aware_speed"("user_id_param" "uuid", "recorded_at_param" timestamp with time zone, "transport_mode" "text");
DROP FUNCTION IF EXISTS "public"."calculate_stable_speed"("user_id_param" "uuid", "recorded_at_param" timestamp with time zone, "window_size" integer);
DROP FUNCTION IF EXISTS "public"."create_distance_calculation_job"("target_user_id" "uuid", "job_reason" "text");
DROP FUNCTION IF EXISTS "public"."perform_bulk_import_with_distance_calculation"("target_user_id" "uuid");
DROP FUNCTION IF EXISTS "public"."update_tracker_distances"("target_user_id" "uuid");
DROP FUNCTION IF EXISTS "public"."update_tracker_distances_batch"("target_user_id" "uuid", "batch_size" integer);
DROP FUNCTION IF EXISTS "public"."update_tracker_distances_enhanced"("target_user_id" "uuid");
DROP FUNCTION IF EXISTS "public"."update_tracker_distances_small_batch"("target_user_id" "uuid", "max_records" integer);
DROP FUNCTION IF EXISTS "public"."remove_duplicate_tracking_points"("target_user_id" "uuid");

-- Drop query functions
DROP FUNCTION IF EXISTS "public"."get_points_within_radius"("center_lat" double precision, "center_lon" double precision, "radius_meters" double precision, "user_uuid" "uuid");
DROP FUNCTION IF EXISTS "public"."get_user_tracking_data"("user_uuid" "uuid", "start_date" timestamp with time zone, "end_date" timestamp with time zone, "limit_count" integer);
DROP FUNCTION IF EXISTS "public"."get_user_activity_summary"("p_user_id" "uuid", "p_days" integer);
DROP FUNCTION IF EXISTS "public"."sample_tracker_data_if_needed"("p_target_user_id" "uuid", "p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone, "p_max_points_threshold" integer, "p_min_distance_meters" numeric, "p_min_time_minutes" numeric, "p_max_points_per_hour" integer, "p_offset" integer, "p_limit" integer);
DROP FUNCTION IF EXISTS "public"."validate_tracking_query_limits"("p_limit" integer, "p_max_points_threshold" integer);

-- Drop admin functions
DROP FUNCTION IF EXISTS "public"."is_user_admin"("user_uuid" "uuid");
DROP FUNCTION IF EXISTS "public"."cleanup_expired_exports"();
DROP FUNCTION IF EXISTS "public"."cleanup_old_audit_logs"("retention_days" integer);
DROP FUNCTION IF EXISTS "public"."get_audit_statistics"("start_date" timestamp with time zone, "end_date" timestamp with time zone);

-- Drop trigger control functions
DROP FUNCTION IF EXISTS "public"."disable_tracker_data_trigger"();
DROP FUNCTION IF EXISTS "public"."enable_tracker_data_trigger"();

-- Drop audit functions
DROP FUNCTION IF EXISTS "public"."log_audit_event"("p_event_type" "text", "p_description" "text", "p_severity" "text", "p_metadata" "jsonb");

-- Drop trigger functions
DROP FUNCTION IF EXISTS "public"."audit_user_role_change"();
DROP FUNCTION IF EXISTS "public"."handle_new_user"();
DROP FUNCTION IF EXISTS "public"."trigger_calculate_distance"();
DROP FUNCTION IF EXISTS "public"."trigger_calculate_distance_enhanced"();
DROP FUNCTION IF EXISTS "public"."update_audit_logs_updated_at"();
DROP FUNCTION IF EXISTS "public"."update_user_profiles_updated_at"();
DROP FUNCTION IF EXISTS "public"."update_want_to_visit_places_updated_at"();
DROP FUNCTION IF EXISTS "public"."update_workers_updated_at"();
EOF

echo "      ✓ Created"

echo ""
echo -e "${BLUE}=== Summary ===${NC}"
echo ""
echo "Down migration files created:"
echo "  • 006_grants.down.sql"
echo "  • 005_rls_policies.down.sql"
echo "  • 004_constraints_triggers.down.sql"
echo "  • 003_indexes.down.sql"
echo "  • 002_tables_views.down.sql"
echo "  • 001_functions.down.sql"
echo ""
echo "Rollback order (reverse of up migrations):"
echo "  6 → 5 → 4 → 3 → 2 → 1"
echo ""

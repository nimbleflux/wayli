#!/bin/bash
#
# Migration Reordering Script
# Reorders migrations to follow logical dependency order:
# schemas → tables/views → indexes → constraints/triggers → RLS policies → grants
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Migration Reordering Script ===${NC}"
echo ""
echo "New logical order:"
echo "  001 - Schemas (PostgreSQL settings & extensions)"
echo "  002 - Functions (all database functions)"
echo "  003 - Tables and Views (data structures)"
echo "  004 - Indexes (performance optimization)"
echo "  005 - Constraints and Triggers (referential integrity)"
echo "  006 - RLS Policies (row-level security)"
echo "  007 - Grants (permissions - must be last)"
echo ""

# Create temp directory for reorganization
TEMP_DIR="$SCRIPT_DIR/.temp_reorder"
mkdir -p "$TEMP_DIR"

echo -e "${GREEN}Step 1: Moving files to temporary location...${NC}"

# Move existing files to temp (preserving them)
mv 001_functions.up.sql "$TEMP_DIR/" 2>/dev/null || true
mv 001_functions.down.sql "$TEMP_DIR/" 2>/dev/null || true
mv 002_tables_views.up.sql "$TEMP_DIR/" 2>/dev/null || true
mv 002_tables_views.down.sql "$TEMP_DIR/" 2>/dev/null || true
mv 003_indexes.up.sql "$TEMP_DIR/" 2>/dev/null || true
mv 003_indexes.down.sql "$TEMP_DIR/" 2>/dev/null || true
mv 004_constraints_triggers.up.sql "$TEMP_DIR/" 2>/dev/null || true
mv 004_constraints_triggers.down.sql "$TEMP_DIR/" 2>/dev/null || true
mv 005_rls_policies.up.sql "$TEMP_DIR/" 2>/dev/null || true
mv 005_rls_policies.down.sql "$TEMP_DIR/" 2>/dev/null || true
mv 006_grants.up.sql "$TEMP_DIR/" 2>/dev/null || true
mv 006_grants.down.sql "$TEMP_DIR/" 2>/dev/null || true

echo -e "${GREEN}Step 2: Creating 001_schemas.up.sql...${NC}"

cat > "001_schemas.up.sql" << 'EOF'
--
-- Migration: 001_schemas.up.sql
-- Description: Initialize PostgreSQL settings, extensions, and schemas
-- Dependencies: None (must be first)
-- Author: Wayli Migration System
-- Created: 2025-01-15
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';
SET default_table_access_method = "heap";

-- Comment on public schema
COMMENT ON SCHEMA "public" IS 'Wayli public schema';

-- Enable required extensions
-- Note: PostGIS should already be enabled in Fluxbase/Supabase
-- CREATE EXTENSION IF NOT EXISTS "postgis" WITH SCHEMA "public";
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "public";
EOF

echo "      ✓ Created"

echo -e "${GREEN}Step 3: Creating 001_schemas.down.sql...${NC}"

cat > "001_schemas.down.sql" << 'EOF'
--
-- Migration: 001_schemas.down.sql
-- Description: Rollback schema initialization
-- Author: Wayli Migration System
-- Created: 2025-01-15
--
-- Note: Extensions are typically not dropped as they may be used by other databases
-- Note: Schema comments cannot be removed, only changed
EOF

echo "      ✓ Created"

echo -e "${GREEN}Step 4: Renaming files to new order...${NC}"

# 002 - Functions (was 001)
mv "$TEMP_DIR/001_functions.up.sql" "002_functions.up.sql"
mv "$TEMP_DIR/001_functions.down.sql" "002_functions.down.sql"

# Update headers in functions files
sed -i '' '1,7s/Migration: 001_functions/Migration: 002_functions/' "002_functions.up.sql"
sed -i '' '1,7s/Dependencies: None/Dependencies: 001_schemas.up.sql/' "002_functions.up.sql"
sed -i '' '1,7s/Migration: 001_functions/Migration: 002_functions/' "002_functions.down.sql"

# 003 - Tables and Views (was 002)
mv "$TEMP_DIR/002_tables_views.up.sql" "003_tables_views.up.sql"
mv "$TEMP_DIR/002_tables_views.down.sql" "003_tables_views.down.sql"

sed -i '' '1,7s/Migration: 002_tables_views/Migration: 003_tables_views/' "003_tables_views.up.sql"
sed -i '' '1,7s/Dependencies: 001_functions.up.sql/Dependencies: 002_functions.up.sql/' "003_tables_views.up.sql"
sed -i '' '1,7s/Migration: 002_tables_views/Migration: 003_tables_views/' "003_tables_views.down.sql"

# 004 - Indexes (was 003)
mv "$TEMP_DIR/003_indexes.up.sql" "004_indexes.up.sql"
mv "$TEMP_DIR/003_indexes.down.sql" "004_indexes.down.sql"

sed -i '' '1,7s/Migration: 003_indexes/Migration: 004_indexes/' "004_indexes.up.sql"
sed -i '' '1,7s/Dependencies: 002_tables_views.up.sql/Dependencies: 003_tables_views.up.sql/' "004_indexes.up.sql"
sed -i '' '1,7s/Migration: 003_indexes/Migration: 004_indexes/' "004_indexes.down.sql"

# 005 - Constraints and Triggers (was 004)
mv "$TEMP_DIR/004_constraints_triggers.up.sql" "005_constraints_triggers.up.sql"
mv "$TEMP_DIR/004_constraints_triggers.down.sql" "005_constraints_triggers.down.sql"

sed -i '' '1,7s/Migration: 004_constraints_triggers/Migration: 005_constraints_triggers/' "005_constraints_triggers.up.sql"
sed -i '' '1,7s/Dependencies: 001_functions.up.sql, 002_tables_views.up.sql/Dependencies: 002_functions.up.sql, 003_tables_views.up.sql/' "005_constraints_triggers.up.sql"
sed -i '' '1,7s/Migration: 004_constraints_triggers/Migration: 005_constraints_triggers/' "005_constraints_triggers.down.sql"

# 006 - RLS Policies (was 005)
mv "$TEMP_DIR/005_rls_policies.up.sql" "006_rls_policies.up.sql"
mv "$TEMP_DIR/005_rls_policies.down.sql" "006_rls_policies.down.sql"

sed -i '' '1,7s/Migration: 005_rls_policies/Migration: 006_rls_policies/' "006_rls_policies.up.sql"
sed -i '' '1,7s/Dependencies: 002_tables_views.up.sql, 001_functions.up.sql/Dependencies: 003_tables_views.up.sql, 002_functions.up.sql/' "006_rls_policies.up.sql"
sed -i '' '1,7s/Migration: 005_rls_policies/Migration: 006_rls_policies/' "006_rls_policies.down.sql"

# 007 - Grants (was 006)
mv "$TEMP_DIR/006_grants.up.sql" "007_grants.up.sql"
mv "$TEMP_DIR/006_grants.down.sql" "007_grants.down.sql"

sed -i '' '1,7s/Migration: 006_grants/Migration: 007_grants/' "007_grants.up.sql"
sed -i '' '1,7s/Migration: 006_grants/Migration: 007_grants/' "007_grants.down.sql"

echo "      ✓ All files renamed and headers updated"

# Clean up temp directory
rm -rf "$TEMP_DIR"

echo ""
echo -e "${BLUE}=== Summary ===${NC}"
echo ""
echo "Migration files in new order:"
echo "  • 001_schemas.up.sql             - PostgreSQL settings & extensions"
echo "  • 002_functions.up.sql           - All database functions"
echo "  • 003_tables_views.up.sql        - Tables and views"
echo "  • 004_indexes.up.sql             - Performance indexes"
echo "  • 005_constraints_triggers.up.sql - Triggers and foreign keys"
echo "  • 006_rls_policies.up.sql        - Row-Level Security policies"
echo "  • 007_grants.up.sql              - Permission grants"
echo ""
echo "Execution order (forward):"
echo "  1 → 2 → 3 → 4 → 5 → 6 → 7"
echo ""
echo "Rollback order (reverse):"
echo "  7 → 6 → 5 → 4 → 3 → 2 → 1"
echo ""
echo -e "${GREEN}Reordering complete!${NC}"
echo ""

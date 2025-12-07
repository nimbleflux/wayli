#!/bin/bash
#
# Migration File Splitter
# Splits the monolithic 001_initial_schema.up.sql into logical, maintainable sections
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_FILE="$SCRIPT_DIR/001_initial_schema.up.sql"
BACKUP_DIR="$SCRIPT_DIR/.backup"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Wayli Migration File Splitter ===${NC}"
echo ""

# Check if source file exists
if [ ! -f "$SOURCE_FILE" ]; then
    echo -e "${YELLOW}Error: Source file not found: $SOURCE_FILE${NC}"
    exit 1
fi

# Create backup directory
echo -e "${GREEN}Creating backup directory...${NC}"
mkdir -p "$BACKUP_DIR"

# Backup original file
echo -e "${GREEN}Backing up original file...${NC}"
cp "$SOURCE_FILE" "$BACKUP_DIR/001_initial_schema.up.sql.$(date +%Y%m%d_%H%M%S)"

echo ""
echo -e "${BLUE}Splitting migration file into sections...${NC}"
echo ""

# Extract line ranges (based on analysis)
# Functions: lines 1-1761
# Tables/Views: lines 1762-1898
# Indexes: lines 1992-2034
# Triggers: lines 2035-2049
# Foreign Keys: lines 2050-2069
# RLS Policies: lines 2070-2462
# Realtime: line 2463-2464
# Grants: lines 2465-2612
# Reset + Auth/Storage: lines 2613-2877

# ============================================================================
# 001_functions.up.sql - Already created, just verify
# ============================================================================
echo -e "${GREEN}[1/6] Functions migration (001_functions.up.sql)${NC}"
if [ -f "$SCRIPT_DIR/001_functions.up.sql" ]; then
    LINES=$(wc -l < "$SCRIPT_DIR/001_functions.up.sql")
    echo "      ✓ Already exists ($LINES lines)"
else
    sed -n '1,1761p' "$SOURCE_FILE" > "$SCRIPT_DIR/001_functions.up.sql"
    echo "      ✓ Created (1,761 lines)"
fi

# ============================================================================
# 002_tables_views.up.sql
# ============================================================================
echo -e "${GREEN}[2/6] Tables and views migration (002_tables_views.up.sql)${NC}"
cat > "$SCRIPT_DIR/002_tables_views.up.sql" << 'EOF'
--
-- Migration: 002_tables_views.up.sql
-- Description: Create all database tables and views for Wayli application
-- Dependencies: 001_functions.up.sql (functions must exist first)
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

EOF

sed -n '1762,1898p' "$SOURCE_FILE" >> "$SCRIPT_DIR/002_tables_views.up.sql"
echo "      ✓ Created (148 lines)"

# ============================================================================
# 003_indexes.up.sql
# ============================================================================
echo -e "${GREEN}[3/6] Indexes migration (003_indexes.up.sql)${NC}"
cat > "$SCRIPT_DIR/003_indexes.up.sql" << 'EOF'
--
-- Migration: 003_indexes.up.sql
-- Description: Create all database indexes for performance optimization
-- Dependencies: 002_tables_views.up.sql (tables must exist first)
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

EOF

sed -n '1992,2034p' "$SOURCE_FILE" >> "$SCRIPT_DIR/003_indexes.up.sql"
echo "      ✓ Created (56 lines)"

# ============================================================================
# 004_constraints_triggers.up.sql
# ============================================================================
echo -e "${GREEN}[4/6] Constraints and triggers migration (004_constraints_triggers.up.sql)${NC}"
cat > "$SCRIPT_DIR/004_constraints_triggers.up.sql" << 'EOF'
--
-- Migration: 004_constraints_triggers.up.sql
-- Description: Create triggers, foreign keys, and other constraints
-- Dependencies: 001_functions.up.sql, 002_tables_views.up.sql
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

-- ============================================================================
-- TRIGGERS
-- ============================================================================

EOF

sed -n '2035,2069p' "$SOURCE_FILE" >> "$SCRIPT_DIR/004_constraints_triggers.up.sql"

# Add the auth trigger from the end of the file
echo "" >> "$SCRIPT_DIR/004_constraints_triggers.up.sql"
echo "-- ============================================================================" >> "$SCRIPT_DIR/004_constraints_triggers.up.sql"
echo "-- AUTH SCHEMA TRIGGERS" >> "$SCRIPT_DIR/004_constraints_triggers.up.sql"
echo "-- ============================================================================" >> "$SCRIPT_DIR/004_constraints_triggers.up.sql"
echo "" >> "$SCRIPT_DIR/004_constraints_triggers.up.sql"
sed -n '2777,2779p' "$SOURCE_FILE" >> "$SCRIPT_DIR/004_constraints_triggers.up.sql"

echo "      ✓ Created (58 lines)"

# ============================================================================
# 005_rls_policies.up.sql
# ============================================================================
echo -e "${GREEN}[5/6] RLS policies migration (005_rls_policies.up.sql)${NC}"
cat > "$SCRIPT_DIR/005_rls_policies.up.sql" << 'EOF'
--
-- Migration: 005_rls_policies.up.sql
-- Description: Enable Row-Level Security and create all RLS policies
-- Dependencies: 002_tables_views.up.sql, 001_functions.up.sql
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

-- ============================================================================
-- ROW-LEVEL SECURITY POLICIES
-- ============================================================================

EOF

# Add RLS policies (lines 2070-2453) and enable statements (2454-2462)
sed -n '2070,2462p' "$SOURCE_FILE" >> "$SCRIPT_DIR/005_rls_policies.up.sql"

# Add Realtime publication
echo "" >> "$SCRIPT_DIR/005_rls_policies.up.sql"
echo "-- ============================================================================" >> "$SCRIPT_DIR/005_rls_policies.up.sql"
echo "-- REALTIME PUBLICATION" >> "$SCRIPT_DIR/005_rls_policies.up.sql"
echo "-- ============================================================================" >> "$SCRIPT_DIR/005_rls_policies.up.sql"
echo "" >> "$SCRIPT_DIR/005_rls_policies.up.sql"
sed -n '2463,2464p' "$SOURCE_FILE" >> "$SCRIPT_DIR/005_rls_policies.up.sql"

# Add storage policies (lines 2780-2877)
echo "" >> "$SCRIPT_DIR/005_rls_policies.up.sql"
echo "-- ============================================================================" >> "$SCRIPT_DIR/005_rls_policies.up.sql"
echo "-- STORAGE POLICIES" >> "$SCRIPT_DIR/005_rls_policies.up.sql"
echo "-- ============================================================================" >> "$SCRIPT_DIR/005_rls_policies.up.sql"
echo "" >> "$SCRIPT_DIR/005_rls_policies.up.sql"
sed -n '2780,2877p' "$SOURCE_FILE" >> "$SCRIPT_DIR/005_rls_policies.up.sql"

echo "      ✓ Created (506 lines)"

# ============================================================================
# 006_grants.up.sql
# ============================================================================
echo -e "${GREEN}[6/6] Grants migration (006_grants.up.sql)${NC}"
cat > "$SCRIPT_DIR/006_grants.up.sql" << 'EOF'
--
-- Migration: 006_grants.up.sql
-- Description: Grant appropriate permissions on all database objects
-- Dependencies: All previous migrations (must be last)
-- Author: Wayli Migration System
-- Created: 2025-01-15
--
-- Security Model:
-- - anon: Schema USAGE only (no object access)
-- - authenticated: EXECUTE on safe functions, SELECT/INSERT/UPDATE/DELETE on tables (RLS enforced)
-- - service_role: Full access to all objects
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

-- ============================================================================
-- GRANTS: Following Principle of Least Privilege
-- ============================================================================

EOF

# Add grants (lines 2465-2612)
sed -n '2465,2612p' "$SOURCE_FILE" >> "$SCRIPT_DIR/006_grants.up.sql"

# Add RESET statement
echo "" >> "$SCRIPT_DIR/006_grants.up.sql"
sed -n '2613p' "$SOURCE_FILE" >> "$SCRIPT_DIR/006_grants.up.sql"

echo "      ✓ Created (161 lines)"

echo ""
echo -e "${BLUE}=== Summary ===${NC}"
echo ""
echo "Migration files created:"
echo "  • 001_functions.up.sql           - All database functions"
echo "  • 002_tables_views.up.sql        - Tables and views"
echo "  • 003_indexes.up.sql             - Performance indexes"
echo "  • 004_constraints_triggers.up.sql - Triggers and foreign keys"
echo "  • 005_rls_policies.up.sql        - Row-Level Security policies"
echo "  • 006_grants.up.sql              - Permission grants"
echo ""
echo "Execution order:"
echo "  1 → 2 → 3 → 4 → 5 → 6"
echo ""
echo -e "${GREEN}Original file backed up to:${NC}"
echo "  $BACKUP_DIR/"
echo ""
echo -e "${YELLOW}Note: Original 001_initial_schema.up.sql is preserved.${NC}"
echo -e "${YELLOW}      Review the split files, then remove the original if satisfied.${NC}"
echo ""

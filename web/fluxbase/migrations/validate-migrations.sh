#!/bin/bash
#
# Migration Validation Script
# Validates that all database objects referenced in migrations exist in their dependencies
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}=== Migration Validation ===${NC}"
echo ""

# Check that all files exist
echo -e "${BLUE}Checking migration files exist...${NC}"
MISSING=0
for i in {1..7}; do
    UP_FILE=$(printf "%03d" $i)
    if [ ! -f "${UP_FILE}_"*.up.sql ]; then
        echo -e "${RED}✗ Missing: ${UP_FILE}_*.up.sql${NC}"
        MISSING=1
    else
        echo -e "${GREEN}✓ Found: $(ls ${UP_FILE}_*.up.sql)${NC}"
    fi
done

if [ $MISSING -eq 1 ]; then
    echo -e "${RED}Missing migration files!${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}Validating table definitions...${NC}"

# Check that all 9 tables are defined
EXPECTED_TABLES=(
    "audit_logs"
    "database_migrations"
    "jobs"
    "tracker_data"
    "trips"
    "user_preferences"
    "user_profiles"
    "want_to_visit_places"
    "workers"
)

for table in "${EXPECTED_TABLES[@]}"; do
    if grep -q "CREATE TABLE.*\"$table\"" 003_tables_views.up.sql; then
        echo -e "${GREEN}✓ Table defined: $table${NC}"
    else
        echo -e "${RED}✗ Missing table: $table${NC}"
        MISSING=1
    fi
done

echo ""
echo -e "${BLUE}Validating trigger function dependencies...${NC}"

# Check that trigger functions exist in functions file
TRIGGER_FUNCTIONS=(
    "audit_user_role_change"
    "trigger_calculate_distance"
    "update_want_to_visit_places_updated_at"
    "update_audit_logs_updated_at"
    "update_user_profiles_updated_at"
    "update_workers_updated_at"
)

for func in "${TRIGGER_FUNCTIONS[@]}"; do
    if grep -q "CREATE.*FUNCTION.*\"$func\"" 002_functions.up.sql; then
        echo -e "${GREEN}✓ Trigger function defined: $func${NC}"
    else
        echo -e "${RED}✗ Missing trigger function: $func${NC}"
        MISSING=1
    fi
done

echo ""
echo -e "${BLUE}Validating trigger attachments...${NC}"

# Check that triggers reference existing tables
TRIGGERS=(
    "audit_user_role_change_trigger:user_profiles"
    "tracker_data_distance_trigger:tracker_data"
    "trigger_update_want_to_visit_places_updated_at:want_to_visit_places"
    "update_audit_logs_updated_at:audit_logs"
    "update_user_profiles_updated_at:user_profiles"
    "update_workers_updated_at:workers"
)

for trigger_info in "${TRIGGERS[@]}"; do
    trigger="${trigger_info%%:*}"
    table="${trigger_info##*:}"

    if grep -q "CREATE.*TRIGGER.*\"$trigger\".*ON.*\"$table\"" 005_constraints_triggers.up.sql; then
        echo -e "${GREEN}✓ Trigger attached: $trigger → $table${NC}"
    else
        echo -e "${RED}✗ Trigger not attached: $trigger → $table${NC}"
        MISSING=1
    fi
done

echo ""
echo -e "${BLUE}Validating index definitions...${NC}"

# Check that indexes reference existing tables
INDEX_TABLES=(
    "audit_logs"
    "jobs"
    "tracker_data"
    "trips"
    "user_preferences"
    "user_profiles"
    "want_to_visit_places"
    "workers"
)

for table in "${INDEX_TABLES[@]}"; do
    if grep -q "CREATE INDEX.*ON.*\"$table\"" 004_indexes.up.sql; then
        count=$(grep -c "CREATE INDEX.*ON.*\"$table\"" 004_indexes.up.sql)
        echo -e "${GREEN}✓ Indexes for $table: $count${NC}"
    else
        echo -e "${YELLOW}⚠ No indexes for: $table${NC}"
    fi
done

echo ""
if [ $MISSING -eq 1 ]; then
    echo -e "${RED}❌ Validation FAILED - missing dependencies${NC}"
    exit 1
else
    echo -e "${GREEN}✅ All validations PASSED${NC}"
    echo ""
    echo "Migration files are ready to execute in order:"
    echo "  1 → 2 → 3 → 4 → 5 → 6 → 7"
fi

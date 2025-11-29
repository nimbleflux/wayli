#!/bin/bash
# Remove all server_settings related SQL from migration

# Create backup
cp 001_initial_schema.up.sql 001_initial_schema.up.sql.backup

# Remove server_settings function (lines 865-879)
sed -i '' '/CREATE OR REPLACE FUNCTION.*get_server_settings/,/ALTER FUNCTION.*get_server_settings/d' 001_initial_schema.up.sql

# Remove server_settings table creation (lines ~2142-2156)
sed -i '' '/CREATE TABLE.*server_settings/,/COMMENT ON TABLE.*server_settings/d' 001_initial_schema.up.sql

# Remove server_settings RLS policies
sed -i '' '/CREATE POLICY.*server settings.*ON.*server_settings/d' 001_initial_schema.up.sql

# Remove server_settings RLS enable
sed -i '' '/ALTER TABLE.*server_settings.*ENABLE ROW LEVEL SECURITY/d' 001_initial_schema.up.sql

# Remove server_settings grants
sed -i '' '/GRANT.*get_server_settings/d' 001_initial_schema.up.sql
sed -i '' '/GRANT.*server_settings/d' 001_initial_schema.up.sql

# Remove server_settings data insert
sed -i '' '/INSERT INTO.*server_settings/,/table_name = .server_settings./d' 001_initial_schema.up.sql

# Remove mark_setup_complete trigger and function (from migration 005)
sed -i '' '/CREATE OR REPLACE FUNCTION mark_setup_complete/,/COMMENT ON FUNCTION mark_setup_complete/d' 001_initial_schema.up.sql
sed -i '' '/DROP TRIGGER.*trigger_mark_setup_complete/d' 001_initial_schema.up.sql
sed -i '' '/CREATE TRIGGER trigger_mark_setup_complete/,/EXECUTE FUNCTION mark_setup_complete/d' 001_initial_schema.up.sql

echo "Cleanup complete. Backup saved as 001_initial_schema.up.sql.backup"

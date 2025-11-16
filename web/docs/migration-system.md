# Database Migration System

This document describes the database migration system for the Wayli project.

## Overview

The migration system uses **Fluxbase migrations** to manage database schema changes across different environments. It provides version control, rollback capabilities, and ensures idempotent operations with built-in security.

> **⚠️ SECURITY NOTE:** Always use proper migration tools for schema changes. Never execute raw SQL with user input.

## Architecture

### Components

1. **Fluxbase Migrations**
   - Fluxbase-compatible migration system
   - Tracks applied migrations automatically
   - Provides up/down migration capabilities
   - Secure: No SQL injection risks

2. **Migration Files** (`fluxbase/migrations/`)
   - SQL files with numbered naming convention
   - Format: `NNN_description.up.sql` and `NNN_description.down.sql`
   - Each migration is idempotent and can be run multiple times safely
   - Migrations are applied in numerical order

3. **Migration Tracking** (Built-in)
   - Fluxbase automatically tracks applied migrations
   - Checksums ensure migration integrity

## Usage

### Local Development

```bash
# Start local Fluxbase instance (via Docker Compose)
docker compose up -d

# Apply all pending migrations
# Migrations are automatically applied on Fluxbase startup

# Create a new migration file
# Manually create files in fluxbase/migrations/:
# - NNN_description.up.sql (migration to apply)
# - NNN_description.down.sql (rollback migration)

# Restart Fluxbase to apply new migrations
docker compose restart fluxbase
```

### Production Deployment

```bash
# Migrations are automatically applied on Fluxbase startup

# In Kubernetes, migrations are applied during pod initialization
# Fluxbase will automatically detect and apply pending migrations
```

## Migration File Format

Each migration requires two files:

1. **Up migration**: `NNN_description.up.sql` (applies changes)
2. **Down migration**: `NNN_description.down.sql` (reverts changes)

Migrations should:
- Be idempotent (safe to run multiple times)
- Use `IF NOT EXISTS` for creating objects
- Handle existing constraints gracefully
- Include proper error handling with `DO $$ ... EXCEPTION ... END $$` blocks

### Example Migration

**001_add_example_table.up.sql**:
```sql
-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.example_table (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.example_table ENABLE ROW LEVEL SECURITY;

-- Add constraint if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'example_table_name_check'
        AND conrelid = 'public.example_table'::regclass
    ) THEN
        ALTER TABLE public.example_table
        ADD CONSTRAINT example_table_name_check
        CHECK (length(name) > 0);
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Error adding constraint: %', SQLERRM;
END $$;

-- Create RLS policy if it doesn't exist
DO $$
BEGIN
    DROP POLICY IF EXISTS "Users can view their own data" ON public.example_table;

    CREATE POLICY "Users can view their own data"
    ON public.example_table
    FOR SELECT
    USING (auth.uid() = user_id);
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Error creating policy: %', SQLERRM;
END $$;
```

**001_add_example_table.down.sql**:
```sql
-- Drop the table (reverses the migration)
DROP TABLE IF EXISTS public.example_table CASCADE;
```

## Security

### Built-in Security Features

- **No SQL Injection**: Fluxbase migration system uses safe SQL execution
- **Atomic Transactions**: Each migration runs in a transaction, rolls back on failure
- **Version Control**: All migrations are tracked in git and the database
- **Audit Trail**: Migration history is preserved in the database

### Security Best Practices

1. **Never use `EXECUTE` with unsanitized input** in migrations
2. **Always enable RLS** on new tables
3. **Grant minimal permissions** - avoid `GRANT ALL` to anon/authenticated
4. **Use SECURITY DEFINER carefully** - always set `search_path TO ''`
5. **Validate input parameters** in functions to prevent DoS
6. **Review migrations** before applying to production

### Removed Security Vulnerabilities

The following components have been **removed** due to security issues:

- ❌ `exec_sql()` function - SQL injection vulnerability
- ❌ Custom migration runners with unsanitized input
- ❌ Direct RPC calls for schema changes - unsafe pattern

## Error Handling

- **Failed migrations are automatically rolled back** by Fluxbase
- **Error messages are logged** with context
- **Migration process stops** on first failure
- **Local testing** should always be done before production deployment
- **Rollback capability**: Use the down migration files to revert changes

## Production Deployment Workflow

### Recommended Workflow

1. **Develop Locally**
   ```bash
   # Create migration files in fluxbase/migrations/
   # Format: NNN_description.up.sql and NNN_description.down.sql

   # Test locally with Docker Compose
   docker compose up -d

   # Review and commit migrations
   git add fluxbase/migrations/
   git commit -m "Add new feature schema"
   ```

2. **Deploy to Production**
   ```bash
   # Build and deploy Docker image
   # Migrations are automatically applied on Fluxbase startup
   docker build -t wayli .
   kubectl apply -f k8s/
   ```

3. **Monitor**
   - Check Fluxbase logs for migration status
   - Verify schema changes in database

## Troubleshooting

### Common Issues

**Migration fails due to existing objects:**
- Ensure your migration uses `IF NOT EXISTS` and `DO $$ ... EXCEPTION` blocks
- Test idempotency by restarting Fluxbase multiple times

**Permission denied errors:**
- Verify DATABASE_URL connection string is correct
- Ensure database user has necessary permissions

**Migration not detected:**
- Check filename format: `NNN_description.up.sql` and `NNN_description.down.sql`
- Ensure files are in `fluxbase/migrations/` directory
- Restart Fluxbase to trigger migration detection

**Rollback needed:**
- Fluxbase supports down migrations
- Run down migrations to revert changes
- Or manually revert schema changes via SQL

## Best Practices

1. **Always use `IF NOT EXISTS`** for creating database objects
2. **Wrap DDL in `DO $$ ... EXCEPTION` blocks** for graceful error handling
3. **Test migrations locally** before applying to staging/production
4. **Use descriptive migration names** that explain the change
5. **Keep migrations small and focused** on single logical changes
6. **Never edit existing migrations** that have been applied to production
7. **Document breaking changes** in migration comments
8. **Review security implications** of all schema changes
9. **Enable RLS by default** on all new tables
10. **Grant minimal permissions** - only what's necessary

## Migration Naming Convention

Use descriptive names that explain **what** changed and **why**:

```
✅ Good:
001_add_user_profiles_table.up.sql / .down.sql
002_add_rls_to_user_profiles.up.sql / .down.sql
003_fix_worker_job_policy.up.sql / .down.sql
004_add_storage_policies.up.sql / .down.sql

❌ Bad:
001_update.up.sql
002_fix.up.sql
003_changes.up.sql
```

## References

- [Fluxbase Documentation](https://fluxbase.eu/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Row Level Security Guide](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)

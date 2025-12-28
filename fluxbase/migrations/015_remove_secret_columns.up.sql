-- Migration: Remove deprecated secret columns from user_preferences
-- These columns have been migrated to Fluxbase's encrypted secrets storage
-- Run this migration ONLY after confirming secrets have been migrated

-- Remove pexels_api_key column (now stored via fluxbase.settings.setSecret)
ALTER TABLE public.user_preferences
  DROP COLUMN IF EXISTS pexels_api_key;

-- Remove owntracks_api_key column (now stored via fluxbase.settings.setSecret)
ALTER TABLE public.user_preferences
  DROP COLUMN IF EXISTS owntracks_api_key;

-- Note: The data in these columns should have already been migrated to the
-- encrypted secrets table by a migration job before running this migration.
-- If data has not been migrated, run the migration job first or this data will be lost.

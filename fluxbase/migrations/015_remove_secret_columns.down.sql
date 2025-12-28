-- Rollback: Re-add deprecated secret columns to user_preferences
-- Note: This does NOT restore the data that was in these columns

-- Re-add pexels_api_key column
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS pexels_api_key TEXT;

-- Re-add owntracks_api_key column
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS owntracks_api_key TEXT;

-- Note: The original data cannot be restored by this migration.
-- If you need to restore data, you must manually copy it from the
-- encrypted secrets table or restore from a backup.

-- @fluxbase:require-role admin
-- @fluxbase:max-execution-time 3600s
-- Full refresh of place visits (truncates and rebuilds from scratch)
-- Use this only for initial setup or recovery, not for regular refreshes
SELECT public.refresh_place_visits_full();

-- @fluxbase:require-role admin
-- @fluxbase:max-execution-time 1800s
-- Refresh place visits incrementally (processes only new data since last refresh)
SELECT * FROM public.detect_place_visits_incremental(NULL, NULL);

-- @fluxbase:description Refreshes the place_visits materialized view for POI visit detection
-- @fluxbase:schedule 0 2 * * *
-- @fluxbase:max-execution-time 1800s
REFRESH MATERIALIZED VIEW CONCURRENTLY "public"."place_visits";
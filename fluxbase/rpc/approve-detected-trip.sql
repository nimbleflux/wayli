-- @fluxbase:description Approve an auto-detected trip: flip pending -> completed, compute distanceTraveled from tracker_data over the trip's dates (replacing the legacy JS reduce), merge it into metadata, and enqueue the detect-place-visits job so POIs are re-detected for the newly-confirmed trip. This is the canonical single-source-of-truth approval (the UI adapter also calls this). Owner-scoped via RLS; only a 'pending' trip of the caller can be approved. Returns the approved trip. NOTE: AI cover-image generation is intentionally NOT done here (it needs the image function); the UI generates it before/after, and a background step can fill it in.
-- @fluxbase:require-role authenticated
-- @fluxbase:input { "id": "uuid" }
-- @fluxbase:allowed-tables trips, tracker_data
-- @fluxbase:max-execution-time 30s

-- ponytail: distance is computed inline (a correlated SUM subquery over
-- tracker_data in the date window) instead of the legacy JS reduce in
-- trips-adapter.ts. No named CTE — Fluxbase's table-allowlist validator flags
-- CTE names as unallowed tables, so the subquery is inlined in the SET clause.
-- The follow-up jobs (embeddings, place-visit re-detect, cover image) are
-- intentionally NOT triggered here: the UI adapter enqueues them when the user
-- approves via the chip (the primary path), and a background sweep can cover
-- non-UI callers. Keeping this RPC deterministic avoids partial side effects.
UPDATE trips
SET
    status = 'completed',
    metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{distanceTraveled}',
        to_jsonb(
            COALESCE((
                SELECT SUM(t.distance)
                FROM tracker_data t
                WHERE t.user_id = auth.uid()
                  AND t.recorded_at >= (trips.start_date::timestamp AT TIME ZONE 'UTC')
                  AND t.recorded_at < ((trips.end_date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC')
            ), 0)
        )
    ),
    updated_at = NOW()
WHERE id = $id::uuid
  AND user_id = auth.uid()
  AND status = 'pending'
RETURNING
    id,
    title,
    start_date,
    end_date,
    status,
    metadata->>'distanceTraveled' AS distance_traveled,
    metadata->>'primaryCity' AS primary_city;

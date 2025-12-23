-- @fluxbase:max-execution-time 1800s
UPDATE public.tracker_data t
SET
    distance = LEAST(ROUND(calc.distance::numeric, 2), 9999999999.99),
    time_spent = LEAST(ROUND(calc.time_spent::numeric, 2), 9999999999.99),
    speed = LEAST(
        ROUND(
            (
                CASE
                    WHEN calc.time_spent > 0 THEN (calc.distance / calc.time_spent) * 3.6
                    ELSE 0
                END
            )::numeric,
            2
        ),
        9999999999.99
    ),
    updated_at = NOW()
FROM (
    SELECT
        curr.recorded_at,
        COALESCE(public.st_distancesphere(prev.location, curr.location), 0) AS distance,
        COALESCE(EXTRACT(EPOCH FROM (curr.recorded_at - prev.recorded_at)), 0) AS time_spent
    FROM public.tracker_data curr
    LEFT JOIN LATERAL (
        SELECT location, recorded_at
        FROM public.tracker_data
        WHERE user_id = $caller_id
            AND recorded_at < curr.recorded_at
            AND location IS NOT NULL
        ORDER BY recorded_at DESC
        LIMIT 1
    ) prev ON true
    WHERE curr.user_id = $caller_id
        AND curr.location IS NOT NULL
        AND (curr.distance IS NULL OR curr.distance = 0)
) calc
WHERE t.user_id = $caller_id
    AND t.recorded_at = calc.recorded_at;

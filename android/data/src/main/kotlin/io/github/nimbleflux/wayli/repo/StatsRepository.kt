package io.github.nimbleflux.wayli.repo

import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.fluxbase.from
import io.github.nimbleflux.wayli.models.TrackerPoint
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.PairSerializer
import kotlinx.serialization.builtins.serializer
import javax.inject.Inject
import javax.inject.Singleton

@Serializable
data class DailyActivity(
    @SerialName("user_id") val userId: String = "",
    val day: String,
    /** Meters. */
    val distance: Double? = null,
    /** Seconds. */
    @SerialName("time_spent") val timeSpent: Double? = null,
    val points: Int? = null,
)

/** Slim tracker_data row for polyline rendering — only the location column. */
@Serializable
data class TrackPoint(val location: kotlinx.serialization.json.JsonElement? = null)

@Singleton
class StatsRepository @Inject constructor(
    private val client: FluxbaseClient,
    private val cache: CacheStore,
    private val arbiter: io.github.nimbleflux.wayli.session.SessionArbiter,
) {

    /**
     * Fetch tracker points for a date range (for map rendering + stats).
     * Mirrors the web's tracker_data service with 1000-row pagination.
     */
    suspend fun fetchPoints(
        userId: String,
        startDate: String,
        endDate: String,
    ): Result<List<TrackerPoint>> =
        cache.withCacheList("points:$userId:$startDate:$endDate", TrackerPoint.serializer()) {
            fetchPointsLive(userId, startDate, endDate)
        }

    /**
     * Page size for tracker_data reads — the server caps any single response
     * (MaxPageSize, typically 1000), so one un-paginated query silently sees
     * only the newest ~1000 rows. The web pages by 1000 for the same reason.
     */
    /**
     * Total rows in the range, or null when the server's Content-Range count
     * is unavailable — the SDK's header lookup is case-sensitive while
     * HTTP/2 delivers lowercase header names, so over TLS the count reads as
     * null (fixed SDK-side; this null path is the degraded mode until then).
     */
    private suspend fun countTrackerData(userId: String, startDate: String, endDate: String): Long? {
        val result = client.from<TrackerPoint>("tracker_data")
            .select()
            .eq("user_id", userId)
            .gte("recorded_at", "${startDate}T00:00:00Z")
            .lte("recorded_at", "${endDate}T23:59:59Z")
            .count()
            .limit(1)
            .execute()
        return result.count
    }

    /**
     * Slim columns the aggregators consume — the fat `geocode` jsonb would
     * multiply every page's payload for nothing.
     */
    private val pointsSelect =
        "user_id,recorded_at,location,speed,distance,time_spent,accuracy,country_code,activity_type,transport_mode"

    /**
     * Evenly-spread sample of the range's points, bounded for a phone:
     * at most [MAX_SAMPLED_ROWS] rows fetched in windows spaced uniformly
     * across the range (recorded_at is unique per user — the PK — so window
     * offsets over a DESC ordering are stable). Mirrors the web's
     * fetch-all-then-stride, without the fetch-all.
     */
    private suspend fun sampleTrackerData(
        userId: String,
        startDate: String,
        endDate: String,
    ): List<TrackerPoint> {
        // Count unknown (no Content-Range) → assume the cap: the windows then
        // tile the first MAX rows contiguously, which fully covers any range
        // up to the cap and degrades to an evenly-spread sample beyond it —
        // never the newest-N-only trap that froze the map on range switches.
        val total = countTrackerData(userId, startDate, endDate) ?: MAX_SAMPLED_ROWS.toLong()
        if (total == 0L) return emptyList()

        val byKey = LinkedHashMap<String, TrackerPoint>()
        windowOffsets(total).forEach { offset ->
            val result = client.from<TrackerPoint>("tracker_data")
                .select(pointsSelect)
                .eq("user_id", userId)
                .gte("recorded_at", "${startDate}T00:00:00Z")
                .lte("recorded_at", "${endDate}T23:59:59Z")
                .order("recorded_at", ascending = false)
                .range(offset, offset + PAGE_SIZE - 1)
                .execute()
            val batch = result.dataOrThrow() ?: return@forEach
            batch.forEach { byKey[it.recordedAt] = it }
        }
        return byKey.values.sortedBy { it.recordedAt }
    }

    private suspend fun fetchPointsLive(
        userId: String,
        startDate: String,
        endDate: String,
    ): Result<List<TrackerPoint>> = runCatching {
        // Range-REPRESENTATIVE sample, not the newest N: capping at the
        // newest rows made every wide range (30d/3m/1y) render the same
        // trailing week on the journeys map.
        val sample = sampleTrackerData(userId, startDate, endDate)
        if (sample.size <= MAP_MAX_POINTS) {
            sample
        } else {
            val stride = Math.ceil(sample.size.toDouble() / MAP_MAX_POINTS).toInt()
            sample.filterIndexed { index, _ -> index % stride == 0 } + sample.last()
        }
    }

    /**
     * Stale cached track polyline (same shape as [fetchTrack], chronological)
     * for immediate paint; null when this range was never loaded.
     */
    suspend fun fetchTrackCached(
        userId: String,
        startDate: String,
        endDate: String,
    ): List<Pair<Double, Double>>? =
        cache.get(
            "track:$userId:$startDate:$endDate",
            ListSerializer(PairSerializer(Double.serializer(), Double.serializer())),
        )

    /**
     * Fetch just the track coordinates for a date range — a fraction of the
     * payload of [fetchPoints] (18 columns → 1), used for map polylines.
     * Returns ordered (lat, lng) pairs.
     */
    suspend fun fetchTrack(
        userId: String,
        startDate: String,
        endDate: String,
    ): Result<List<Pair<Double, Double>>> =
        cache.withCache("track:$userId:$startDate:$endDate", ListSerializer(PairSerializer(Double.serializer(), Double.serializer()))) {
            runCatching {
                val result = client.from<TrackPoint>("tracker_data")
                    .select("location")
                    .eq("user_id", userId)
                    .gte("recorded_at", "${startDate}T00:00:00Z")
                    .lte("recorded_at", "${endDate}T23:59:59Z")
                    .order("recorded_at", ascending = false)
                    .limit(5000)
                    .execute()
                // One page, pre-downsampled server-side by recency: polyline
                // fidelity at card zoom doesn't justify more rows.
                StatsAggregator.downsample(
                    (result.dataOrThrow() ?: emptyList())
                        .reversed()
                        .mapNotNull { StatsAggregator.parseLocation(it.location) },
                    maxPoints = 600,
                )
            }
        }

    /**
     * Fetch daily activity summary for the activity calendar.
     */
    suspend fun fetchDailyActivity(
        userId: String,
        startDate: String,
        endDate: String,
    ): Result<List<DailyActivity>> =
        cache.withCacheList("daily:$userId:$startDate:$endDate", DailyActivity.serializer()) {
            runCatching {
                val result = client.from<DailyActivity>("tracker_daily_activity")
                    .select()
                    .eq("user_id", userId)
                    .gte("day", startDate)
                    .lte("day", endDate)
                    .order("day")
                    .execute()
                result.dataOrThrow() ?: emptyList()
            }
        }

    /** Slim tracker_data row for country aggregation — only the code column. */
    @Serializable
    data class CountryCodeRow(
        @SerialName("country_code") val countryCode: String? = null,
    )

    /**
     * Distinct ISO alpha-2 country codes recorded in the range. A dedicated
     * one-column projection (not the capped [fetchPoints] list, which keeps
     * only the newest 5000 rows and silently drops older countries on long
     * ranges) — feeds the countries count and the world map.
     *
     * Exact via keyset pagination: rows are ordered by `country_code` and each
     * query fetches exactly one row strictly greater than the last code seen,
     * so the loop costs one small request per distinct country regardless of
     * how many thousands of points sit in between. (The previous newest-first
     * paged scan stopped early once recent pages repeated the home country and
     * never reached older trips abroad, undercounting on long ranges.)
     */
    suspend fun fetchCountryCodes(
        userId: String,
        startDate: String,
        endDate: String,
    ): Result<List<String>> =
        cache.withCache("countries3:$userId:$startDate:$endDate", ListSerializer(String.serializer())) {
            runCatching {
                val codes = mutableListOf<String>()
                var lastCode: String? = null
                // Safety cap — more than any traveled set of countries.
                while (codes.size < 250) {
                    var query = client.from<CountryCodeRow>("tracker_data")
                        .select("country_code")
                        .eq("user_id", userId)
                        .gte("recorded_at", "${startDate}T00:00:00Z")
                        .lte("recorded_at", "${endDate}T23:59:59Z")
                        .order("country_code", ascending = true)
                    lastCode?.let { query = query.gt("country_code", it) }
                    val row = query.limit(1).execute().dataOrThrow()?.firstOrNull() ?: break
                    // NULLs sort last in PostgreSQL ASC order and are excluded
                    // by `gt` — a null here means every code has been seen.
                    val code = row.countryCode?.trim()?.uppercase()?.takeIf { it.isNotEmpty() } ?: break
                    codes += code
                    lastCode = code
                }
                codes.sorted()
            }
        }

    companion object {
        const val PAGE_SIZE = 1000

        /** Row ceiling for range sampling — bounds requests, payload and heap. */
        const val MAX_SAMPLED_ROWS = 20_000

        /** Render/stat ceiling after sampling (web parity for map polylines). */
        const val MAP_MAX_POINTS = 5_000

        /**
         * Start offsets of the sampling windows over a range of [total] rows
         * (DESC ordering): uniformly spaced, first pinned to the oldest rows,
         * last pinned to `total - PAGE_SIZE` so the newest rows are always
         * included despite integer-division drift. Public-invariant: the
         * windows' union covers the whole range whenever total ≤
         * [MAX_SAMPLED_ROWS] (neighbouring windows then overlap or touch).
         */
        fun windowOffsets(total: Long, pageSize: Int = PAGE_SIZE, maxSampled: Int = MAX_SAMPLED_ROWS): List<Int> {
            if (total <= 0) return emptyList()
            val fetchRows = minOf(total, maxSampled.toLong()).toInt()
            val windows = (fetchRows + pageSize - 1) / pageSize
            if (windows <= 1) return listOf(0)
            val span = (total - pageSize).coerceAtLeast(0)
            return (0 until windows).map { w ->
                if (w == windows - 1) span.toInt() else (w.toLong() * span / (windows - 1)).toInt()
            }
        }
    }

    /**
     * Activity calendar via RPC (server-side aggregation over
     * tracker_daily_activity) — the same call the web heatmap uses. Covers a
     * trailing window of [days] regardless of the selected range, so the
     * 12-week grid always has data even when the range is narrower.
     */
    suspend fun getActivityCalendar(
        userId: String,
        days: Int = 371,
    ): Result<List<DailyActivity>> =
        withRpcAuthRetry(client, arbiter) {
        cache.withCacheList("calendar:$userId", DailyActivity.serializer()) {
            runCatching {
                val res = client.rpc.invoke(
                    "activity-calendar",
                    mapOf(
                        "user_id" to userId,
                        "days" to days,
                    ),
                    io.github.nimbleflux.fluxbase.rpc.RpcInvokeOptions(namespace = "wayli"),
                )
                res.error?.let { error(it.message ?: "activity-calendar failed") }
                parseCalendarRows(res.data?.result)
            }
        }
        }

    /**
     * RPC results arrive as a JsonElement that may be an array of rows, a
     * JSON-encoded string, or nested — unwrap defensively (the web app does
     * the same).
     */
    private fun parseCalendarRows(result: kotlinx.serialization.json.JsonElement?): List<DailyActivity> {
        val element = when (result) {
            null -> return emptyList()
            is kotlinx.serialization.json.JsonPrimitive ->
                runCatching { kotlinx.serialization.json.Json.parseToJsonElement(result.content) }
                    .getOrElse { return emptyList() }
            else -> result
        }
        val array = when (element) {
            is kotlinx.serialization.json.JsonArray -> element
            is kotlinx.serialization.json.JsonObject ->
                element["result"] as? kotlinx.serialization.json.JsonArray
                    ?: element["rows"] as? kotlinx.serialization.json.JsonArray
                    ?: return emptyList()
            else -> return emptyList()
        }
        return array.mapNotNull { row ->
            runCatching {
                kotlinx.serialization.json.Json.decodeFromJsonElement(DailyActivity.serializer(), row)
            }.getOrNull()
        }
    }
}

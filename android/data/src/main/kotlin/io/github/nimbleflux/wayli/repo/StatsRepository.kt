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
    private suspend fun pageTrackerData(
        userId: String,
        startDate: String,
        endDate: String,
        maxRows: Int,
    ): List<TrackerPoint> {
        val all = mutableListOf<TrackerPoint>()
        var offset = 0
        while (offset < maxRows) {
            val result = client.from<TrackerPoint>("tracker_data")
                .select()
                .eq("user_id", userId)
                .gte("recorded_at", "${startDate}T00:00:00Z")
                .lte("recorded_at", "${endDate}T23:59:59Z")
                .order("recorded_at", ascending = false)
                .range(offset, offset + PAGE_SIZE - 1)
                .execute()
            val batch = result.dataOrThrow()
            if (batch == null || batch.isEmpty()) {
                break
            }
            all += batch
            if (batch.size < PAGE_SIZE) break
            offset += PAGE_SIZE
        }
        return all.reversed() // back to chronological order
    }

    private suspend fun fetchPointsLive(
        userId: String,
        startDate: String,
        endDate: String,
    ): Result<List<TrackerPoint>> = runCatching {
        // Two pages is plenty for on-device aggregation (modes, countries
        // fallback, local-day heat): the year-long heatmap comes from the
        // server-side calendar RPC, and track rendering uses fetchTrack.
        pageTrackerData(userId, startDate, endDate, maxRows = 2 * PAGE_SIZE)
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

    private companion object {
        const val PAGE_SIZE = 1000
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

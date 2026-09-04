package io.github.nimbleflux.wayli.tracking

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import io.github.nimbleflux.wayli.db.PendingPointDao
import io.github.nimbleflux.wayli.gps.TrackingConfigStore
import io.github.nimbleflux.wayli.session.DeviceTokenStore
import io.github.nimbleflux.wayli.session.InstanceManager
import io.github.nimbleflux.wayli.sync.OwnTracksPayloadMapper
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.serialization.json.Json

/**
 * Drains the pending-point queue: batches up to [BATCH_SIZE] points, POSTs
 * them to the `owntracks-points` function authenticated with the device
 * token (`Authorization: Bearer wayli_dt_…` — never in the URL), and deletes
 * the batch on success.
 *
 * Retries with WorkManager's exponential backoff; points that exhausted
 * [MAX_ATTEMPTS] uploads are dropped so the queue can't clog.
 */
@HiltWorker
class GpsUploadWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val dao: PendingPointDao,
    private val deviceTokenStore: DeviceTokenStore,
    private val instanceManager: InstanceManager,
    private val diagnostics: io.github.nimbleflux.wayli.repo.TrackingDiagnosticsRepository,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val token = deviceTokenStore.token
        val instanceUrl = instanceManager.getConfig()?.url
        if (token == null || instanceUrl == null) {
            // Credentials are auto-provisioned (see NavViewModel/RecordingViewModel);
            // if they're not ready yet, retry until the device token lands.
            return if (runAttemptCount < MAX_RUN_ATTEMPTS) Result.retry() else Result.failure()
        }
        return drain("$instanceUrl/api/v1/functions/owntracks-points/invoke?namespace=wayli", token)
    }

    private suspend fun drain(endpoint: String, token: String): Result {
        // Points that exhausted their attempts are gone for good — count them
        // so the diagnostics surface can show the loss instead of hiding it.
        val dropped = dao.dropExhausted(MAX_ATTEMPTS)
        if (dropped > 0) diagnostics.onPointsDropped(dropped)

        val batch = dao.takeBatch(BATCH_SIZE)
        if (batch.isEmpty()) return Result.success()

        val payload = Json.encodeToString(
            kotlinx.serialization.json.JsonObject.serializer(),
            OwnTracksPayloadMapper.toPayload(batch),
        )

        val outcome = when (val post = postPoints(endpoint, token, payload)) {
            is PostResult.Success -> {
                dao.deleteByIds(batch.map { it.id })
                "ok" to post.code
            }
            is PostResult.Retryable -> {
                dao.bumpAttempts(batch.map { it.id })
                "retry" to post.code
            }
            is PostResult.Fatal -> "fatal" to post.code
        }
        diagnostics.logUpload(
            io.github.nimbleflux.wayli.repo.UploadLogEntry(
                atMs = System.currentTimeMillis(),
                batch = batch.size,
                outcome = outcome.first,
                httpCode = outcome.second,
                queuedAfter = dao.count(),
            ),
        )

        return when (outcome.first) {
            "ok" -> if (batch.size == BATCH_SIZE) Result.retry() else Result.success()
            "retry" -> if (runAttemptCount < MAX_RUN_ATTEMPTS) Result.retry() else Result.failure()
            else -> Result.failure()
        }
    }

    private fun postPoints(endpoint: String, token: String, payload: String): PostResult {
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                if (instanceManager.getConfig()?.insecureTls == true) {
                    io.github.nimbleflux.wayli.session.InsecureTls.applyTo(this)
                }
                requestMethod = "POST"
                connectTimeout = 15_000
                readTimeout = 30_000
                doOutput = true
                setRequestProperty("Authorization", "Bearer $token")
                setRequestProperty("Content-Type", "application/json")
            }
            connection.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }
            when (val code = connection.responseCode) {
                in 200..299 -> PostResult.Success(code)
                401, 403, 400, 404 -> PostResult.Fatal(code) // bad token/payload — retrying won't help
                else -> PostResult.Retryable(code)
            }
        } catch (e: Exception) {
            PostResult.Retryable(null) // network error — backoff and retry
        } finally {
            connection?.disconnect()
        }
    }

    private sealed class PostResult {
        data class Success(val code: Int) : PostResult()
        data class Retryable(val code: Int?) : PostResult()
        data class Fatal(val code: Int) : PostResult()
    }

    companion object {
        const val UNIQUE_NAME = "wayli-gps-upload"
        const val BATCH_SIZE = 100
        const val MAX_ATTEMPTS = 10 // per-point upload attempts before dropping
        const val MAX_RUN_ATTEMPTS = 6 // WorkManager runAttemptCount cap
    }
}

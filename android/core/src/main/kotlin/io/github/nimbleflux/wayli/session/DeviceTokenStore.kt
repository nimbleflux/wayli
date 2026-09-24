package io.github.nimbleflux.wayli.session

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Stores the device's active GPS-tracking token, encrypted at rest.
 *
 * The plaintext `wayli_dt_…` token is generated on-device, registered with
 * the server (which stores only its SHA-256 hash), and kept here so the
 * upload worker can authenticate point submissions with the
 * `X-Device-Token: <token>` header. Revoking the token clears this store.
 */
class DeviceTokenStore(context: Context) {
    private val prefs: SharedPreferences = run {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "wayli-device-token",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    val token: String? get() = prefs.getString(KEY_TOKEN, null)
    val tokenId: String? get() = prefs.getString(KEY_ID, null)
    val label: String? get() = prefs.getString(KEY_LABEL, null)

    /** True when this device holds a token it can submit points with. */
    val isActive: Boolean get() = token != null

    fun save(token: String, id: String, label: String) {
        prefs.edit()
            .putString(KEY_TOKEN, token)
            .putString(KEY_ID, id)
            .putString(KEY_LABEL, label)
            .apply()
    }

    fun clear() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val KEY_TOKEN = "token"
        private const val KEY_ID = "token_id"
        private const val KEY_LABEL = "label"
    }
}

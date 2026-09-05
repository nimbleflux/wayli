package io.github.nimbleflux.wayli.di

import android.content.Context
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import io.github.nimbleflux.fluxbase.FluxbaseClient
import io.github.nimbleflux.fluxbase.FluxbaseClientOptions
import io.github.nimbleflux.wayli.session.EncryptedStorageAdapter
import io.github.nimbleflux.wayli.session.InstanceManager
import javax.inject.Singleton

/**
 * Hilt DI module providing the [FluxbaseClient] and related singletons.
 *
 * The client is configured with the instance URL + anon key stored by
 * [InstanceManager] (set during onboarding). If no instance is configured yet,
 * the client is not created and the user is directed to the instance setup flow.
 */
@Module
@InstallIn(SingletonComponent::class)
object FluxbaseModule {

    @Provides
    @Singleton
    fun provideInstanceManager(@ApplicationContext context: Context): InstanceManager =
        InstanceManager(context)

    @Provides
    @Singleton
    fun provideDemoManager(@ApplicationContext context: Context): io.github.nimbleflux.wayli.demo.DemoManager =
        io.github.nimbleflux.wayli.demo.DemoManager(context)

    @Provides
    @Singleton
    fun provideThemeManager(@ApplicationContext context: Context): io.github.nimbleflux.wayli.designsystem.ThemeManager =
        io.github.nimbleflux.wayli.designsystem.ThemeManager(context)

    @Provides
    @Singleton
    fun provideTrackingConfigStore(@ApplicationContext context: Context): io.github.nimbleflux.wayli.gps.TrackingConfigStore =
        io.github.nimbleflux.wayli.gps.TrackingConfigStore(context)

    @Provides
    @Singleton
    fun provideDeviceTokenStore(@ApplicationContext context: Context): io.github.nimbleflux.wayli.session.DeviceTokenStore =
        io.github.nimbleflux.wayli.session.DeviceTokenStore(context)

    @Provides
    @Singleton
    fun provideEncryptedStorageAdapter(@ApplicationContext context: Context): EncryptedStorageAdapter =
        EncryptedStorageAdapter(context)

    @Provides
    @Singleton
    fun provideRefreshGate(): io.github.nimbleflux.wayli.session.RefreshGate =
        io.github.nimbleflux.wayli.session.RefreshGate()

    @Provides
    @Singleton
    fun provideFluxbaseClient(
        storage: EncryptedStorageAdapter,
        instanceManager: InstanceManager,
        refreshGate: io.github.nimbleflux.wayli.session.RefreshGate,
    ): FluxbaseClient {
        val config = instanceManager.getConfig()
            ?: return FluxbaseClient.create(
                url = "http://localhost:0",
                key = "unconfigured",
                options = FluxbaseClientOptions(
                    storage = storage,
                    autoRefresh = false,
                ),
            )
        // Self-signed instance: relax TLS before any engine (SDK OkHttp,
        // Coil) builds its connection factory. Hostname verification stays
        // strict for every other host.
        if (config.insecureTls) {
            io.github.nimbleflux.wayli.session.InsecureTls.hostOf(config.url)?.let {
                io.github.nimbleflux.wayli.session.InsecureTls.installGlobalFor(it)
            }
        }
        val client = FluxbaseClient.create(
            url = config.url,
            key = config.anonKey,
            options = FluxbaseClientOptions(
                storage = storage,
                // OFF: the SDK's internal refresh loop is uncontrolled — with an
                // expired/bricked token it spun refresh attempts at its 1s floor,
                // feeding the server's auth_refresh rate limiter (a 429-per-second
                // flood that masked the real 401). Proactive refreshing is
                // SessionRefresher's job (5-min cadence, pre-expiry, backoff,
                // cooldown gate); demand-driven refresh uses the rate-limit-aware
                // callback below.
                autoRefresh = false,
            ),
        )
        // Replace the SDK's reactive refresh-on-401 callback with a
        // rate-limit-aware one: during a cooldown the refresh is skipped (the
        // request retries with the current token and fails through with its
        // own error) and a 429 arms the shared cooldown instead of hammering
        // the server's auth_refresh limiter into a deeper hole.
        client.http.setRefreshTokenCallback {
            if (refreshGate.isCoolingDown()) {
                null
            } else {
                val result = client.auth.refreshSession()
                if (io.github.nimbleflux.wayli.session.isRateLimitedError(result.error)) {
                    refreshGate.onRateLimited()
                }
                result.data?.accessToken
            }
        }
        return client
    }
}

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
    alias(libs.plugins.detekt)
}

android {
    // JVM unit tests touch android.util.Log (SessionArbiter) — no-op it.
    testOptions { unitTests { isReturnDefaultValues = true } }

    namespace = "io.github.nimbleflux.wayli"
    compileSdk = 37
    // Pinned so local and CI symbol packaging match exactly (the NDK is only
    // used for native debug-symbol extraction — there is no NDK source).
    ndkVersion = "28.2.13676358"

    defaultConfig {
        applicationId = "com.nimbleflux.wayli"
        minSdk = 26
        targetSdk = 36
        // Release builds stamp these via -PversionName/-PversionCode
        // (see .github/workflows/release.yml publish-android).
        versionCode = providers.gradleProperty("versionCode").orNull?.toInt() ?: 1
        versionName = providers.gradleProperty("versionName").orNull ?: "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    flavorDimensions += "distribution"
    productFlavors {
        create("gplay") {
            dimension = "distribution"
            // Google Play flavor: may use Google Play Services
        }
        create("foss") {
            dimension = "distribution"
            // FOSS flavor: zero proprietary dependencies (F-Droid eligible)
        }
    }

    buildTypes {
        debug { }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            // Embed native symbol tables (function names) in the AAB so Play
            // Console can symbolicate native crashes (MapLibre,
            // androidx.graphics.path). FULL would add line info but bloat the
            // bundle; our native libs are third-party and stripped, so
            // SYMBOL_TABLE is the effective maximum anyway.
            ndk {
                debugSymbolLevel = "SYMBOL_TABLE"
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            // Signing: read keystore from env vars (CI) or gradle.properties (local).
            // For local release builds, create a debug-compatible keystore or
            // set WAYLI_KEYSTORE_FILE, WAYLI_KEYSTORE_PASSWORD, WAYLI_KEY_ALIAS,
            // WAYLI_KEY_PASSWORD in ~/.gradle/gradle.properties.
            // CI passes an EMPTY env when no keystore secret is configured —
            // treat blank as absent so the unsigned fallback build still works.
            val keystoreFile = (
                providers.gradleProperty("wayli.keystore.file").orNull
                    ?: System.getenv("WAYLI_KEYSTORE_FILE")
                )?.trim()?.takeIf { it.isNotBlank() }
            if (keystoreFile != null) {
                // PKCS12 keystores use a single password for store and key,
                // so accept either secret when only one is configured.
                val storePwd = providers.gradleProperty("wayli.keystore.password").orNull
                    ?: System.getenv("WAYLI_KEYSTORE_PASSWORD")
                    ?: System.getenv("WAYLI_KEY_PASSWORD")
                val keyPwd = providers.gradleProperty("wayli.key.password").orNull
                    ?: System.getenv("WAYLI_KEY_PASSWORD")
                    ?: System.getenv("WAYLI_KEYSTORE_PASSWORD")
                signingConfig = signingConfigs.create("release") {
                    storeFile = file(keystoreFile)
                    storePassword = storePwd
                    keyAlias = providers.gradleProperty("wayli.key.alias").orNull
                        ?: System.getenv("WAYLI_KEY_ALIAS")
                    keyPassword = keyPwd
                }
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    kotlin {
        jvmToolchain(21)
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    defaultConfig {
        buildConfigField(
            "String",
            "FLUXBASE_KOTLIN_VERSION",
            "\"${libs.versions.fluxbase.kotlin.get()}\"",
        )
    }
}

dependencies {
    implementation(project(":core"))
    implementation(project(":data"))
    implementation(project(":gps-engine"))
    implementation(project(":sensors"))

    // Compose
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)

    // Markdown (journal entry bodies) — parser only; rendering is Compose.
    implementation(libs.commonmark)
    implementation(libs.commonmark.ext.strikethrough)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.lifecycle.runtime.compose)
    debugImplementation(libs.compose.ui.tooling)

    // Navigation
    implementation(libs.navigation.compose)

    // Hilt
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)
    implementation(libs.hilt.work)
    ksp(libs.hilt.androidx.compiler)

    // WorkManager
    implementation(libs.work.runtime)

    // Fluxbase SDK
    implementation(libs.fluxbase.kotlin)

    // Kotlinx
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.datetime)

    // Image loading (Coil + SVG support for logo)
    implementation(libs.coil.compose)
    implementation(libs.coil.svg)

    // MapLibre (needed in :app for WayliApplication.onCreate initialization)
    implementation(libs.maplibre.android)

    // Testing
    testImplementation(libs.kotlin.test)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.mockk)
    testImplementation(libs.turbine)

    // gplay-only dependencies
    "gplayImplementation"(libs.play.services.location)
}

detekt {
    buildUponDefaultConfig = true
    config.setFrom(files("$rootDir/detekt.yml"))
}

plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "io.github.nimbleflux.wayli.core"
    compileSdk = 35

    defaultConfig {
        minSdk = 26
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
    }
}

dependencies {
    api("androidx.core:core-ktx:1.19.0")
    api("androidx.security:security-crypto:1.1.0")
    api(libs.kotlinx.serialization.json)
    api(libs.kotlinx.datetime)
    api(libs.fluxbase.kotlin)

    // MapLibre (FOSS map rendering — no Google deps)
    api(libs.maplibre.android)

    // Compose (design system composables)
    api(platform(libs.compose.bom))
    api(libs.compose.ui)
    api(libs.compose.ui.graphics)
    api(libs.compose.ui.tooling.preview)
    api(libs.compose.material3)
    api(libs.compose.material.icons)

    // Testing
    testImplementation(libs.kotlin.test)
}

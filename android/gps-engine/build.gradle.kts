plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
}

android {
    namespace = "io.github.nimbleflux.wayli.gps"
    compileSdk = 37

    defaultConfig {
        minSdk = 26
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

}

// Built-in Kotlin (AGP 9): compiler options live on the top-level kotlin
// extension; jvmTarget defaults to android.compileOptions.targetCompatibility.
kotlin {
    jvmToolchain(21)
}

dependencies {
    api(project(":core"))
    api(libs.kotlinx.coroutines.android)

    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)

    // Testing
    testImplementation(libs.kotlin.test)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
}

// AGP 9.1's built-in Kotlin defaults to KGP 2.2.10, whose compiler cannot
// read the Kotlin 2.4.0 metadata that fluxbase-kotlin ≥2026.9.3 carries.
// Pin KGP 2.3.20 (one-minor metadata-forward: reads 2.4.x) and the aligned
// KSP 2.3.12 (no 2.4-line KSP exists yet). Must precede the plugins block.
buildscript {
    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.20")
        classpath("com.google.devtools.ksp:symbol-processing-gradle-plugin:2.3.12")
    }
}

plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.hilt) apply false
    alias(libs.plugins.ksp) apply false
    alias(libs.plugins.detekt) apply false
}

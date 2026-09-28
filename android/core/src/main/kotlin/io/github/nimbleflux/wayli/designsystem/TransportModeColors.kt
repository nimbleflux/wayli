package io.github.nimbleflux.wayli.designsystem

import androidx.compose.ui.graphics.Color

/**
 * Transport mode colors — mirrors web/src/lib/utils/colors.ts exactly.
 * These are the canonical palette shared between the web and Android apps.
 *
 * DB keys: stationary|walking|cycling|car|train|airplane|boat|swimming.
 */
object TransportModeColors {
    val car = Color(0xFFDC2626) // red
    val train = Color(0xFF7C3AED) // purple
    val airplane = Color(0xFF0EA5E9) // sky blue
    val cycling = Color(0xFFEA580C) // orange
    val walking = Color(0xFF16A34A) // green
    val boat = Color(0xFF0369A1) // deep teal-blue
    val swimming = Color(0xFF06B6D4) // cyan
    val stationary = Color(0xFF6B7280) // grey
    val unknown = Color(0xFF6B7280) // grey (same as stationary)

    /** Look up a color by mode name, falling back to [unknown]. */
    fun forMode(mode: String?): Color = when (mode?.replace("transport.", "")) {
        "car" -> car
        "train" -> train
        "airplane" -> airplane
        "cycling" -> cycling
        "walking" -> walking
        "boat" -> boat
        "swimming" -> swimming
        "stationary" -> stationary
        else -> unknown
    }

    /** `#RRGGBB` for MapLibre layers (MapTrack.color). */
    fun hexFor(mode: String?): String {
        val c = forMode(mode)
        return "#%02X%02X%02X".format(
            (c.red * 255).toInt(),
            (c.green * 255).toInt(),
            (c.blue * 255).toInt(),
        )
    }
}

/**
 * Trip plan item category colors — mirrors PLAN_CATEGORY_COLORS from the web.
 */
object PlanCategoryColors {
    val sightseeing = Color(0xFF3B82F6)
    val food = Color(0xFFF59E0B)
    val activity = Color(0xFF22C55E)
    val transport = Color(0xFF8B5CF6)
    val accommodation = Color(0xFFEC4899)
    val rest = Color(0xFF6B7280)
    val shopping = Color(0xFF14B8A6)
}

/**
 * Map element colors — mirrors MAP_COLORS from the web.
 */
object MapColors {
    val startMarker = Color(0xFF16A34A)
    val endMarker = Color(0xFFDC2626)
    val selectedMarker = Color(0xFFDC2626)
    val trackLine = Color(0xFF3B82F6)
    val highlight = Color(0xFF233869) // Wayli navy
    val homeMarker = Color(0xFF3B82F6)
    val visitedCountry = Color(0xFF3B82F6)
    val border = Color(0xFF1D4ED8)

}

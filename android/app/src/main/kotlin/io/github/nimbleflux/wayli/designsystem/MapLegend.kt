package io.github.nimbleflux.wayli.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * Compact map legend for transport-mode polylines — translucent surface,
 * color dot + label per mode, only the modes actually drawn.
 */
@Composable
fun MapLegend(
    colors: List<String>,
    modifier: Modifier = Modifier,
) {
    val entries = colors.mapNotNull { hex ->
        val label = when (hex) {
            TransportModeColors.hexFor("car") -> "Car"
            TransportModeColors.hexFor("train") -> "Train"
            TransportModeColors.hexFor("airplane") -> "Airplane"
            TransportModeColors.hexFor("cycling") -> "Cycling"
            TransportModeColors.hexFor("walking") -> "Walking"
            TransportModeColors.hexFor("running") -> "Running"
            TransportModeColors.hexFor("boat") -> "Boat"
            TransportModeColors.hexFor("swimming") -> "Swimming"
            else -> return@mapNotNull null
        }
        hex to label
    }.distinctBy { it.first }
    if (entries.isEmpty()) return

    Surface(
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
        tonalElevation = 2.dp,
        modifier = modifier,
    ) {
        Column(modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp)) {
            entries.forEach { (hex, label) ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    androidx.compose.foundation.layout.Box(
                        modifier = Modifier
                            .size(10.dp)
                            .background(Color(android.graphics.Color.parseColor(hex)), CircleShape),
                    )
                    Text(label, style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    }
}

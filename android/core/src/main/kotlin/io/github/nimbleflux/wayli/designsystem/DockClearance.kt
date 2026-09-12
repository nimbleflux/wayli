package io.github.nimbleflux.wayli.designsystem

import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Height the floating dock occupies above the navigation-bar inset
 * (12dp bottom margin + ~84dp pill). This is CONTENT clearance: scrollables
 * pad their end by [rememberDockClearance] so the last item can scroll fully
 * clear of the dock, while mid-scroll content streams beneath it.
 */
val DockClearance = 96.dp

/**
 * Bottom clearance (navigation-bar inset + dock height) for use as
 * contentPadding on scrollables, FAB offsets, and snackbar offsets —
 * never as a viewport margin (that would reintroduce the dead strip
 * beneath the content).
 */
@Composable
fun rememberDockClearance(): Dp =
    WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + DockClearance

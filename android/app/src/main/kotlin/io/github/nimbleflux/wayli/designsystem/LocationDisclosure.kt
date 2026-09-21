package io.github.nimbleflux.wayli.designsystem

import android.content.Context
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink

/** Public privacy policy; linked from the disclosure and used in Play Console. */
private const val PRIVACY_POLICY_URL = "https://github.com/nimbleflux/wayli/blob/main/PRIVACY.md"

private const val PREFS_FILE = "wayli-permissions"
private const val PREF_ACCEPTED = "location_disclosure_accepted"

/**
 * Google Play prominent disclosure for location data (User Data policy).
 * Names the data (precise location), the purpose (location history, trip
 * detection), and that collection continues in the background, and requires
 * an affirmative accept/decline — it must be shown immediately before any
 * location runtime permission request.
 */
@Composable
private fun LocationDisclosureDialog(onAccept: () -> Unit, onDecline: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDecline,
        title = { Text("Location access") },
        text = {
            Text(
                buildAnnotatedString {
                    append(
                        "Wayli collects precise location data to record your location history " +
                            "and detect your trips — including when the app is closed or not in " +
                            "use — and syncs it to the Wayli server you connect it to. Your " +
                            "location data stays on your own server and is not shared with " +
                            "third parties. ",
                    )
                    withLink(
                        LinkAnnotation.Url(
                            PRIVACY_POLICY_URL,
                            TextLinkStyles(
                                style = SpanStyle(
                                    color = MaterialTheme.colorScheme.primary,
                                    textDecoration = TextDecoration.Underline,
                                ),
                            ),
                        ),
                    ) {
                        append("Privacy policy")
                    }
                    append(".")
                },
            )
        },
        confirmButton = { TextButton(onClick = onAccept) { Text("Accept") } },
        dismissButton = { TextButton(onClick = onDecline) { Text("Decline") } },
    )
}

/**
 * Gate for location runtime permission requests. The returned wrapper runs
 * its continuation only after the prominent disclosure has been accepted
 * (once, app-wide, persisted in SharedPreferences); declining or dismissing
 * the disclosure never launches the request.
 */
@Composable
fun rememberLocationDisclosureGate(): (() -> Unit) -> Unit {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE) }
    var pending by remember { mutableStateOf<(() -> Unit)?>(null) }

    val next = pending
    if (next != null) {
        LocationDisclosureDialog(
            onAccept = {
                prefs.edit().putBoolean(PREF_ACCEPTED, true).apply()
                pending = null
                next()
            },
            onDecline = { pending = null },
        )
    }

    return { continuation ->
        if (prefs.getBoolean(PREF_ACCEPTED, false)) {
            continuation()
        } else {
            pending = continuation
        }
    }
}

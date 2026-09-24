# Wayli Privacy Policy

Wayli is a privacy-first, self-hostable location tracking and trip analysis app. This policy describes what data the Wayli Android app and web app access and collect, and what happens to it.

_Last updated: September 24, 2026_

## What the app collects

- **Precise location data** (GPS/network position: latitude, longitude, altitude, speed, heading, accuracy) — collected to record your location history, detect trips and transport modes, and compute travel statistics. With tracking enabled, collection continues while the app is closed or not in use, through a notification-visible tracking service.
- **Activity recognition data** (Android, Play Store flavor) — motion-based signals (e.g. detecting driving vs. walking) used to adapt tracking frequency. The detected activity type is stored with each recorded point and uploaded to your Wayli server alongside it.
- **Battery level and a per-device identifier** — stored with each recorded point so you can tell devices apart and diagnose tracking problems.
- **Account data** — the credentials (e.g. email/password or OAuth identity) you use to sign in to your Wayli server.
- **Content you create** — trips, journal entries, photos, wishlist places, and other data you enter or attach. Photos are stored on your Wayli server's storage; who can fetch a photo depends on your instance's storage configuration (by default, anyone with the link).

## Where your data goes

Your recorded data is stored and processed by **the Wayli server you connect the app to** — typically one you self-host (see [github.com/nimbleflux/wayli](https://github.com/nimbleflux/wayli)). Wayli operates no central cloud for your location history.

A small number of auxiliary services are involved by default or by configuration:

| Service | What it receives | When |
|---|---|---|
| **Wayli hosted geocoder** (`pelias.wayli.app`, operated by the Wayli developers) | Place-search text from the app's search field, and coordinates for reverse-geocoding (turning recorded points into place names). | By default, for every recorded point and place search. Self-hosters can configure their own [Pelias](https://pelias.io) instance instead (instance setting or `PELIAS_ENDPOINT`). |
| **Wayli hosted map matching** (`valhalla.wayli.app`) | Raw GPS traces, to snap them to roads and confirm transport modes. | Only when you enable track snapping / transport-mode confirmation. Can be pointed at a self-hosted [Valhalla](https://github.com/valhalla/valhalla) instead. |
| **OpenFreeMap** (`tiles.openfreemap.org`) | Map tile and style requests, which reveal your IP address and the map region you view. | Whenever a map is displayed in the app or the web app. |
| **The AI provider configured on your instance** (optional feature) | Short summaries of your place visits (place name, city, visit counts, time-of-day patterns) are embedded for semantic search by the AI assistant. Documents are tagged with your user id, and retrieval is scoped to your account. | Only if your instance enables the AI assistant and configures an embedding provider. |

**Self-hosting note:** the developer-operated services above are defaults, not requirements — a self-hosted instance can point geocoding and map matching at its own infrastructure and disable the AI features entirely.

## What the app does not do

- No advertising or ad SDKs.
- No third-party analytics or tracking SDKs.
- No sale of your data.

## Your control

- Tracking can be paused or stopped at any time from the app.
- Location permissions can be revoked at any time from Android system settings; the app then stops collecting location.
- You can export your data (JSON/GeoJSON) and browse, edit, or delete individual records in the web app's data editor.
- You can delete your account and all associated data yourself: **web app → Account Settings → Danger Zone**.

## Contact

Wayli is open-source software ([AGPL-3.0](https://github.com/nimbleflux/wayli)). For questions about this policy, open an issue at [github.com/nimbleflux/wayli](https://github.com/nimbleflux/wayli/issues).

When you self-host Wayli, you are the data controller for your instance; this policy covers the app's behavior on your device.

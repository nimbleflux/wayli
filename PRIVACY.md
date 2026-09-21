# Wayli Privacy Policy

Wayli is a privacy-first, self-hostable location tracking and trip analysis app. This policy describes what data the Wayli Android app accesses and collects, and what happens to it.

_Last updated: September 21, 2026_

## What the app collects

- **Precise location data** (GPS/network position) — collected to record your location history, detect trips and transport modes, and compute travel statistics. With tracking enabled, collection continues while the app is closed or not in use, through a notification-visible tracking service.
- **Activity recognition data** (Android only, Play Store flavor) — motion-based signals used solely to adapt tracking frequency (e.g. detecting driving vs. walking). This data is processed on-device and is not uploaded.
- **Account data** — the credentials (e.g. email/password or OAuth identity) you use to sign in to your Wayli server.
- **Content you create** — trips, journal entries, photos, wishlist places, and other data you enter or attach.

## Where your data goes

All data is stored and processed by **the Wayli server you connect the app to** — typically one you self-host (e.g. your own [Wayli](https://github.com/nimbleflux/wayli) deployment). Wayli operates no central cloud: the app developers never receive, see, or store your location data.

Geocoding (turning coordinates into place names) is performed through the geocoder configured on your own server, by default the self-hosted open-source [Pelias](https://pelias.io) — keeping location lookups off commercial services.

## What the app does not do

- No advertising or ad SDKs.
- No third-party analytics or tracking SDKs.
- No sharing or sale of your data to third parties.
- No data transfer to the Wayli developers or any server other than the one you configure.

## Your control

- Tracking can be paused or stopped at any time from the app.
- Location permissions can be revoked at any time from Android system settings; the app then stops collecting location.
- You can export or delete your data through the app and your server (JSON/GeoJSON/CSV export, data editor).

## Contact

Wayli is open-source software ([AGPL-3.0](https://github.com/nimbleflux/wayli)). For questions about this policy, open an issue at [github.com/nimbleflux/wayli](https://github.com/nimbleflux/wayli/issues).

When you self-host Wayli, you are the data controller for your instance; this policy covers the app's behavior on your device.

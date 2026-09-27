-- One-off backfill for trips.image_url damage from the pre-2.7.1 host-rename
-- repair, which stripped https://<host> from ALL stored URLs — including
-- external Pexels CDN image URLs. Trip image suggestions hotlink Pexels by
-- design (never uploaded to trip-images), so the stripped refs resolved as
-- bucket paths and rendered <base>/api/v1/storage/trip-images//photos/<id>/…,
-- a 404. Renderers (web 2.7.2+, Android) heal this shape at render time; this
-- script also restores the stored values for API consumers.
--
-- Also flips the trip-images bucket to public-read on instances seeded
-- private by earlier Fluxbase versions (fresh installs got public=false,
-- so every resolved public URL — avatars, covers, gallery photos — 404'd;
-- wayli#219). The bucket's documented contract is public-read. Fluxbase
-- 2026.9.9+ (fluxbase#364) declares it via storage.default_public_buckets
-- and heals this on boot — this statement covers instances not yet on that
-- release.
--
-- Idempotent: only touches values matching the damaged shape / a private
-- trip-images row; safe to re-run.
--
-- Run once per environment (see schema/README.md):
--   kubectl exec -i <postgres-pod> -- psql -U <user> -d <db> \
--     < fluxbase/schema/backfill-trip-image-urls.sql

BEGIN;

UPDATE trips
   SET image_url = 'https://images.pexels.com' || image_url
 WHERE image_url ~ '^/photos/[0-9]+/';

UPDATE storage.buckets
   SET public = true
 WHERE name = 'trip-images'
   AND public = false;

COMMIT;

-- Verification (expect 0 damaged refs; trip-images public = t):
--   SELECT count(*) FROM trips WHERE image_url ~ '^/photos/[0-9]+/';
--   SELECT name, public FROM storage.buckets WHERE name = 'trip-images';

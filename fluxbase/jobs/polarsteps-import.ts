/**
 * Polarsteps Import Job
 *
 * Imports a Polarsteps data export (user_data.zip) into Wayli.
 * Creates trips, journal entries, GPS data, and uploads photos.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 1800
 * @fluxbase:memory 1024
 * @fluxbase:allow-net true
 * @fluxbase:allow-read true
 * @fluxbase:allow-write true
 * @fluxbase:allow-env true
 */

// @ts-types="npm:@types/jszip"
import JSZip from 'npm:jszip@3.10.1';

import type { FluxbaseClient, JobUtils } from './types';

interface PolarstepsLocation {
  lat: number;
  lon: number;
  time: number;
}

interface PolarstepsStep {
  id: number;
  name: string;
  description: string;
  start_time: number;
  end_time: number | null;
  slug: string;
  uuid: string;
}

interface PolarstepsTrip {
  id: number;
  name: string;
  start_date: number;
  end_date: number;
  total_km: number;
  cover_photo_path: string;
  timezone_id: string;
  all_steps: PolarstepsStep[];
  uuid: string;
}

interface Payload {
  storagePath: string;
}

function safeReportProgress(job: JobUtils, percent: number, message: string): void {
  try {
    job.reportProgress(percent, message);
  } catch {
    console.log(`[Progress ${percent}%] ${message}`);
  }
}

// Fix storage URLs: replace internal cluster address with public URL
function publicStorageUrl(internalUrl: string): string {
  const publicBase = Deno.env.get('FLUXBASE_PUBLIC_BASE_URL');
  if (publicBase && internalUrl.includes('://')) {
    // Replace the host portion with the public base URL
    const url = new URL(internalUrl);
    const publicUrl = new URL(publicBase);
    return `${publicUrl.origin}${url.pathname}${url.search}`;
  }
  return internalUrl;
}

/**
 * Upload a photo to the trip-images bucket and return its public URL. Retries
 * on explicit upload error.
 *
 * Mirrors the working frontend upload path (trip-media.service.ts /
 * image-upload.service.ts): trust the upload result and resolve the public URL.
 * A previous version verified via storage.list(), but that was unreliable —
 * list() returns basenames while storagePath is a full nested path, so the
 * comparison was always false and every photo was silently skipped.
 */
async function uploadPhotoWithVerify(
  fluxbase: FluxbaseClient,
  bucket: 'trip-images',
  storagePath: string,
  data: Blob | Uint8Array,
  contentType: string,
  upsert = false,
  maxAttempts = 3
): Promise<string | null> {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: contentType });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { error: uploadErr } = await fluxbase.storage
      .from(bucket)
      .upload(storagePath, blob, { contentType, upsert });

    if (uploadErr) {
      console.warn(`[polarsteps] upload attempt ${attempt}/${maxAttempts} failed for ${storagePath}:`, uploadErr);
      // Brief backoff before retrying.
      await new Promise((r) => setTimeout(r, 500 * attempt));
      continue;
    }

    // Upload succeeded — resolve the public URL (same as the frontend upload).
    const { data: urlData } = fluxbase.storage.from(bucket).getPublicUrl(storagePath);
    return publicStorageUrl(urlData.publicUrl);
  }

  return null;
}

function unixToISO(ts: number): string {
  return new Date(ts * 1000).toISOString();
}

function dateFromUnix(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

export async function handler(
  _req: Request,
  fluxbase: FluxbaseClient,
  fluxbaseService: FluxbaseClient,
  job: JobUtils
) {
  try {
    return await doImport(fluxbase, fluxbaseService, job);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[polarsteps-import] FATAL:', msg);
    if (error instanceof Error && error.stack) console.error(error.stack);
    try {
      job.reportProgress(0, `Import failed: ${msg}`);
    } catch {}
    throw error;
  }
}

async function doImport(fluxbase: FluxbaseClient, fluxbaseService: FluxbaseClient, job: JobUtils) {
  const ctx = job.getJobContext();
  const userId = ctx.user?.id;
  if (!userId) throw new Error('No user ID in job context');

  const payload = ctx.payload as Payload;
  if (!payload?.storagePath) throw new Error('No storagePath in payload');

  safeReportProgress(job, 5, 'Downloading export file...');

  // Download the zip file from storage
  const fileResponse = await fluxbaseService.storage
    .from('temp-files')
    .download(payload.storagePath);
  if (!fileResponse.data) throw new Error('Failed to download export file');

  const zipData = await fileResponse.data.arrayBuffer();
  safeReportProgress(job, 10, 'Extracting archive...');

  // Extract zip using JSZip (pure JS, no subprocess)
  const zip = await JSZip.loadAsync(zipData);
  const files = new Map<string, Uint8Array>();
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const data = await entry.async('uint8array');
    files.set(path, data);
  }

  // Helper to read a text file from the extracted zip
  function readZipText(path: string): string | null {
    for (const [zipPath, data] of files) {
      if (zipPath === path || zipPath.endsWith(`/${path}`)) {
        return new TextDecoder().decode(data);
      }
    }
    return null;
  }

  // Find files matching a regex pattern
  function findZipFiles(pattern: RegExp): Array<{ path: string; data: Uint8Array }> {
    const results: Array<{ path: string; data: Uint8Array }> = [];
    for (const [path, data] of files) {
      if (pattern.test(path)) {
        results.push({ path, data });
      }
    }
    return results;
  }

  safeReportProgress(job, 15, 'Reading trip data...');

  // Find all trip.json files
  const tripJsonFiles = findZipFiles(/trip\/[^/]+\/trip\.json$/);

  if (tripJsonFiles.length === 0) {
    safeReportProgress(job, 100, 'No trips found in export');
    return { success: true, tripsImported: 0, message: 'No trips found' };
  }

  let tripsImported = 0;
  let tripsMerged = 0;
  let entriesCreated = 0;
  let gpsPointsImported = 0;
  let photosUploaded = 0;
  let photosSkipped = 0;

  for (let i = 0; i < tripJsonFiles.length; i++) {
    const tripFile = tripJsonFiles[i];
    const progress = 15 + Math.round((i / tripJsonFiles.length) * 75);

    // Parse trip.json
    let tripJson: PolarstepsTrip;
    try {
      tripJson = JSON.parse(new TextDecoder().decode(tripFile.data));
    } catch {
      console.log(`Skipping unparseable trip.json: ${tripFile.path}`);
      continue;
    }

    safeReportProgress(
      job,
      progress,
      `Importing trip ${i + 1}/${tripJsonFiles.length}: ${tripJson.name}`
    );

    // Extract trip directory prefix (e.g., "trip/japan_16579360/")
    const tripDirPrefix = tripFile.path.replace(/trip\.json$/, '');

    const startDate = dateFromUnix(tripJson.start_date);
    const endDate = dateFromUnix(tripJson.end_date);

    // Check for existing trip (merge by title + date overlap)
    const existingTrip = await findExistingTrip(
      fluxbase,
      userId,
      tripJson.name,
      startDate,
      endDate
    );
    let tripId: string;
    let isNewTrip = false;
    let tripImageUrl: string | null = null;

    if (existingTrip) {
      tripId = existingTrip;
      tripsMerged++;
      // Fetch existing trip's cover to avoid overwriting
      const { data: existingTripData } = await fluxbase
        .from('trips')
        .select('image_url')
        .eq('id', existingTrip)
        .single();
      tripImageUrl = (existingTripData as any)?.image_url ?? null;

      // If the existing trip has no cover (e.g. a previous import failed to
      // download it), retry now rather than leaving it blank forever.
      if (!tripImageUrl && tripJson.cover_photo_path) {
        try {
          const recovered = await downloadAndUploadPhoto(
            fluxbase,
            tripJson.cover_photo_path,
            userId,
            'covers',
            `polarsteps-cover-${tripId}.jpg`
          );
          if (recovered) {
            tripImageUrl = recovered;
            await fluxbase.from('trips').update({ image_url: recovered }).eq('id', tripId);
            console.log(`[polarsteps] Recovered missing cover for trip ${tripId}`);
          }
        } catch (err) {
          console.warn(`[polarsteps] Cover recovery failed for trip ${tripId}:`, err);
        }
      }
      safeReportProgress(job, progress, `Merging into existing trip: ${tripJson.name}`);
    } else {
      isNewTrip = true;

      // Try to download cover photo from Polarsteps S3
      if (tripJson.cover_photo_path) {
        try {
          tripImageUrl = await downloadAndUploadPhoto(
            fluxbase,
            tripJson.cover_photo_path,
            userId,
            'covers',
            `polarsteps-cover-${tripJson.id}.jpg`
          );
        } catch {
          console.log(`Cover photo download failed for trip ${tripJson.name}`);
        }
      }

      const { data: newTrip, error: tripError } = await fluxbase
        .from('trips')
        .insert({
          user_id: userId,
          title: tripJson.name,
          start_date: startDate,
          end_date: endDate,
          status: 'completed',
          visibility: 'private',
          image_url: tripImageUrl,
          metadata: {
            distanceTraveled: Math.round((tripJson.total_km ?? 0) * 1000),
            importedFrom: 'polarsteps',
            polarstepsId: tripJson.id,
            polarstepsUuid: tripJson.uuid,
            visitedCountryCodes: [
              ...new Set(
                (tripJson.all_steps ?? []).map((s: any) => s.location?.country_code).filter(Boolean)
              )
            ],
            visitedCitiesDetailed: (tripJson.all_steps ?? [])
              .filter((s: any) => s.location?.lat && s.location?.lon)
              .map((s: any) => ({
                city: s.location?.name || '',
                country: s.location?.country || '',
                countryCode: s.location?.country_code || '',
                lat: s.location?.lat,
                lng: s.location?.lon
              })),
            primaryCity: (tripJson.all_steps ?? [])[1]?.location?.name || '',
            primaryCountryCode: (tripJson.all_steps ?? [])[1]?.location?.country_code || ''
          }
        })
        .select('id')
        .single();

      if (tripError || !newTrip) {
        console.log(`Failed to create trip ${tripJson.name}: ${tripError?.message}`);
        continue;
      }

      tripId = (newTrip as any).id;
      tripsImported++;
    }

    // Import journal entries (steps) + photos
    const steps = tripJson.all_steps ?? [];
    console.log(
      `[polarsteps] Trip "${tripJson.name}" has ${steps.length} steps, isNewTrip=${isNewTrip}`
    );

    // Fetch existing photo filenames for dedup (merge case). Also verify each
    // existing row's storage object is actually accessible — stale rows that
    // point at missing files (orphans from a prior failed import) are deleted
    // so the photo gets re-uploaded instead of silently skipped.
    const existingPhotoNames = new Set<string>();
    if (!isNewTrip) {
      try {
        const { data: existingMedia } = await fluxbase
          .from('trip_media')
          .select('id, storage_path')
          .eq('trip_id', tripId);
        for (const m of (existingMedia as any[]) ?? []) {
          const fn = (m.storage_path || '').split('/').pop();
          if (!fn) continue;
          // Verify the object exists; if not, remove the orphan row so the
          // photo is re-uploaded rather than skipped.
          const { error: headErr } = await fluxbase.storage
            .from('trip-images')
            .download((m.storage_path || '').replace(/^.*\/trip-images\//, ''));
          if (headErr) {
            console.log(`[polarsteps] Removing orphan trip_media row (file missing): ${fn}`);
            await fluxbase.from('trip_media').delete().eq('id', m.id);
            continue;
          }
          existingPhotoNames.add(fn);
        }
      } catch {
        // non-critical
      }
    }

    let firstPhotoUrl: string | null = null;
    // Set when this step created the entry (vs. attaching to an existing
    // one) — only then is it safe to write blocks wholesale.
    let createdEntryHere = false;

    for (const step of steps) {
      const entryDate = dateFromUnix(step.start_time);

      // Find or create entry
      let entryId: string | null = null;

      if (!isNewTrip) {
        const { data: existing } = await fluxbase
          .from('trip_entries')
          .select('id, cover_media_id')
          .eq('trip_id', tripId)
          .eq('entry_date', entryDate)
          .limit(1);
        if (existing && existing.length > 0) {
          entryId = (existing[0] as any).id;
        }
      }

      if (!entryId) {
        const entryPayload = {
          trip_id: tripId,
          user_id: userId,
          title: step.name || '',
          body: step.description || '',
          entry_date: entryDate
        };

        const { data: entryData, error: entryError } = await fluxbase
          .from('trip_entries')
          .insert(entryPayload)
          .select('id')
          .single();

        if (entryError || !entryData) {
          console.error(
            `[polarsteps] Entry insert failed for "${step.name}":`,
            JSON.stringify(entryError)
          );
          continue;
        }
        entryId = (entryData as any).id;
        createdEntryHere = true;
        entriesCreated++;
      }

      // Upload photos for this step
      const photoFiles = findZipFiles(
        new RegExp(`${tripDirPrefix}[^/]*${step.id}[^/]*/photos/.+\\.jpg`, 'i')
      );

      if (photoFiles.length > 0) {
        console.log(
          `[polarsteps] Step "${step.name}" (${step.id}): found ${photoFiles.length} photo(s)`
        );
      }

      let firstPhotoMediaId: string | null = null;
      const stepMediaIds: string[] = [];

      for (const photoFile of photoFiles) {
        try {
          const photoName = photoFile.path.split('/').pop() || `photo-${Date.now()}.jpg`;

          // Skip if photo already exists (dedup for merge case)
          if (existingPhotoNames.has(photoName)) {
            photosSkipped++;
            continue;
          }

          const storagePath = `${userId}/${tripId}/${photoName}`;

          // Verified upload: only proceed once the object is confirmed
          // present in storage. This prevents orphaned trip_media rows that
          // point at objects which 404 (silent upload failures).
          const publicUrl = await uploadPhotoWithVerify(
            fluxbase,
            'trip-images',
            storagePath,
            photoFile.data,
            'image/jpeg',
            false
          );

          if (!publicUrl) {
            photosSkipped++;
            continue;
          }

          const { data: mediaData, error: mediaErr } = await fluxbase
            .from('trip_media')
            .insert({
              trip_id: tripId,
              user_id: userId,
              entry_id: entryId,
              storage_path: publicUrl,
              thumbnail_path: publicUrl,
              media_type: 'image',
              caption: '',
              sort_order: photosUploaded
            })
            .select('id')
            .single();

          if (mediaErr || !mediaData) {
            // Media row failed — clean up the now-orphaned storage object so
            // we don't leave bytes with no metadata (the inverse orphan).
            try {
              await fluxbase.storage.from('trip-images').remove([storagePath]);
            } catch {
              // best-effort cleanup
            }
            photosSkipped++;
            continue;
          }

          existingPhotoNames.add(photoName);
          photosUploaded++;

          const mediaId = (mediaData as any).id;
          if (!firstPhotoMediaId) firstPhotoMediaId = mediaId;
          if (!firstPhotoUrl) firstPhotoUrl = publicUrl;
          stepMediaIds.push(mediaId);
        } catch {
          photosSkipped++;
        }
      }

      // Set entry cover from first photo if entry has no cover
      if (firstPhotoMediaId) {
        try {
          await fluxbase
            .from('trip_entries')
            .update({ cover_media_id: firstPhotoMediaId })
            .eq('id', entryId)
            .is('cover_media_id', null);
        } catch {
          // non-critical
        }
      }

      // Write the block structure for entries created by this import: an
      // optional text block from the step description + one photo block.
      // Pre-existing entries are left alone (blocks stays NULL → clients
      // derive from body + media).
      if (createdEntryHere) {
        const stepBlocks: Array<Record<string, unknown>> = [];
        const description = (step.description || '').trim();
        if (description) {
          stepBlocks.push({ t: 'text', md: description });
        }
        if (stepMediaIds.length > 0) {
          stepBlocks.push({ t: 'photos', ids: stepMediaIds });
        }
        if (stepBlocks.length > 0) {
          try {
            await fluxbase
              .from('trip_entries')
              .update({ blocks: { v: 1, blocks: stepBlocks } })
              .eq('id', entryId)
              .is('blocks', null);
          } catch {
            // non-critical — clients derive from body + media
          }
        }
      }
    }

    // Trip cover fallback: if no cover from Polarsteps S3, use first uploaded photo
    if (!tripImageUrl && firstPhotoUrl) {
      tripImageUrl = firstPhotoUrl;
      try {
        await fluxbase.from('trips').update({ image_url: firstPhotoUrl }).eq('id', tripId);
      } catch {
        // non-critical
      }
    }

    // Import GPS data from locations.json
    const locationsText = readZipText(`${tripDirPrefix}locations.json`);
    if (locationsText) {
      try {
        const parsed = JSON.parse(locationsText);
        const locations: PolarstepsLocation[] = parsed.locations ?? [];

        if (locations.length > 0) {
          safeReportProgress(
            job,
            progress,
            `Importing ${locations.length} GPS points for ${tripJson.name}`
          );

          const batchSize = 500;
          for (let j = 0; j < locations.length; j += batchSize) {
            const batch = locations.slice(j, j + batchSize);
            const rows = batch.map((loc) => ({
              user_id: userId,
              tracker_type: 'polarsteps',
              recorded_at: unixToISO(loc.time),
              location: { type: 'Point', coordinates: [loc.lon, loc.lat] },
              country_code: null,
              speed: null,
              distance: 0,
              time_spent: 0
            }));
            await fluxbase.from('tracker_data').insert(rows);
            gpsPointsImported += batch.length;
          }
        }
      } catch {
        console.log(`Failed to parse locations.json for trip ${tripJson.name}`);
      }
    }
  }

  // Reset the per-user incremental-processing watermarks after a successful
  // GPS import: place-visit detection and transport-mode labeling keep a
  // last-processed timestamp per user, and imported points usually predate
  // it — without the reset they would never be processed. Deleting the state
  // rows makes the next incremental run rebuild that user from scratch.
  // Best-effort (service role: RLS allows only service/admin) — a failed
  // reset must not fail the import.
  if (gpsPointsImported > 0) {
    for (const table of ['place_visits_state', 'transport_mode_state']) {
      try {
        const { error: resetError } = await fluxbaseService
          .from(table)
          .delete()
          .eq('user_id', userId);
        if (resetError) {
          console.warn(`[polarsteps] Failed to reset ${table} watermark:`, resetError);
        } else {
          console.log(`[polarsteps] Reset ${table} watermark for user ${userId}`);
        }
      } catch (resetErr) {
        console.warn(`[polarsteps] Error resetting ${table} watermark:`, resetErr);
      }
    }
  }

  console.log(
    `[polarsteps] Import complete: ${tripsImported} new, ${tripsMerged} merged, ${entriesCreated} entries, ${photosUploaded} photos uploaded, ${photosSkipped} photos skipped, ${gpsPointsImported} GPS points`
  );

  safeReportProgress(job, 100, 'Import complete!');

  return {
    success: true,
    tripsImported,
    tripsMerged,
    entriesCreated,
    gpsPointsImported,
    photosUploaded,
    photosSkipped
  };
}

// ── Helpers ──

async function findExistingTrip(
  fluxbase: FluxbaseClient,
  userId: string,
  title: string,
  startDate: string,
  endDate: string
): Promise<string | null> {
  const { data } = await fluxbase
    .from('trips')
    .select('id, title, start_date, end_date')
    .eq('user_id', userId)
    .ilike('title', title);

  if (!data || data.length === 0) return null;

  for (const trip of data as any[]) {
    const existingStart = trip.start_date?.slice(0, 10);
    const existingEnd = trip.end_date?.slice(0, 10);
    if (existingStart && existingEnd) {
      const overlapStart = existingStart > startDate ? existingStart : startDate;
      const overlapEnd = existingEnd < endDate ? existingEnd : endDate;
      if (overlapStart <= overlapEnd) return trip.id;
    }
  }

  return null;
}

async function downloadAndUploadPhoto(
  fluxbase: FluxbaseClient,
  url: string,
  userId: string,
  subFolder: string,
  filename: string
): Promise<string | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn(`[polarsteps] Failed to download photo (HTTP ${resp.status}): ${url}`);
      return null;
    }

    const blob = await resp.blob();
    const path = `${userId}/${subFolder}/${filename}`;

    // upsert: true so re-imports don't silently fail on key collision (the
    // old upsert: false meant a second import of the same trip would skip the
    // cover photo because the storage object already existed). Verified so a
    // transient "successful" upload that didn't register is retried/caught.
    return await uploadPhotoWithVerify(
      fluxbase,
      'trip-images',
      path,
      blob,
      blob.type || 'image/jpeg',
      true
    );
  } catch (err) {
    console.warn(`[polarsteps] downloadAndUploadPhoto error for ${url}:`, err);
    return null;
  }
}

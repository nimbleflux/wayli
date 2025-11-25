/**
 * Import GPS data from GPX format
 *
 * Processes uploaded GPX files, extracting track points, routes, and waypoints
 * and importing them into the tracker_data table.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:timeout 1800
 * @fluxbase:allow-read true
 */

import {
	getCountryForPoint,
	normalizeCountryCode,
	applyTimezoneCorrectionToTimestamp,
	getTimezoneDifferenceForPoint
} from '../../src/lib/services/external/country-reverse-geocoding.service';

interface DataImportPayload {
	storagePath: string;
	format: string;
	fileName: string;
}

export async function handler(request: Request) {
	const context = Fluxbase.getJobContext();
	const payload = context.payload as DataImportPayload;
	const jobId = context.job_id;
	const userId = context.user?.id;

	if (!userId) {
		return {
			success: false,
			error: 'No user context available'
		};
	}

	try {
		// Download file from storage using Fluxbase global API
		const { data: fileData, error: downloadError } = await Fluxbase.storage
			.from('temp-files')
			.download(payload.storagePath);

		if (downloadError || !fileData) {
			throw new Error(`Failed to download file from storage: ${JSON.stringify(downloadError)}`);
		}

		const fileContent = await fileData.text();

		// Execute import with progress tracking
		console.log('🗺️ Starting GPX import with progress tracking');

		const parser = new (await import('fast-xml-parser')).XMLParser({
			ignoreAttributes: false,
			attributeNamePrefix: '@_'
		});

		const gpxData = parser.parse(fileContent);
		const tracks = ensureArray(gpxData.gpx?.trk ?? []);
		const waypoints = ensureArray(gpxData.gpx?.wpt ?? []);

		const totalItems = tracks.length + waypoints.length;
		let importedCount = 0;
		let skippedCount = 0;
		let errorCount = 0;

		console.log(`📊 GPX file contains:`);
		console.log(`   🎯 Waypoints: ${waypoints.length.toLocaleString()}`);
		console.log(`   🛤️ Tracks: ${tracks.length.toLocaleString()}`);
		console.log(`   📍 Total items: ${totalItems.toLocaleString()}`);

		Fluxbase.reportProgress(0, `🗺️ Processing ${totalItems.toLocaleString()} GPX items...`);

		const startTime = Date.now();

		// Waypoints
		console.log(`🎯 Processing ${waypoints.length.toLocaleString()} waypoints...`);
		for (let i = 0; i < waypoints.length; i++) {
			const waypoint = waypoints[i];
			const lat = parseFloat(waypoint['@_lat']);
			const lon = parseFloat(waypoint['@_lon']);

			if (isNaN(lat) || isNaN(lon) || lat === null || lon === null) {
				skippedCount++;
				console.log(`⚠️ Skipping waypoint ${i + 1}: invalid coordinates (lat: ${lat}, lon: ${lon})`);
				continue;
			}

			const countryCode = safeNormalizeCountryCode(safeGetCountryForPoint(lat, lon));
			let recordedAt = waypoint.time || new Date().toISOString();

			if (waypoint.time) {
				recordedAt = applyTimezoneCorrectionToTimestamp(waypoint.time, lat, lon);
			}

			const tzDiff = getTimezoneDifferenceForPoint(lat, lon);

			const geocodeFeature = {
				type: 'Feature',
				geometry: {
					type: 'Point',
					coordinates: [lon, lat]
				},
				properties: {
					name: waypoint.name || `GPX Waypoint ${i + 1}`,
					description: waypoint.desc || `Imported from ${payload.fileName}`,
					category: 'waypoint',
					import_source: 'gpx',
					data_type: 'waypoint',
					imported_at: new Date().toISOString()
				}
			};

			const { error } = await Fluxbase.database().from('tracker_data').upsert(
				{
					user_id: userId,
					tracker_type: 'import',
					location: `POINT(${lon} ${lat})`,
					recorded_at: recordedAt,
					country_code: countryCode,
					tz_diff: tzDiff,
					geocode: geocodeFeature,
					created_at: new Date().toISOString()
				} as any,
				{ onConflict: 'user_id,recorded_at', ignoreDuplicates: false }
			);

			if (!error) {
				importedCount++;
			} else {
				const err = error as { code?: string };
				if (err.code === '23505') skippedCount++;
				else {
					errorCount++;
					console.error(`❌ Error inserting waypoint ${i}:`, error);
				}
			}

			if (i % 10 === 0 || i === waypoints.length - 1) {
				const progress = Math.round((i / totalItems) * 100);
				Fluxbase.reportProgress(progress, `🎯 Processing GPX waypoints... ${i.toLocaleString()}/${waypoints.length.toLocaleString()}`);
			}
		}

		// Tracks
		console.log(`🛤️ Processing ${tracks.length.toLocaleString()} tracks...`);
		for (let i = 0; i < tracks.length; i++) {
			const track = tracks[i];
			const trackSegments = ensureArray(track?.trkseg ?? []);
			const trackPoints = trackSegments.flatMap((seg: { trkpt?: unknown[] }) =>
				ensureArray(seg?.trkpt ?? [])
			);
			console.log(`🛤️ Track ${i + 1}/${tracks.length}: ${trackPoints.length.toLocaleString()} points`);

			for (let j = 0; j < trackPoints.length; j++) {
				const point = trackPoints[j] as { '@_lat': string; '@_lon': string; time?: string };
				const lat = parseFloat(point['@_lat']);
				const lon = parseFloat(point['@_lon']);

				if (isNaN(lat) || isNaN(lon) || lat === null || lon === null) {
					skippedCount++;
					console.log(`⚠️ Skipping track point: invalid coordinates (lat: ${lat}, lon: ${lon})`);
					continue;
				}

				const countryCode = safeNormalizeCountryCode(safeGetCountryForPoint(lat, lon));
				let recordedAt = point.time || new Date().toISOString();

				if (point.time) {
					recordedAt = applyTimezoneCorrectionToTimestamp(point.time, lat, lon);
				}

				const tzDiff = getTimezoneDifferenceForPoint(lat, lon);

				const geocodeFeature = {
					type: 'Feature',
					geometry: {
						type: 'Point',
						coordinates: [lon, lat]
					},
					properties: {
						import_source: 'gpx',
						data_type: 'track_point',
						imported_at: new Date().toISOString()
					}
				};

				const { error } = await Fluxbase.database().from('tracker_data').upsert(
					{
						user_id: userId,
						tracker_type: 'import',
						location: `POINT(${lon} ${lat})`,
						recorded_at: recordedAt,
						country_code: countryCode,
						tz_diff: tzDiff,
						geocode: geocodeFeature,
						created_at: new Date().toISOString()
					} as any,
					{ onConflict: 'user_id,recorded_at', ignoreDuplicates: false, defaultToNull: false }
				);

				if (!error) importedCount++;
				else {
					const err = error as { code?: string };
					if (err.code === '23505') skippedCount++;
					else {
						errorCount++;
						console.error(`❌ Error inserting track point ${j} in track ${i}:`, error);
					}
				}
			}

			const progress = Math.round(((waypoints.length + i + 1) / totalItems) * 100);
			Fluxbase.reportProgress(progress, `🛤️ Processing GPX tracks... ${(i + 1).toLocaleString()}/${tracks.length.toLocaleString()}`);
		}

		const totalTime = (Date.now() - startTime) / 1000;
		console.log(`✅ GPX import completed!`);
		console.log(`📊 Final stats:`);
		console.log(`   📥 Imported: ${importedCount.toLocaleString()} points`);
		console.log(`   ⏭️ Skipped: ${skippedCount.toLocaleString()} points`);
		console.log(`   ❌ Errors: ${errorCount.toLocaleString()} points`);
		console.log(`   ⏱️ Total time: ${totalTime.toFixed(1)}s`);

		return {
			success: true,
			result: {
				importedCount,
				totalItems,
				fileName: payload.fileName,
				format: 'GPX'
			}
		};
	} catch (error: unknown) {
		console.error(`❌ Error in GPX import job:`, error);
		throw error;
	}
}

function safeGetCountryForPoint(lat: number, lon: number): string | null {
	try {
		return getCountryForPoint(lat, lon);
	} catch (e) {
		console.warn('Failed to get country for point:', e);
		return null;
	}
}

function safeNormalizeCountryCode(countryCode: string | null): string | null {
	try {
		return normalizeCountryCode(countryCode);
	} catch (e) {
		console.warn('Failed to normalize country code:', e);
		return null;
	}
}

function ensureArray<T>(value: T | T[] | undefined | null): T[] {
	if (value == null) return [] as T[];
	return Array.isArray(value) ? value : [value];
}

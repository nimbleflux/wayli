/**
 * Snap a GPS track to the road network via Valhalla.
 *
 * Powers the "Snap to roads" view toggle on the Location Data page: the client
 * sends the points currently in view (with their transport modes) and gets
 * back road-matched segments, one per transport-mode run, tagged with the mode
 * so the page can keep its mode-colored rendering. Pure view-layer — nothing
 * is persisted and tracker_data is never touched.
 *
 * Gated per-user by the road-snapping beta opt-in
 * (beta_features.valhalla_routes — account settings); a failed match for a
 * run falls back to that run's raw points so a partial Valhalla outage
 * degrades instead of erroring.
 *
 * Body: { "points": [{ "lat": number, "lng": number, "mode": string|null, "t"?: epoch-ms }] }
 * Response: { "matched": boolean, "segments": [{ "mode", "matched", "points":
 * [{lat,lng}], "bridge"?: true, "reason"?: "off-road-train"|"off-road-airplane" }] }
 *
 * Off-road rules: runs that cover a long distance at rail speed while sitting
 * far from any matched road are classified as train (beyond rail speed:
 * airplane), keep their RAW geometry and render in that mode's color — a
 * failed road match becomes a correct categorization. Consecutive runs are
 * joined by explicit bridge segments (flagged, rendered dashed/neutral) so no
 * movement is visually lost. The raw input points are never dropped from the
 * response — bridges only ADD connectors.
 *
 * @fluxbase:require-role authenticated
 * @fluxbase:allow-net true
 * @fluxbase:allow-env true
 * @fluxbase:timeout 60
 */

// The '_shared/…' import form resolves against server-side shared modules:
// `fluxbase functions sync` registers every FLAT file in functions/_shared/
// (nested directories are not picked up — that's why these copies live at the
// top level). The geometry + Valhalla client are mirrored copies of the jobs
// modules; keep them in sync with the jobs (and web) copies. The beta check
// below mirrors
// jobs/_shared/services/trip-route/trip-route.service.ts#isUserValhallaRoutesOptedIn.
import {
	assembleRouteSegments,
	classifyOffRoadRun,
	costingForRunMode,
	downsampleSegments,
	meanNearestDistanceMeters,
	POOR_MATCH_METERS,
	runKinematics,
	splitIntoModeRuns
} from '_shared/trip-route-geometry';
import { traceAttributes } from '_shared/valhalla';
import type { FluxbaseClient } from '../jobs/types';

/** Per-user road-snapping beta opt-in (beta_features.valhalla_routes). */
async function isUserValhallaRoutesOptedIn(
	fluxbase: FluxbaseClient,
	userId: string
): Promise<boolean> {
	try {
		const { data, error } = await fluxbase
			.from('user_preferences')
			.select('preferences')
			.eq('id', userId)
			.maybeSingle();
		if (error) return false;
		return (data as any)?.preferences?.beta_features?.valhalla_routes === true;
	} catch {
		return false;
	}
}

/** Bounds request size (and Valhalla work) — the UI narrows the range beyond this. */
const MAX_POINTS = 5000;

/** Bounds response size — snapped shapes are denser than the input trace. */
const MAX_RESPONSE_POINTS = 12000;

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

async function handler(
	req: Request,
	fluxbase: FluxbaseClient,
	_fluxbaseService: FluxbaseClient,
	_utils?: { getExecutionContext?: () => { user?: { id: string } } }
): Promise<Response> {
	const ctx = _utils?.getExecutionContext?.();
	if (!ctx?.user?.id) return json({ error: 'Unauthorized' }, 401);

	const body = await req.json().catch(() => null);
	const raw = Array.isArray((body as any)?.points) ? (body as any).points : null;
	if (!raw || raw.length < 2) {
		return json({ error: 'points array with at least 2 points required' }, 400);
	}
	if (raw.length > MAX_POINTS) {
		return json(
			{ error: `Too many points (${raw.length}) — narrow the range (max ${MAX_POINTS})` },
			400
		);
	}

	// Normalize + drop malformed points. `t` (epoch ms) is optional but
	// enables the off-road (train/plane) kinematic rules.
	const points: Array<{
		lat: number;
		lng: number;
		transport_mode: string | null;
		t?: number;
	}> = raw
		.map((p: any) => ({
			lat: Number(p?.lat),
			lng: Number(p?.lng),
			transport_mode: (p?.mode as string | null | undefined) ?? null,
			t: Number.isFinite(Number(p?.t)) ? Number(p?.t) : undefined
		}))
		.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
	if (points.length < 2) return json({ error: 'No valid points' }, 400);

	if (!(await isUserValhallaRoutesOptedIn(fluxbase, ctx.user.id))) {
		return json({ error: 'Road-snapping beta is not enabled for this account' }, 403);
	}

	const runs = splitIntoModeRuns(points);
	if (runs.length === 0) return json({ matched: false, segments: [] });

	// Per-run result before bridging. Rail/air runs and off-road-classified
	// runs (long distance at rail speed while far from any matched road —
	// almost always a train) keep their raw geometry and get relabeled, so
	// the failure-to-snap becomes a correct categorization instead.
	const runResults: Array<{
		mode: string | null;
		matched: boolean;
		points: Array<{ lat: number; lng: number }>;
		reason?: string;
	}> = [];
	let anyMatched = false;

	for (const run of runs) {
		let shape: Array<{ lat: number; lng: number }> = [];
		let matched = false;
		if (run.mode !== 'train' && run.mode !== 'airplane') {
			try {
				const result = await traceAttributes(
					run.points.map((p) => ({ lat: p.lat, lon: p.lng })),
					costingForRunMode(run.mode),
					fluxbase
				);
				shape = result.shape.map((s) => ({ lat: s.lat, lng: s.lon }));
				matched = result.matched && shape.length > 1;
			} catch (err) {
				console.warn(
					`[snap-track] Valhalla match failed for a ${run.mode ?? 'unknown'} run, using raw points:`,
					err instanceof Error ? err.message : err
				);
			}
		}

		let mode = run.mode;
		let reason: string | undefined;
		if (shape.length >= 2) {
			const kin = runKinematics(run.points);
			const deviation = meanNearestDistanceMeters(run.points, shape);
			const offRoad = classifyOffRoadRun(kin, !matched || deviation >= POOR_MATCH_METERS);
			if (offRoad) {
				mode = offRoad;
				reason = `off-road-${offRoad}`;
				shape = run.points.map((p) => ({ lat: p.lat, lng: p.lng }));
				matched = false;
			}
		} else {
			shape = run.points.map((p) => ({ lat: p.lat, lng: p.lng }));
		}

		if (matched) anyMatched = true;
		runResults.push({ mode, matched, points: shape, reason });
	}

	// Bridge run boundaries (end of one run → start of the next) so the view
	// reads as one connected track — no owner view zones here, every junction
	// gets its connector, flagged for dashed/neutral rendering. Non-bridge
	// segments keep their run's classification (assembled in run order).
	const assembled = assembleRouteSegments(runResults.map((r) => [r.points]));
	const merged: Array<{
		mode: string | null;
		matched: boolean;
		points: Array<{ lat: number; lng: number }>;
		bridge?: boolean;
		reason?: string;
	}> = [];
	let runIdx = 0;
	for (const seg of assembled) {
		if (seg.bridge) {
			merged.push({ mode: null, matched: false, points: seg.points, bridge: true });
		} else if (runIdx < runResults.length) {
			merged.push(runResults[runIdx++]);
		}
	}

	const thinned = downsampleSegments(
		merged.map((s) => s.points),
		MAX_RESPONSE_POINTS
	);
	return json({
		matched: anyMatched,
		segments: merged.map((s, i) => ({
			mode: s.mode,
			matched: s.matched,
			points: thinned[i],
			...(s.bridge ? { bridge: true } : {}),
			...(s.reason ? { reason: s.reason } : {})
		}))
	});
}

export default handler;

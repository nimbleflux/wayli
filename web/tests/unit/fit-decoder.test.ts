/**
 * FIT decoder unit tests
 *
 * Runs against a real activity file placed at the repo root
 * (260816195715.fit, a Bryton cycling ride). The file is personal data and is
 * git-ignored; the tests skip cleanly when it is not present.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
	decodeFitStream,
	recordSpeedToKmh,
	resolveSportTag,
	type FitFileId,
	type FitRecord,
	type FitSession
} from '../../../fluxbase/jobs/_shared/parsers/fit-decoder';

// Tests run from web/ via `bun run test:unit`; the fixture lives at the repo root.
const FIT_FILE = resolve(process.cwd(), '../260816195715.fit');
const fileAvailable = existsSync(FIT_FILE);

describe('recordSpeedToKmh unit correction', () => {
	it('passes km/h record speeds from affected manufacturers through', () => {
		// Bryton (255/267) writes the record speed field in km/h already.
		expect(recordSpeedToKmh(267, 32.2)).toBe(32.2);
		expect(recordSpeedToKmh(255, 36)).toBe(36);
	});

	it('converts standard m/s record speeds to the km/h column convention', () => {
		// Garmin (1) and unknown manufacturers follow the FIT profile (m/s).
		expect(recordSpeedToKmh(1, 8.94)).toBeCloseTo(32.18, 2);
		expect(recordSpeedToKmh(undefined, 10)).toBeCloseTo(36, 2);
	});
});

function streamFromFile(path: string, chunkSize = 4096): ReadableStream<Uint8Array> {
	const bytes = new Uint8Array(readFileSync(path));
	let position = 0;
	return new ReadableStream<Uint8Array>({
		pull(controller) {
			if (position >= bytes.length) {
				controller.close();
				return;
			}
			const end = Math.min(position + chunkSize, bytes.length);
			controller.enqueue(bytes.slice(position, end));
			position = end;
		}
	});
}

async function decodeFixture(chunkSize?: number) {
	const records: FitRecord[] = [];
	const sessions: FitSession[] = [];
	const fileIds: FitFileId[] = [];
	const result = await decodeFitStream(streamFromFile(FIT_FILE, chunkSize), {
		onRecord: (r) => records.push(r),
		onSession: (s) => sessions.push(s),
		onFileId: (f) => fileIds.push(f)
	});
	return { result, records, sessions, fileIds };
}

describe.skipIf(!fileAvailable)('fit-decoder (real Bryton activity file)', () => {
	it('decodes the file header', async () => {
		const { result } = await decodeFixture();
		expect(result.protocolVersion).toBe(0x10); // protocol 1.0
		expect(result.profileVersion).toBe(1010);
		expect(result.dataSize).toBe(158447);
		expect(result.totalBytes).toBe(158463);
	});

	it('decodes file_id with Bryton device info', async () => {
		const { fileIds } = await decodeFixture();
		expect(fileIds).toHaveLength(1);
		expect(fileIds[0].type).toBe(4); // activity
		expect(fileIds[0].manufacturer).toBe(267); // Bryton
		expect(fileIds[0].product).toBe(2101);
		expect(fileIds[0].serialNumber).toBe(5122);
		expect(fileIds[0].timeCreated).toBe('2026-08-16T17:57:14.000Z');
	});

	it('decodes all 4139 records with GPS', async () => {
		const { records } = await decodeFixture();
		expect(records).toHaveLength(4139);

		const withPosition = records.filter((r) => r.positionLat !== undefined);
		expect(withPosition.length).toBe(4139);

		const first = records[0];
		expect(first.timestamp).toBe('2026-08-16T17:57:40.000Z');
		expect(first.positionLat).toBeCloseTo(52.429106, 4);
		expect(first.positionLon).toBeCloseTo(5.0445, 3);

		const last = records[records.length - 1];
		expect(last.timestamp).toBe('2026-08-16T19:07:58.000Z');

		const lats = records.map((r) => r.positionLat!);
		const lons = records.map((r) => r.positionLon!);
		expect(Math.min(...lats)).toBeCloseTo(52.3813, 3);
		expect(Math.max(...lats)).toBeCloseTo(52.46498, 3);
		expect(Math.min(...lons)).toBeCloseTo(4.90573, 3);
		expect(Math.max(...lons)).toBeCloseTo(5.13736, 3);
	});

	it('decodes heart rate, power, and cadence ranges', async () => {
		const { records } = await decodeFixture();
		const hr = records.map((r) => r.heartRate).filter((v): v is number => v !== undefined);
		const power = records.map((r) => r.power).filter((v): v is number => v !== undefined);
		const cadence = records.map((r) => r.cadence).filter((v): v is number => v !== undefined);

		expect(hr.length).toBeGreaterThan(3000);
		expect(Math.min(...hr)).toBe(117);
		expect(Math.max(...hr)).toBe(170);

		expect(power.length).toBeGreaterThan(3000);
		expect(Math.max(...power)).toBe(777);

		expect(cadence.length).toBeGreaterThan(3000);
	});

	it('decodes the session summary with the real sport/sub_sport fields (#221)', async () => {
		const { sessions } = await decodeFixture();
		expect(sessions).toHaveLength(1);
		const session = sessions[0];
		// Session fields 5/6 carry sport/sub_sport per the FIT profile. This
		// Bryton ride declares sport=2 (cycling), sub_sport=8 (mountain).
		// (#221: the decoder used to read fields 0/1 — event/event_type — and
		// labelled this file american_football/treadmill.)
		expect(session.sport).toBe('cycling');
		expect(session.subSport).toBe('mountain');
		expect(session.totalDistanceM).toBeCloseTo(34245.34, 0);
		expect(session.totalElapsedTimeS).toBeCloseTo(4281.0, 1);
		expect(session.totalTimerTimeS).toBeCloseTo(4134.0, 1);
		expect(session.totalCalories).toBe(916);
		expect(session.avgSpeedMs).toBeCloseTo(8.283, 2);
		expect(session.maxSpeedMs).toBeCloseTo(10.876, 2);
		expect(session.avgHeartRate).toBe(153);
		expect(session.maxHeartRate).toBe(170);
		expect(session.avgCadence).toBe(87);
		expect(session.maxCadence).toBe(106);
		expect(session.avgPower).toBe(220);
		expect(session.maxPower).toBe(777);
		expect(session.startTime).toBe('2026-08-16T17:57:14.000Z');
	});

	it('resolves the sport tag from the data signature for anomalous sport bytes', async () => {
		const { sessions } = await decodeFixture();
		// Power + cadence data present → an implausible declared byte would be
		// a device quirk, not truth; the ride still resolves to cycling.
		expect(resolveSportTag({ ...sessions[0], sport: 'american_football' }, true, true)).toBe(
			'cycling'
		);
		// Plausible declared sports are kept as-is.
		expect(resolveSportTag({ sport: 'running' }, false, false)).toBe('running');
		expect(resolveSportTag({ sport: 'swimming' }, false, false)).toBe('swimming');
		// Implausible declared sport without riding sensors → generic fitness.
		expect(resolveSportTag({ sport: 'tennis' }, false, false)).toBe('fitness');
		// No session at all → inferred from speed.
		expect(resolveSportTag(null, false, false)).toBe('fitness');
		expect(resolveSportTag({ avgSpeedMs: 2.8 }, false, true)).toBe('running');
	});

	it('tolerates the mismatched CRCs with a warning instead of failing', async () => {
		const { result } = await decodeFixture();
		// The fixture was post-processed and carries stale CRCs.
		expect(result.crcOk).toBe(false);
		expect(result.warnings.some((w) => w.includes('CRC mismatch'))).toBe(true);
	});

	it('produces identical results for different chunk sizes', async () => {
		const full = await decodeFixture();
		const tiny = await decodeFixture(64);
		expect(tiny.records).toHaveLength(full.records.length);
		expect(tiny.records[0]).toEqual(full.records[0]);
		expect(tiny.records[4138]).toEqual(full.records[4138]);
	});

	it('rejects non-FIT data', async () => {
		const garbage = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array([13, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5]));
				controller.close();
			}
		});
		await expect(decodeFitStream(garbage, {})).rejects.toThrow(/header size|FIT/i);
	});
});

// ---------------------------------------------------------------------------
// Synthetic session-message tests (#221) — independent of the real fixture.
// FIT session (global message 18): field 0 = event, 1 = event_type,
// 5 = sport, 6 = sub_sport, 253 = message timestamp (uint32, FIT epoch s).
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
	const table = new Uint16Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0x1021 ^ (c >>> 1) : c >>> 1;
		table[n] = c & 0xffff;
	}
	return table;
})();

function crc16(bytes: Uint8Array): number {
	let crc = 0;
	for (const b of bytes) crc = (CRC_TABLE[((crc >> 8) ^ b) & 0xff] ^ (crc << 8)) & 0xffff;
	return crc;
}

/** Build a minimal but valid FIT file: one session definition + data message. */
function buildSessionFitFile(fields: Array<[number, number]>, values: number[]): Uint8Array {
	// Definition message for local 0: architecture little-endian, msg 18,
	// sport/sub_sport as enum (base type 0x00), timestamp as uint32 (0x86).
	const fieldDefs: Array<[number, number, number]> = fields.map(([num]) => [
		num,
		1,
		num === 253 ? 0x86 : 0x00
	]);
	fieldDefs[fieldDefs.length - 1] = [fields[fields.length - 1][0], 4, 0x86];

	const def: number[] = [0x40, 0x00, 0x00, 0x12, 0x00, fields.length];
	for (const [num, size, base] of fieldDefs) def.push(num, size, base);

	// Data message: timestamp is FIT epoch seconds (2026-01-01T00:00:00Z).
	const data: number[] = [0x00];
	let valueIndex = 0;
	for (const [num] of fields) {
		if (num === 253) {
			const ts = 1767225600;
			data.push(ts & 0xff, (ts >> 8) & 0xff, (ts >> 16) & 0xff, (ts >> 24) & 0xff);
		} else {
			data.push(values[valueIndex++]);
		}
	}

	const body = new Uint8Array([...def, ...data]);
	const header = new Uint8Array(14);
	header[0] = 14;
	header[1] = 0x10; // protocol 1.0
	header[2] = 0x10; // profile 1.10
	header[3] = 0x0a;
	new DataView(header.buffer).setUint32(4, body.length, true);
	header.set([0x2e, 0x46, 0x49, 0x54], 8);
	header.set([0x00, 0x00], 12); // header CRC optional

	const all = new Uint8Array([...header, ...body]);
	const crc = crc16(all);
	const out = new Uint8Array(all.length + 2);
	out.set(all);
	out[all.length] = crc & 0xff;
	out[all.length + 1] = (crc >> 8) & 0xff;
	return out;
}

async function decodeBytes(bytes: Uint8Array): Promise<FitSession[]> {
	const sessions: FitSession[] = [];
	await decodeFitStream(
		new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(bytes);
				controller.close();
			}
		}),
		{ onSession: (s) => sessions.push(s) }
	);
	return sessions;
}

describe('fit-decoder synthetic session messages (#221)', () => {
	it('reads sport/sub_sport from fields 5/6, not event/event_type (0/1)', async () => {
		// event=9 american_football-ish, event_type=1 — the pair the old decoder
		// misread as sport=american_football/sub_sport=treadmill. Declared
		// sport=11 (walking), sub_sport=3 (trail).
		const bytes = buildSessionFitFile(
			[
				[0, 1],
				[1, 1],
				[5, 11],
				[6, 3],
				[253, 0]
			],
			[9, 1, 11, 3, 0]
		);
		const sessions = await decodeBytes(bytes);
		expect(sessions).toHaveLength(1);
		expect(sessions[0].sport).toBe('walking');
		expect(sessions[0].subSport).toBe('trail');
	});

	it('leaves subSport undefined when the session has no sub_sport field', async () => {
		const bytes = buildSessionFitFile(
			[
				[5, 1],
				[253, 0]
			],
			[11, 0]
		);
		const sessions = await decodeBytes(bytes);
		expect(sessions).toHaveLength(1);
		expect(sessions[0].sport).toBe('walking');
		expect(sessions[0].subSport).toBeUndefined();
	});
});

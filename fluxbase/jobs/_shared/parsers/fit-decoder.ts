/**
 * FIT Binary Decoder
 *
 * Streaming decoder for the Garmin FIT activity file format
 * (https://developer.garmin.com/fit/protocol/).
 *
 * Pure TypeScript with zero imports, so the same code runs inside the Deno
 * import job and in Node-based unit tests.
 *
 * Design notes:
 * - Streams via a cursor-based rolling buffer; memory stays bounded by chunk
 *   size plus one message.
 * - Decodes only the messages Wayli needs (file_id, record, session). Every
 *   other message — including manufacturer-private ones such as Bryton's
 *   0xFF02 zone tables — is skipped using its definition length.
 * - CRCs are verified but only reported: files that were post-processed by
 *   third-party tools routinely carry stale CRCs, so a mismatch is a warning,
 *   never a hard failure.
 */

export interface FitRecord {
  timestamp?: string;
  positionLat?: number;
  positionLon?: number;
  altitudeM?: number;
  speedMs?: number;
  distanceM?: number;
  heartRate?: number;
  cadence?: number;
  power?: number;
  temperatureC?: number;
  headingDeg?: number;
}

export interface FitSession {
  timestamp?: string;
  sport?: string;
  subSport?: string;
  startTime?: string;
  totalElapsedTimeS?: number;
  totalTimerTimeS?: number;
  totalDistanceM?: number;
  totalCalories?: number;
  avgSpeedMs?: number;
  maxSpeedMs?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  avgPower?: number;
  maxPower?: number;
  avgCadence?: number;
  maxCadence?: number;
}

export interface FitFileId {
  type?: number;
  manufacturer?: number;
  product?: number;
  serialNumber?: number;
  timeCreated?: string;
}

export interface FitDecodeCallbacks {
  onRecord?: (record: FitRecord) => void;
  onSession?: (session: FitSession) => void;
  onFileId?: (fileId: FitFileId) => void;
  onProgress?: (bytesRead: number) => void;
  /** Awaited after each chunk so callers can flush buffered work mid-stream. */
  onDrain?: () => Promise<void> | void;
}

export interface FitDecodeResult {
  totalBytes: number;
  messageCount: number;
  recordCount: number;
  sessionCount: number;
  /** null when the stream was truncated so the check could not run */
  crcOk: boolean | null;
  protocolVersion: number;
  profileVersion: number;
  dataSize: number;
  warnings: string[];
}

export class FitDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FitDecodeError';
  }
}

// Global message numbers we decode; everything else is skipped.
const MSG_FILE_ID = 0;
const MSG_SESSION = 18;
const MSG_RECORD = 20;

/** FIT epoch: 1989-12-31T00:00:00Z in Unix milliseconds. */
const FIT_EPOCH_MS = 631065600000;
const SEMICIRCLE_TO_DEG = 180 / 2147483648;

// FIT sport enum → slug. 0 (generic) and anything unmapped become 'fitness'
// so every imported activity still carries a usable activity_type tag.
const SPORT_MAP: Record<number, string> = {
  1: 'running',
  2: 'cycling',
  3: 'transition',
  4: 'fitness_equipment',
  5: 'swimming',
  6: 'basketball',
  7: 'soccer',
  8: 'tennis',
  9: 'american_football',
  10: 'training',
  11: 'walking',
  12: 'cross_country_skiing',
  13: 'alpine_skiing',
  14: 'snowboarding',
  15: 'rowing',
  16: 'mountaineering',
  17: 'hiking',
  18: 'multisport',
  19: 'paddling',
  20: 'flying',
  21: 'e_biking',
  22: 'motorcycling',
  23: 'boating',
  24: 'driving',
  25: 'diving',
  26: 'flexibility_training',
  27: 'strength_training',
  28: 'warm_up',
  29: 'cooldown',
  31: 'indoor_cardio',
  32: 'social_dancing',
  35: 'ultra_running',
  36: 'indoor_running'
};

// FIT sub_sport enum → slug. 0 (generic) maps to undefined.
const SUB_SPORT_MAP: Record<number, string> = {
  1: 'treadmill',
  2: 'street',
  3: 'trail',
  4: 'track',
  5: 'spin',
  6: 'indoor_cycling',
  7: 'road',
  8: 'mountain',
  9: 'downhill',
  11: 'recumbent',
  12: 'cyclocross',
  13: 'hand_cycling',
  14: 'track_cycling',
  15: 'indoor_rowing',
  16: 'elliptical',
  17: 'stair_climbing',
  18: 'lap_swimming',
  19: 'open_water',
  20: 'gym',
  22: 'yard_games',
  23: 'platform_tennis',
  25: 'motor_pacing',
  26: 'bike_to_run',
  27: 'run_to_bike',
  29: 'indoor_snow_sport'
};

interface BaseTypeInfo {
  size: number;
  kind: 'uint' | 'sint' | 'float' | 'string' | 'bytes';
  /** z-types use 0 as the invalid sentinel instead of all-ones */
  zeroInvalid?: boolean;
}

const BASE_TYPES: Record<number, BaseTypeInfo> = {
  0: { size: 1, kind: 'uint' },
  1: { size: 1, kind: 'sint' },
  2: { size: 1, kind: 'uint' },
  3: { size: 2, kind: 'sint' },
  4: { size: 2, kind: 'uint' },
  5: { size: 4, kind: 'sint' },
  6: { size: 4, kind: 'uint' },
  7: { size: 1, kind: 'string' },
  8: { size: 4, kind: 'float' },
  9: { size: 8, kind: 'float' },
  10: { size: 1, kind: 'uint', zeroInvalid: true },
  11: { size: 2, kind: 'uint', zeroInvalid: true },
  12: { size: 4, kind: 'uint', zeroInvalid: true },
  13: { size: 1, kind: 'bytes' },
  14: { size: 8, kind: 'sint' },
  15: { size: 8, kind: 'uint' }
};

interface FieldDef {
  number: number;
  size: number;
  baseType: number;
}

interface MessageDefinition {
  localType: number;
  littleEndian: boolean;
  globalMessageNumber: number;
  fields: FieldDef[];
  payloadSize: number;
}

const CRC_TABLE = (() => {
  const table = new Uint16Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0x1021 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c & 0xffff;
  }
  return table;
})();

/** CRC-16/XMODEM as required by the FIT spec. */
class Crc16 {
  private crc = 0;

  update(bytes: Uint8Array, start: number, end: number): void {
    for (let i = start; i < end; i++) {
      this.crc =
        (CRC_TABLE[((this.crc >> 8) ^ bytes[i]) & 0xff] ^ ((this.crc & 0xff) << 8)) & 0xffff;
    }
  }

  get value(): number {
    return this.crc;
  }
}

/**
 * Sports a GPS computer is extremely unlikely to have recorded while the file
 * also contains cycling/running sensor data. Some devices (observed on Bryton
 * cycling computers) write a bogus sport byte in the session message — e.g.
 * american_football for a ride — so the tag is inferred from the data instead.
 */
const IMPLAUSIBLE_SPORTS = new Set([
  'basketball',
  'soccer',
  'tennis',
  'american_football',
  'platform_tennis',
  'yard_games',
  'social_dancing'
]);

/**
 * Resolve the activity_type tag for an imported activity. Prefers the sport
 * declared in the FIT session; falls back to a data-signature inference when
 * the declared sport is missing or implausible for the recorded sensors.
 */
export function resolveSportTag(
  session: FitSession | null,
  hasPowerData: boolean,
  hasCadenceData: boolean
): string {
  const declared = session?.sport;
  if (declared && declared !== 'generic' && !IMPLAUSIBLE_SPORTS.has(declared)) {
    return declared;
  }

  if (hasPowerData) return 'cycling';

  if (hasCadenceData && session?.avgSpeedMs !== undefined) {
    if (session.avgSpeedMs >= 5) return 'cycling';
    if (session.avgSpeedMs >= 1.6) return 'running';
  }

  if (session?.avgSpeedMs !== undefined) {
    if (session.avgSpeedMs >= 5) return 'cycling';
    if (session.avgSpeedMs >= 1.6) return 'running';
    if (session.avgSpeedMs > 0) return 'walking';
  }

  return 'fitness';
}

/**
 * Manufacturers whose devices write the record speed field in km/h instead of
 * the FIT-profile-mandated m/s (observed on Bryton cycling computers: session
 * summary speeds are standard m/s, per-record speeds are km/h — both use the
 * same ×1000 scale, only the unit differs).
 */
const KMH_RECORD_SPEED_MANUFACTURERS = new Set([255, 267]);

/**
 * Convert a decoded record speed to the km/h convention used by the
 * tracker_data.speed column (the distance trigger derives/overwrites it in
 * km/h; the input value only survives on sub-second-gap rows).
 */
export function recordSpeedToKmh(manufacturer: number | undefined, decodedSpeed: number): number {
  if (manufacturer !== undefined && KMH_RECORD_SPEED_MANUFACTURERS.has(manufacturer)) {
    return decodedSpeed;
  }
  return decodedSpeed * 3.6;
}

const textDecoder = new TextDecoder('utf-8');

/**
 * Decode a FIT file from a stream. Throws FitDecodeError for structurally
 * broken files (bad magic, undefined local message types); tolerates data-level
 * oddities with warnings.
 */
export async function decodeFitStream(
  stream: ReadableStream<Uint8Array>,
  callbacks: FitDecodeCallbacks
): Promise<FitDecodeResult> {
  const decoder = new FitStreamDecoder(callbacks);
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length > 0) {
        decoder.push(value);
      }
      if (callbacks.onDrain) {
        await callbacks.onDrain();
      }
    }
  } finally {
    reader.releaseLock();
  }
  return decoder.finish();
}

class FitStreamDecoder {
  private readonly callbacks: FitDecodeCallbacks;
  /** Unconsumed bytes; the next message starts at buf[offset]. */
  private buf = new Uint8Array(0);
  private offset = 0;
  private state: 'header' | 'messages' | 'done' = 'header';

  /** Absolute file offset of the next unconsumed byte. */
  private pos = 0;
  /** Absolute offset up to which bytes have been fed into the data CRC. */
  private crcFedTo = 0;
  private totalBytes = 0;

  private headerSize = 0;
  private protocolVersion = 0;
  private profileVersion = 0;
  private dataSize = 0;
  /** Absolute offset where the data section ends (headerSize + dataSize). */
  private dataEnd = Number.MAX_SAFE_INTEGER;
  private dataCrc = new Crc16();
  private crcOk: boolean | null = null;

  private definitions = new Map<number, MessageDefinition>();
  private lastTimestamp: number | null = null;

  private messageCount = 0;
  private recordCount = 0;
  private sessionCount = 0;
  private readonly warnings: string[] = [];

  constructor(callbacks: FitDecodeCallbacks) {
    this.callbacks = callbacks;
  }

  push(chunk: Uint8Array): void {
    this.totalBytes += chunk.length;

    // Compact consumed bytes so repeated appends stay linear.
    const leftover = this.buf.length - this.offset;
    const merged = new Uint8Array(leftover + chunk.length);
    merged.set(this.buf.subarray(this.offset), 0);
    merged.set(chunk, leftover);
    this.buf = merged;
    this.offset = 0;

    this.processBuffer();
    this.callbacks.onProgress?.(this.totalBytes);
  }

  finish(): FitDecodeResult {
    if (this.state === 'header' && this.buf.length > 0) {
      this.processBuffer();
    }

    if (this.state === 'messages') {
      if (this.dataEnd !== Number.MAX_SAFE_INTEGER && this.pos < this.dataEnd) {
        this.warnings.push(
          `Stream ended ${this.dataEnd - this.pos} bytes before the declared data size; CRC not checked`
        );
        this.crcOk = null;
      } else {
        this.finalizeCrc();
      }
    }

    const trailing = this.buf.length - this.offset;
    if (trailing > 0 && this.state === 'done') {
      this.warnings.push(`${trailing} trailing bytes after the file CRC were ignored`);
    }

    return {
      totalBytes: this.totalBytes,
      messageCount: this.messageCount,
      recordCount: this.recordCount,
      sessionCount: this.sessionCount,
      crcOk: this.crcOk,
      protocolVersion: this.protocolVersion,
      profileVersion: this.profileVersion,
      dataSize: this.dataSize,
      warnings: this.warnings
    };
  }

  private processBuffer(): void {
    if (this.state === 'done') return;

    if (this.state === 'header') {
      if (this.buf.length < 12) return;
      if (!this.parseHeader()) return; // full header not received yet
      this.state = 'messages';
    }

    while (this.state === 'messages' && this.pos < this.dataEnd) {
      const consumed = this.tryProcessMessage();
      if (!consumed) return; // need more bytes
    }

    if (this.state === 'messages' && this.pos >= this.dataEnd) {
      this.finalizeCrc();
    }
  }

  /** Parse the file header; returns false when more bytes are needed. */
  private parseHeader(): boolean {
    const headerSize = this.buf[0];
    if (headerSize !== 12 && headerSize !== 14) {
      throw new FitDecodeError(`Invalid FIT header size ${headerSize} (expected 12 or 14)`);
    }
    if (this.buf.length < headerSize) return false;
    if (!(
      this.buf[8] === 0x2e &&
      this.buf[9] === 0x46 &&
      this.buf[10] === 0x49 &&
      this.buf[11] === 0x54
    )) {
      throw new FitDecodeError('Not a FIT file: missing ".FIT" magic');
    }

    const view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
    this.headerSize = headerSize;
    this.protocolVersion = this.buf[1];
    this.profileVersion = view.getUint16(2, true);
    this.dataSize = view.getUint32(4, true);
    if (this.dataSize > 0) {
      this.dataEnd = headerSize + this.dataSize;
    } else {
      this.warnings.push('Header declares data size 0; parsing the entire stream');
    }

    if (headerSize === 14) {
      const storedHeaderCrc = view.getUint16(12, true);
      const calc = new Crc16();
      calc.update(this.buf, 0, 12);
      if (calc.value !== storedHeaderCrc) {
        this.warnings.push(
          `Header CRC mismatch (stored 0x${storedHeaderCrc.toString(16)}, computed 0x${calc.value.toString(16)})`
        );
      }
    }

    this.consume(headerSize);
    return true;
  }

  /** Attempt to process one message; returns false when more bytes are needed. */
  private tryProcessMessage(): boolean {
    if (this.remaining() < 1) return false;
    const headerByte = this.buf[this.offset];

    if (headerByte & 0x80) {
      // Compressed timestamp data message: 2 bits local type, 5 bits
      // time offset, payload follows the single header byte.
      const localType = (headerByte >>> 5) & 0x03;
      const timeOffset = headerByte & 0x1f;
      const def = this.definitions.get(localType);
      if (!def) {
        throw new FitDecodeError(
          `Compressed message references undefined local message type ${localType}`
        );
      }
      if (this.remaining() < 1 + def.payloadSize) return false;

      const updated = this.applyTimeOffset(timeOffset);
      this.decodeDataMessage(def, this.remainingBytes(1 + def.payloadSize), updated);
      this.consume(1 + def.payloadSize);
      return true;
    }

    const localType = headerByte & 0x0f;
    if (headerByte & 0x40) {
      return this.tryProcessDefinition(localType);
    }

    // Regular data message.
    const def = this.definitions.get(localType);
    if (!def) {
      throw new FitDecodeError(`Data message references undefined local message type ${localType}`);
    }
    if (this.remaining() < 1 + def.payloadSize) return false;

    this.decodeDataMessage(def, this.remainingBytes(1 + def.payloadSize), null);
    this.consume(1 + def.payloadSize);
    return true;
  }

  private tryProcessDefinition(localType: number): boolean {
    // Definition message: header byte + reserved + architecture +
    // global message number (u16) + field count.
    if (this.remaining() < 6) return false;
    const fieldCount = this.buf[this.offset + 5];
    const supportsDevFields = this.protocolVersion >= 0x20;
    const minLen = 6 + fieldCount * 3 + (supportsDevFields ? 1 : 0);
    if (this.remaining() < minLen) return false;

    const view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
    const littleEndian = this.buf[this.offset + 2] === 0;
    const globalMessageNumber = view.getUint16(this.offset + 3, littleEndian);

    const fields: FieldDef[] = [];
    let payloadSize = 0;
    for (let i = 0; i < fieldCount; i++) {
      const o = this.offset + 6 + i * 3;
      fields.push({ number: this.buf[o], size: this.buf[o + 1], baseType: this.buf[o + 2] });
      payloadSize += this.buf[o + 1];
    }

    let required = minLen;
    if (supportsDevFields) {
      // Developer field definitions (3 bytes each) after the standard
      // fields; their sizes count toward the data payload.
      const devCount = this.buf[this.offset + 6 + fieldCount * 3];
      required += devCount * 3;
      if (this.remaining() < required) return false;
      for (let i = 0; i < devCount; i++) {
        const o = this.offset + 6 + fieldCount * 3 + 1 + i * 3;
        payloadSize += this.buf[o + 1];
      }
    }

    this.definitions.set(localType, {
      localType,
      littleEndian,
      globalMessageNumber,
      fields,
      payloadSize
    });
    this.consume(required);
    return true;
  }

  /** Accumulate a 5-bit compressed time offset onto the last timestamp. */
  private applyTimeOffset(timeOffset: number): number | null {
    if (this.lastTimestamp === null) return null;
    const base = Math.floor(this.lastTimestamp / 64) * 64;
    let ts = base + timeOffset;
    if (ts > this.lastTimestamp + 31) ts -= 64;
    else if (ts < this.lastTimestamp - 31) ts += 64;
    this.lastTimestamp = ts;
    return ts;
  }

  private decodeDataMessage(
    def: MessageDefinition,
    payload: Uint8Array,
    overriddenTimestamp: number | null
  ): void {
    this.messageCount++;
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

    switch (def.globalMessageNumber) {
      case MSG_FILE_ID:
        this.emitFileId(def, view);
        break;
      case MSG_RECORD:
        this.emitRecord(def, view, overriddenTimestamp);
        break;
      case MSG_SESSION:
        this.emitSession(def, view, overriddenTimestamp);
        break;
      default:
        // Not interesting to Wayli (events, laps, private messages, …).
        break;
    }
  }

  /** Read a single raw field value; returns null for invalid sentinels. */
  private readFieldValue(
    view: DataView,
    def: MessageDefinition,
    field: FieldDef,
    offset: number
  ): number | string | null {
    const base = BASE_TYPES[field.baseType & 0x1f];
    if (!base || base.kind === 'bytes') return null;

    const le = def.littleEndian;
    if (field.size < base.size) {
      // Non-standard shrunk field: read the available bytes as an
      // unsigned little-endian integer; treat all-ones/all-zero as invalid.
      let value = 0;
      let allOnes = true;
      let allZero = true;
      for (let i = 0; i < field.size; i++) {
        const b = view.getUint8(offset + i);
        value |= b << (8 * i);
        if (b !== 0xff) allOnes = false;
        if (b !== 0x00) allZero = false;
      }
      if (allOnes || allZero) return null;
      return value;
    }

    switch (base.kind) {
      case 'uint': {
        const v = this.readUnsigned(view, offset, base.size, le);
        if (v === null) return null;
        if (base.zeroInvalid && v === 0) return null;
        return v;
      }
      case 'sint':
        return this.readSigned(view, offset, base.size, le);
      case 'float':
        if (base.size === 4) return view.getFloat32(offset, le);
        return view.getFloat64(offset, le);
      case 'string': {
        let end = offset;
        const max = Math.min(offset + field.size, view.byteLength);
        while (end < max && view.getUint8(end) !== 0) end++;
        return textDecoder.decode(
          new Uint8Array(view.buffer, view.byteOffset + offset, end - offset)
        );
      }
      default:
        return null;
    }
  }

  private readUnsigned(view: DataView, offset: number, size: number, le: boolean): number | null {
    let invalid = true;
    for (let i = 0; i < size; i++) {
      if (view.getUint8(offset + i) !== 0xff) {
        invalid = false;
        break;
      }
    }
    if (invalid) return null;
    switch (size) {
      case 1:
        return view.getUint8(offset);
      case 2:
        return view.getUint16(offset, le);
      case 4:
        return view.getUint32(offset, le);
      case 8: {
        const big = view.getBigUint64(offset, le);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null;
        return Number(big);
      }
      default:
        return null;
    }
  }

  private readSigned(view: DataView, offset: number, size: number, le: boolean): number | null {
    switch (size) {
      case 1: {
        const v = view.getInt8(offset);
        return v === 0x7f ? null : v;
      }
      case 2: {
        const v = view.getInt16(offset, le);
        return v === 0x7fff ? null : v;
      }
      case 4: {
        const v = view.getInt32(offset, le);
        return v === 0x7fffffff ? null : v;
      }
      case 8: {
        const v = view.getBigInt64(offset, le);
        if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER)) {
          return null;
        }
        return Number(v);
      }
      default:
        return null;
    }
  }

  /** Walk the definition and collect field number → value (first wins). */
  private collectFieldValues(
    def: MessageDefinition,
    view: DataView
  ): Map<number, number | string | null> {
    const values = new Map<number, number | string | null>();
    let offset = 0;
    for (const field of def.fields) {
      if (offset + field.size > view.byteLength) break;
      const value = this.readFieldValue(view, def, field, offset);
      if (!values.has(field.number)) {
        values.set(field.number, value);
      }
      offset += field.size;
    }
    return values;
  }

  private scaled(v: number | string | null | undefined, scale = 1, offset = 0): number | undefined {
    if (typeof v !== 'number') return undefined;
    return Math.round((v / scale + offset) * 1000) / 1000;
  }

  private rawInt(v: number | string | null | undefined): number | undefined {
    return typeof v === 'number' ? v : undefined;
  }

  /** Field 253: a message timestamp; updates the carryover timestamp. */
  private messageTimestampToIso(v: number | string | null | undefined): string | undefined {
    if (typeof v !== 'number') return undefined;
    this.lastTimestamp = v;
    return this.fitSecondsToIso(v);
  }

  private fitSecondsToIso(seconds: number): string {
    return new Date(FIT_EPOCH_MS + seconds * 1000).toISOString();
  }

  private semicircleToDeg(v: number | string | null | undefined): number | undefined {
    if (typeof v !== 'number') return undefined;
    const deg = v * SEMICIRCLE_TO_DEG;
    if (Math.abs(deg) > 180) return undefined;
    return Math.round(deg * 1e6) / 1e6;
  }

  private emitFileId(def: MessageDefinition, view: DataView): void {
    const v = this.collectFieldValues(def, view);
    const fileId: FitFileId = {};
    const type = this.rawInt(v.get(0));
    const manufacturer = this.rawInt(v.get(1));
    const product = this.rawInt(v.get(2));
    const serial = this.rawInt(v.get(3));
    const timeCreatedSecs = this.rawInt(v.get(4));
    if (type !== undefined) fileId.type = type;
    if (manufacturer !== undefined) fileId.manufacturer = manufacturer;
    if (product !== undefined) fileId.product = product;
    if (serial !== undefined) fileId.serialNumber = serial;
    if (timeCreatedSecs !== undefined) fileId.timeCreated = this.fitSecondsToIso(timeCreatedSecs);
    this.callbacks.onFileId?.(fileId);
  }

  private emitRecord(
    def: MessageDefinition,
    view: DataView,
    overriddenTimestamp: number | null
  ): void {
    const v = this.collectFieldValues(def, view);

    const record: FitRecord = {};
    if (overriddenTimestamp !== null) {
      record.timestamp = this.fitSecondsToIso(overriddenTimestamp);
    } else {
      const ts = this.messageTimestampToIso(v.get(253));
      if (ts !== undefined) record.timestamp = ts;
    }

    const lat = this.semicircleToDeg(v.get(0));
    const lon = this.semicircleToDeg(v.get(1));
    if (lat !== undefined && Math.abs(lat) <= 90) record.positionLat = lat;
    if (lon !== undefined) record.positionLon = lon;

    const altitude = this.scaled(v.get(2), 5, -500) ?? this.scaled(v.get(78), 5, -500);
    if (altitude !== undefined) record.altitudeM = altitude;

    const heartRate = this.rawInt(v.get(3));
    if (heartRate !== undefined) record.heartRate = heartRate;

    const cadence = this.rawInt(v.get(4));
    if (cadence !== undefined) record.cadence = cadence;

    const distance = this.scaled(v.get(5), 100);
    if (distance !== undefined) record.distanceM = distance;

    const speed = this.scaled(v.get(6), 1000) ?? this.scaled(v.get(29), 1000);
    if (speed !== undefined) record.speedMs = speed;

    const power = this.rawInt(v.get(7));
    if (power !== undefined) record.power = power;

    const temperature = this.rawInt(v.get(13));
    if (temperature !== undefined) record.temperatureC = temperature;

    const heading = this.scaled(v.get(39), 100);
    if (heading !== undefined) record.headingDeg = heading;

    this.recordCount++;
    this.callbacks.onRecord?.(record);
  }

  private emitSession(
    def: MessageDefinition,
    view: DataView,
    overriddenTimestamp: number | null
  ): void {
    const v = this.collectFieldValues(def, view);

    const session: FitSession = {};
    if (overriddenTimestamp !== null) {
      session.timestamp = this.fitSecondsToIso(overriddenTimestamp);
    } else {
      const ts = this.messageTimestampToIso(v.get(253));
      if (ts !== undefined) session.timestamp = ts;
    }

    // Session profile field numbers: 0 = event, 1 = event_type, 5 = sport,
    // 6 = sub_sport. (#221: this used to read fields 0/1, labelling every
    // session whose stop event was 9/1 as american_football/treadmill.)
    const sportRaw = this.rawInt(v.get(5));
    if (sportRaw !== undefined) session.sport = SPORT_MAP[sportRaw] ?? 'fitness';
    const subSportRaw = this.rawInt(v.get(6));
    if (subSportRaw !== undefined && SUB_SPORT_MAP[subSportRaw]) {
      session.subSport = SUB_SPORT_MAP[subSportRaw];
    }

    const startSecs = this.rawInt(v.get(2));
    if (startSecs !== undefined) session.startTime = this.fitSecondsToIso(startSecs);

    // Field numbers per the standard session profile, verified against real
    // device files: 7 elapsed, 8 timer, 9 distance, 11 calories, 14/15
    // avg/max speed, 16/17 avg/max HR, 18/19 avg/max cadence, 20/21
    // avg/max power. (3/4 are the start position — not decoded.)
    const elapsed = this.scaled(v.get(7), 1000);
    if (elapsed !== undefined) session.totalElapsedTimeS = elapsed;
    const timer = this.scaled(v.get(8), 1000);
    if (timer !== undefined) session.totalTimerTimeS = timer;
    const distance = this.scaled(v.get(9), 100);
    if (distance !== undefined) session.totalDistanceM = distance;
    const calories = this.rawInt(v.get(11));
    if (calories !== undefined) session.totalCalories = calories;
    const avgSpeed = this.scaled(v.get(14), 1000);
    if (avgSpeed !== undefined) session.avgSpeedMs = avgSpeed;
    const maxSpeed = this.scaled(v.get(15), 1000);
    if (maxSpeed !== undefined) session.maxSpeedMs = maxSpeed;
    const avgHr = this.rawInt(v.get(16));
    if (avgHr !== undefined) session.avgHeartRate = avgHr;
    const maxHr = this.rawInt(v.get(17));
    if (maxHr !== undefined) session.maxHeartRate = maxHr;
    const avgCadence = this.rawInt(v.get(18));
    if (avgCadence !== undefined) session.avgCadence = avgCadence;
    const maxCadence = this.rawInt(v.get(19));
    if (maxCadence !== undefined) session.maxCadence = maxCadence;
    const avgPower = this.rawInt(v.get(20));
    if (avgPower !== undefined) session.avgPower = avgPower;
    const maxPower = this.rawInt(v.get(21));
    if (maxPower !== undefined) session.maxPower = maxPower;

    this.sessionCount++;
    this.callbacks.onSession?.(session);
  }

  private remaining(): number {
    return this.buf.length - this.offset;
  }

  private remainingBytes(count: number): Uint8Array {
    return this.buf.subarray(this.offset + 1, this.offset + 1 + count);
  }

  /**
   * Mark `count` bytes as consumed. The data-section CRC (which per the FIT
   * spec covers [headerSize, headerSize + dataSize)) is fed incrementally
   * here so no second pass over the stream is needed.
   */
  private consume(count: number): void {
    const from = Math.max(this.pos, this.headerSize, this.crcFedTo);
    const to = Math.min(this.pos + count, this.dataEnd);
    if (to > from) {
      this.dataCrc.update(this.buf, from - this.pos + this.offset, to - this.pos + this.offset);
      this.crcFedTo = to;
    }

    this.pos += count;
    this.offset += count;
  }

  private finalizeCrc(): void {
    if (this.state === 'done') return;
    this.state = 'done';

    if (this.remaining() < 2) {
      this.crcOk = null;
      return;
    }

    const storedCrc = this.buf[this.offset] | (this.buf[this.offset + 1] << 8);
    this.crcOk = storedCrc === this.dataCrc.value;
    if (!this.crcOk) {
      this.warnings.push(
        `File CRC mismatch (stored 0x${storedCrc.toString(16)}, computed 0x${this.dataCrc.value.toString(16)}); file was likely post-processed`
      );
    }
    this.pos += 2;
    this.offset += 2;
  }
}

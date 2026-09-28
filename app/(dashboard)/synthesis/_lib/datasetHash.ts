/**
 * Canonical JSON + sha256 of a synthesis's analysis-ready dataset.
 *
 * Mirror of `backend/utils/synthesis_hash.py`. The client posts a run's dataset
 * with this hash; the server recomputes it and refuses a mismatch (422), so a
 * stored run is bound to exactly the data it was computed from. Change one
 * side, change the other in the same commit — `backend/scripts/check_synthesis_hash_mirror.py`
 * executes this file under `node --experimental-strip-types` and diffs the two.
 *
 * Canonical form:
 *  - objects: keys sorted by UTF-16 code unit (default `sort()`), no whitespace;
 *    `undefined` / function values are dropped (as `JSON.stringify` drops them
 *    when the dataset is posted), `toJSON` is honoured;
 *  - strings: `JSON.stringify(s)` (== Python `json.dumps(s, ensure_ascii=False)`);
 *  - numbers: NaN / ±Infinity → `null`; integral with |x| < 2^53 → integer
 *    digits; otherwise rounded to 10 significant digits (ties away from zero,
 *    i.e. `toExponential(9)`), trailing zeros stripped, positional when the
 *    decimal exponent E satisfies -7 < E < 21, else `d.ddde±X`;
 *  - booleans / null as JSON; `undefined` inside an array → `null`.
 *
 * Pure and synchronous (no crypto.subtle), so it can run inside render.
 */

const SIG_DIGITS = 10;
const MAX_SAFE = 2 ** 53;

function formatDigits(negative: boolean, digits: string, exp10: number): string {
  let text: string;
  if (exp10 > -7 && exp10 < 21) {
    if (exp10 >= 0) {
      text = digits.length <= exp10 + 1
        ? digits + '0'.repeat(exp10 + 1 - digits.length)
        : digits.slice(0, exp10 + 1) + '.' + digits.slice(exp10 + 1);
    } else {
      text = '0.' + '0'.repeat(-exp10 - 1) + digits;
    }
  } else {
    text = digits[0] + (digits.length > 1 ? '.' + digits.slice(1) : '')
      + 'e' + (exp10 > 0 ? '+' : '-') + String(Math.abs(exp10));
  }
  return (negative ? '-' : '') + text;
}

export function canonicalNumber(x: number): string {
  if (!Number.isFinite(x)) return 'null';
  if (Number.isInteger(x) && Math.abs(x) < MAX_SAFE) return x === 0 ? '0' : String(x);
  const [mantissa, expText] = Math.abs(x).toExponential(SIG_DIGITS - 1).split('e');
  const exp10 = parseInt(expText, 10);
  const digits = mantissa.replace('.', '').replace(/0+$/, '') || '0';
  return formatDigits(x < 0, digits, exp10);
}

export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    return canonicalJson((value as { toJSON: () => unknown }).toJSON());
  }
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return canonicalNumber(value);
    case 'bigint':
      return canonicalNumber(Number(value));
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return '[' + value.map(v => (v === undefined || typeof v === 'function' ? 'null' : canonicalJson(v))).join(',') + ']';
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter(k => obj[k] !== undefined && typeof obj[k] !== 'function' && typeof obj[k] !== 'symbol')
        .sort();
      return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
    }
    default:
      return 'null';
  }
}

// ── sha256 (FIPS 180-4), UTF-8 input ─────────────────────────────────────────

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function utf8(s: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  const out: number[] = [];
  for (const ch of s) {
    let c = ch.codePointAt(0) as number;
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

export function sha256Hex(s: string): string {
  const msg = utf8(s);
  const bitLen = msg.length * 8;
  const padded = new Uint8Array(((msg.length + 9 + 63) >> 6) << 6);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let off = 0; off < padded.length; off += 64) {
    for (let t = 0; t < 16; t++) W[t] = view.getUint32(off + t * 4);
    for (let t = 16; t < 64; t++) {
      const w15 = W[t - 15], w2 = W[t - 2];
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[t] + W[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  let hex = '';
  for (let i = 0; i < 8; i++) hex += H[i].toString(16).padStart(8, '0');
  return hex;
}

export function datasetHash(dataset: unknown[]): string {
  return sha256Hex(canonicalJson(dataset));
}

/** "9c2ea1…" → "9c2e·a1". */
export function shortHash(h: string): string {
  return `${h.slice(0, 4)}·${h.slice(4, 6)}`;
}

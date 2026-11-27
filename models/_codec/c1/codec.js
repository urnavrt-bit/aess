// AESS config code, scheme c1 ("AE2-..."). FROZEN: codes in the wild depend on
// every detail of this file. Never edit it; a new scheme gets a new folder.
//
// A code carries the whole design, so it needs no database:
//   model id (5 bits, models/registry.json) · version (6) · number of changed values (6)
//   then for each value that differs from that version's default, in manifest order:
//     parameter index (6) · value index (bits for the parameter's range)
//   then a 10-bit checksum, zero-padded to a multiple of 5 bits, written in
//   Crockford base32, in groups of five after "AE2-".
// The same design always gives the same code.

export const PREFIX = "AE2";
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function steps(p) {
  if (p.type === "bool") return 2;
  return Math.round((p.max - p.min) / p.step) + 1;
}
function bitsFor(n) {
  let b = 1;
  while ((1 << b) < n) b++;
  return b;
}

export function normalizeValue(p, v) {
  if (p.type === "bool") return !!v;
  let x = Number(v);
  if (!Number.isFinite(x)) x = p.default;
  x = Math.min(p.max, Math.max(p.min, x));
  const idx = Math.round((x - p.min) / p.step);
  x = +(p.min + idx * p.step).toFixed(4);
  return p.type === "int" ? Math.round(x) : x;
}

function valueIndex(p, v) {
  if (p.type === "bool") return v ? 1 : 0;
  return Math.round((normalizeValue(p, v) - p.min) / p.step);
}

function checksum(bits) {
  let h = 0x811c9dc5;
  for (const b of bits) { h ^= b + 48; h = Math.imul(h, 0x01000193) >>> 0; }
  return h & 1023;
}

function push(bits, value, n) {
  for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}

export function encode(manifest, registry, values) {
  const id = registry[manifest.model];
  if (id == null) throw new Error(`model ${manifest.model} has no id in the registry`);
  const changed = [];
  manifest.params.forEach((p, i) => {
    const v = normalizeValue(p, values[p.id] ?? p.default);
    if (v !== normalizeValue(p, p.default)) changed.push([i, p, v]);
  });
  const bits = [];
  push(bits, id, 5);
  push(bits, manifest.version, 6);
  push(bits, changed.length, 6);
  for (const [i, p, v] of changed) {
    push(bits, i, 6);
    push(bits, valueIndex(p, v), bitsFor(steps(p)));
  }
  push(bits, checksum(bits), 10);
  while (bits.length % 5) bits.push(0);
  let s = "";
  for (let i = 0; i < bits.length; i += 5) {
    s += ALPHABET[(bits[i] << 4) | (bits[i + 1] << 3) | (bits[i + 2] << 2) | (bits[i + 3] << 1) | bits[i + 4]];
  }
  return `${PREFIX}-${s.match(/.{1,5}/g).join("-")}`;
}

// Clean up typed input: case, spaces, dashes and look-alike letters.
export function normalizeCode(text) {
  const s = String(text).toUpperCase().replace(/[\s\-_.]/g, "")
    .replace(/O/g, "0").replace(/[IL]/g, "1").replace(/U/g, "V");
  if (!s.startsWith(PREFIX)) return null;
  const body = s.slice(PREFIX.length);
  if (!body || [...body].some((c) => !ALPHABET.includes(c))) return null;
  return `${PREFIX}-${body.match(/.{1,5}/g).join("-")}`;
}

export function peek(text) {
  const code = normalizeCode(text);
  if (!code) throw new Error("That isn't an AE2 config code.");
  const bits = toBits(code);
  return { code, modelId: read(bits, 0, 5), version: read(bits, 5, 6) };
}

function toBits(code) {
  const bits = [];
  for (const c of code.slice(PREFIX.length).replace(/-/g, "")) push(bits, ALPHABET.indexOf(c), 5);
  return bits;
}
function read(bits, at, n) {
  let v = 0;
  for (let i = 0; i < n; i++) v = (v << 1) | (bits[at + i] ?? 0);
  return v >>> 0;
}

// getManifest(modelName, version) must return that exact (frozen) manifest.
export function decode(text, registry, getManifest) {
  const { code, modelId, version } = peek(text);
  const model = Object.keys(registry).find((k) => registry[k] === modelId);
  if (!model) throw new Error("This code is for a model this site doesn't know.");
  const manifest = getManifest(model, version);
  if (!manifest) throw new Error(`This code needs ${model} version ${version}, which isn't available here.`);
  const bits = toBits(code);
  let at = 11;
  const count = read(bits, at, 6); at += 6;
  const values = {};
  for (const p of manifest.params) values[p.id] = normalizeValue(p, p.default);
  let last = -1;
  for (let k = 0; k < count; k++) {
    const i = read(bits, at, 6); at += 6;
    const p = manifest.params[i];
    if (!p || i <= last) throw new Error("This code is damaged (check for typos).");
    last = i;
    const n = steps(p);
    const idx = read(bits, at, bitsFor(n)); at += bitsFor(n);
    if (idx >= n) throw new Error("This code is damaged (check for typos).");
    values[p.id] = p.type === "bool" ? idx === 1 : normalizeValue(p, p.min + idx * p.step);
  }
  const sum = read(bits, at, 10);
  if (at + 10 > bits.length || sum !== checksum(bits.slice(0, at))) throw new Error("This code is damaged (check for typos).");
  if (bits.slice(at + 10).some((b) => b) || bits.length - (at + 10) >= 5) throw new Error("This code is damaged (check for typos).");
  return { code, model, version, values };
}

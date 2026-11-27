// Writing and reading AESS files. Every file carries the design it was made from:
//   3MF: Metadata/aess.json (model, version, code, every parameter) + readable
//        metadata + a thumbnail; STL: the config code in its 80-byte header
//        (the code alone holds every parameter).

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------------------------------------------------------------- STL
export function writeSTL(positions, indices, header) {
  const n = indices.length / 3;
  const buf = new ArrayBuffer(84 + 50 * n);
  const bytes = new Uint8Array(buf);
  bytes.set(enc.encode(header.slice(0, 80)));
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  let o = 84;
  for (let t = 0; t < n; t++) {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
    o += 12;
    for (const i of [a, b, c]) {
      dv.setFloat32(o, positions[i], true); dv.setFloat32(o + 4, positions[i + 1], true); dv.setFloat32(o + 8, positions[i + 2], true);
      o += 12;
    }
    o += 2;
  }
  return new Blob([buf], { type: "model/stl" });
}

export function readSTLHeader(bytes) {
  return dec.decode(bytes.subarray(0, 80)).replace(/\0+$/, "");
}

// ---------------------------------------------------------------- ZIP (for 3MF)
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
async function deflate(data) {
  if (typeof CompressionStream === "undefined") return null;
  const s = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function inflate(data) {
  const s = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

async function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = typeof content === "string" ? enc.encode(content) : content;
    const packed = await deflate(data);
    const method = packed && packed.length < data.length ? 8 : 0;
    const body = method ? packed : data;
    const nameBytes = enc.encode(name), crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(8, method, true);
    head.setUint32(14, crc, true); head.setUint32(18, body.length, true); head.setUint32(22, data.length, true);
    head.setUint16(26, nameBytes.length, true);
    parts.push(head.buffer, nameBytes, body);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(10, method, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, body.length, true); cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameBytes.length, true); cd.setUint32(42, offset, true);
    central.push(cd.buffer, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const cdSize = central.reduce((s, p) => s + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: "model/3mf" });
}

async function unzipEntry(bytes, wanted) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let e = bytes.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error("not a zip file");
  let p = dv.getUint32(e + 16, true);
  const count = dv.getUint16(e + 10, true);
  for (let i = 0; i < count; i++) {
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    if (name.toLowerCase() === wanted.toLowerCase()) {
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      return method === 8 ? inflate(data) : data;
    }
    p += 46 + nlen + xlen + clen;
  }
  return null;
}

// ---------------------------------------------------------------- 3MF
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function write3MF(positions, indices, { config, title, description, thumbnail }) {
  const v = [], t = [];
  for (let i = 0; i < positions.length; i += 3) {
    v.push(`<vertex x="${+positions[i].toFixed(5)}" y="${+positions[i + 1].toFixed(5)}" z="${+positions[i + 2].toFixed(5)}"/>`);
  }
  for (let i = 0; i < indices.length; i += 3) t.push(`<triangle v1="${indices[i]}" v2="${indices[i + 1]}" v3="${indices[i + 2]}"/>`);
  const meta = {
    Title: title, Designer: "AESS generator", Description: description,
    Application: config.generator, CreationDate: config.created.slice(0, 10),
    "aess:code": config.code, "aess:config": JSON.stringify(config),
  };
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:aess="https://aess.billowapp.dev/3mf/2026">
${Object.entries(meta).map(([k, val]) => ` <metadata name="${k}">${esc(val)}</metadata>`).join("\n")}
 <resources>
  <object id="1" type="model" name="${esc(title)}">
   <mesh><vertices>${v.join("")}</vertices><triangles>${t.join("")}</triangles></mesh>
  </object>
 </resources>
 <build><item objectid="1"/></build>
</model>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
${thumbnail ? ' <Relationship Target="/Metadata/thumbnail.png" Id="rel1" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>\n' : ""}</Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="png" ContentType="image/png"/>
 <Default Extension="json" ContentType="application/json"/>
</Types>`;
  const files = [["[Content_Types].xml", types], ["_rels/.rels", rels], ["3D/3dmodel.model", model],
    ["Metadata/aess.json", JSON.stringify(config, null, 2)]];
  if (thumbnail) files.push(["Metadata/thumbnail.png", thumbnail]);
  return zip(files);
}

// ---------------------------------------------------------------- reading a file back
// Returns {code} (and {config} for 3MF) or throws.
export async function readDesignFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const json = await unzipEntry(bytes, "Metadata/aess.json");
    if (json) {
      const config = JSON.parse(dec.decode(json));
      return { code: config.code, config };
    }
    const model = await unzipEntry(bytes, "3D/3dmodel.model");
    const m = model && dec.decode(model).match(/name="aess:code">([^<]+)</);
    if (m) return { code: m[1] };
    throw new Error("This 3MF wasn't made by AESS (no design data inside).");
  }
  const header = readSTLHeader(bytes);
  const m = header.match(/\b(AE2-[0-9A-Z-]+)/);
  if (m) return { code: m[1].replace(/-+$/, "") };
  throw new Error("No AESS design data found in this file.");
}

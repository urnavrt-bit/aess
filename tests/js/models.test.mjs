// node --test tests/js/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { runtime, manifest, registry, defaults, ROOT } from "./build.mjs";

const reg = await registry();
const browserModels = [];
for (const model of Object.keys(reg)) {
  for (const dir of await readdir(new URL(`models/${model}/`, ROOT))) {
    const m = await manifest(model, +dir.slice(1));
    if (m.engine === "browser") browserModels.push(m);
  }
}
const getManifest = (model, version) => browserModels.find((m) => m.model === model && m.version === version);

function satisfies(m, v) {
  const names = Object.keys(v);
  const args = names.map((k) => (v[k] === true ? 1 : v[k] === false ? 0 : v[k]));
  return m.checks.every((c) => {
    const js = c.expr.replace(/\bnot\b/g, "!").replace(/\band\b/g, "&&").replace(/\bor\b/g, "||");
    return new Function(...names, `return (${js});`)(...args);
  });
}

// deterministic pseudo-random numbers
function rng(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}
function randomValues(m, rand) {
  const v = {};
  for (const p of m.params) {
    if (p.type === "bool") v[p.id] = rand() < 0.5;
    else {
      const n = Math.round((p.max - p.min) / p.step);
      // keep sizes small so the sweep stays fast
      const cap = ["gx", "gy"].includes(p.id) ? Math.min(n, 2) : p.id === "gz" ? Math.min(n, 6) : n;
      v[p.id] = +(p.min + Math.floor(rand() * (cap + 1)) * p.step).toFixed(4);
    }
  }
  return v;
}

for (const m of browserModels) {
  test(`${m.model} v${m.version} matches its SolidCraft reference`, async () => {
    const ref = JSON.parse(await readFile(new URL(`tests/reference/${m.model}-v${m.version}.json`, ROOT)));
    for (const c of ref.cases) {
      const r = await runtime.build(m, { ...defaults(m), ...c.values }, null, { noEngrave: true });
      const size = r.bbox.max.map((x, i) => x - r.bbox.min[i]);
      const rel = Math.abs(r.volume - c.volume_mm3) / c.volume_mm3;
      if (process.env.SHOW) console.log(m.model, JSON.stringify(c.values), `${(rel * 100).toFixed(4)}%`, size.map((x, i) => (x - c.size_mm[i]).toFixed(4)).join(" "));
      assert.ok(rel < 0.0005, `${JSON.stringify(c.values)}: volume ${r.volume.toFixed(1)} vs ${c.volume_mm3} (${(rel * 100).toFixed(3)}%)`);
      size.forEach((s, i) => assert.ok(Math.abs(s - c.size_mm[i]) < 0.02, `${JSON.stringify(c.values)}: size ${size} vs ${c.size_mm}`));
    }
  });

  test(`${m.model} v${m.version}: presets and random valid designs build as solids`, async () => {
    const codec = await runtime.codec(m);
    const rand = rng(42 + m.version);
    const designs = (m.presets || []).map((p) => ({ ...defaults(m), ...p.values }));
    while (designs.length < 40) {
      const v = randomValues(m, rand);
      if (satisfies(m, v)) designs.push(v);
    }
    for (const v of designs) {
      assert.ok(satisfies(m, v), `preset fails its own checks: ${JSON.stringify(v)}`);
      const code = codec.encode(m, reg, v);
      const r = await runtime.build(m, v, code);
      assert.ok(r.volume > 100 && r.triangles > 100, `${code}: empty result`);
    }
  });

  test(`${m.model} v${m.version}: codes round-trip and reject typos`, async () => {
    const codec = await runtime.codec(m);
    const rand = rng(7);
    let caught = 0;
    for (let k = 0; k < 300; k++) {
      const v = randomValues(m, rand);
      const code = codec.encode(m, reg, v);
      const back = codec.decode(code.toLowerCase().replace(/-/g, " "), reg, getManifest);
      assert.equal(back.code, code);
      for (const p of m.params) assert.equal(back.values[p.id], codec.normalizeValue(p, v[p.id]), `${code} ${p.id}`);
      assert.equal(codec.encode(m, reg, back.values), code);
      // a single changed character must be caught (almost always)
      const chars = code.replace(/-/g, "").split("");
      const at = 3 + Math.floor(rand() * (chars.length - 3));
      chars[at] = chars[at] === "0" ? "1" : "0";
      try { codec.decode(chars.join(""), reg, getManifest); } catch { caught++; }
    }
    assert.ok(caught >= 290, `only ${caught}/300 single-character typos detected`);
    assert.match(codec.encode(m, reg, defaults(m)), /^AE2-[0-9A-Z]{1,5}(-[0-9A-Z]{1,5})*$/);
  });
}

test("default designs give short codes", async () => {
  for (const m of browserModels) {
    const codec = await runtime.codec(m);
    const code = codec.encode(m, reg, defaults(m));
    assert.ok(code.length <= 12, `${m.model}: ${code}`);
  }
});

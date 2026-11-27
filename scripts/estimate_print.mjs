// Estimate printed filament for a design (same estimate as the site, web/estimate.js).
//   node scripts/estimate_print.mjs <model> <version> ['{"gx":4,"gy":4,"gz":7}']
//     [--layer 0.2] [--walls 3] [--line 0.42] [--shells 4] [--infill 0.15] [--density 1.27]
import { readFile } from "node:fs/promises";
import { estimatePrint } from "../web/estimate.js";

const ROOT = new URL("../", import.meta.url);
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? +process.argv[i + 1] : dflt; };

export async function estimate(model, version, values, opt = {}) {
  const m = JSON.parse(await readFile(new URL(`models/${model}/v${version}/manifest.json`, ROOT)));
  const rt = m.runtime;
  const Module = (await import(new URL(`models/${rt.manifold}`, ROOT))).default;
  const wasm = await Module(); wasm.setup();
  const opentype = await import(new URL(`models/${rt.opentype}`, ROOT));
  const font = opentype.parse((await readFile(new URL(`models/${rt.font}`, ROOT))).buffer);
  const { build } = await import(new URL(`models/${model}/v${version}/${rt.entry}`, ROOT));
  const v = { ...Object.fromEntries(m.params.map((p) => [p.id, p.default])), ...values };
  const solid = build(wasm, { font }, v, "AE2-XXXXX-XXXXX-XX");
  return estimatePrint(solid, opt);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [model, version, json] = process.argv.slice(2);
  const r = await estimate(model, +version, json?.startsWith("{") ? JSON.parse(json) : {}, {
    layer: arg("layer", 0.2), walls: arg("walls", 3), line: arg("line", 0.42), shells: arg("shells", 4),
    infill: arg("infill", 0.15), density: arg("density", 1.27), filament: arg("filament", 1.75),
  });
  console.log(JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, x]) => [k, Math.round(x * 10) / 10]))));
}

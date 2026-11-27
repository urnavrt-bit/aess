// Build a browser model in Node: node tests/js/build.mjs <model> <version> ['{"gx":2}'] [code] [--no-engrave]
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createRuntime } from "../../web/runtime.js";

export const ROOT = new URL("../../", import.meta.url);
export const runtime = createRuntime({
  modelsBase: new URL("models/", ROOT).href,
  fetchBytes: async (u) => new Uint8Array(await readFile(new URL(u))),
});

export async function manifest(model, version) {
  return JSON.parse(await readFile(new URL(`models/${model}/v${version}/manifest.json`, ROOT)));
}
export async function registry() {
  return JSON.parse(await readFile(new URL("models/registry.json", ROOT)));
}
export function defaults(m) {
  return Object.fromEntries(m.params.map((p) => [p.id, p.default]));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [model, version, json, code] = process.argv.slice(2);
  const m = await manifest(model, +version);
  const values = { ...defaults(m), ...(json ? JSON.parse(json) : {}) };
  const r = await runtime.build(m, values, code || null, { noEngrave: process.argv.includes("--no-engrave") });
  console.log(JSON.stringify({ volume: +r.volume.toFixed(2), triangles: r.triangles, genus: r.genus, bbox: r.bbox, ms: Math.round(r.ms) }));
}

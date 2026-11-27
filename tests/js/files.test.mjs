// Files carry their design: 3MF holds the full config, STL holds the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeSTL, write3MF, readDesignFile } from "../../web/files.js";
import { runtime, manifest, registry, defaults } from "./build.mjs";

test("3MF and STL files give back their design", async () => {
  const m = await manifest("bin", 2);
  const reg = await registry();
  const codec = await runtime.codec(m);
  const values = { ...defaults(m), gx: 3, ndx: 2, magnets: true, wall: 2.05 };
  const code = codec.encode(m, reg, values);
  const r = await runtime.build(m, values, code);
  const config = { aess: 1, code, model: "bin", version: 2, params: values, generator: `https://aess.billowapp.dev/?c=${code}`, created: new Date().toISOString() };

  const threemf = await write3MF(r.positions, r.indices, { config, title: "t", description: "d", thumbnail: new Uint8Array([137, 80, 78, 71]) });
  const back = await readDesignFile(threemf);
  assert.equal(back.code, code);
  assert.deepEqual(back.config.params, values);

  const stl = writeSTL(r.positions, r.indices, `AESS ${code} bin v2 aess.billowapp.dev`);
  assert.equal(stl.size, 84 + 50 * r.triangles);
  assert.equal((await readDesignFile(stl)).code, code);
  assert.deepEqual(codec.decode((await readDesignFile(stl)).code, reg, (n, v) => (n === "bin" && v === 2 ? m : null)).values,
    Object.fromEntries(m.params.map((p) => [p.id, codec.normalizeValue(p, values[p.id])])));
});

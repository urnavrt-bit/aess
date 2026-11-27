// Project rules from CLAUDE.md, enforced for every browser model version:
// manifests are well-formed and fit the code format, every model engraves its
// config code, and every downloaded file carries its design.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, access } from "node:fs/promises";
import { writeSTL, write3MF, readDesignFile } from "../../web/files.js";
import { runtime, manifest, registry, defaults, ROOT } from "./build.mjs";

const reg = await registry();
const models = [];
for (const model of Object.keys(reg)) {
  for (const dir of await readdir(new URL(`models/${model}/`, ROOT))) {
    const m = await manifest(model, +dir.slice(1));
    if (m.engine === "browser") models.push(m);
  }
}

test("registry ids fit the code format", () => {
  const ids = Object.values(reg);
  assert.equal(new Set(ids).size, ids.length, "model ids must be unique");
  for (const id of ids) assert.ok(Number.isInteger(id) && id >= 1 && id <= 31, `model id ${id} must be 1..31`);
  assert.ok(models.length > 0, "no browser models found");
});

for (const m of models) {
  test(`${m.model} v${m.version}: manifest is well-formed`, async () => {
    for (const k of ["model", "version", "title", "summary", "engine", "runtime", "groups", "params", "checks", "presets"]) {
      assert.ok(k in m, `missing "${k}"`);
    }
    assert.ok(m.version >= 1 && m.version <= 63, "version must be 1..63 (code format)");
    assert.ok(m.params.length <= 63, "at most 63 parameters (code format)");
    for (const k of ["manifold", "opentype", "font", "kit", "codec"]) {
      await access(new URL(`models/${m.runtime[k]}`, ROOT));
      assert.match(m.runtime[k], /^_[a-z]+\/[^/]+\//, `${k} must live in a frozen models/_*/<name>/ folder`);
    }
    await access(new URL(`models/${m.model}/v${m.version}/${m.runtime.entry}`, ROOT));
    if (m.reference?.solidcraft) await access(new URL(`tests/reference/${m.model}-v${m.version}.json`, ROOT));

    const groups = new Set(m.groups.map((g) => g.id));
    const ids = new Set();
    for (const p of m.params) {
      const where = `${m.model} v${m.version} param ${p.id}`;
      assert.match(p.id, /^[a-z][a-z0-9_]*$/, `${where}: id`);
      assert.ok(!ids.has(p.id), `${where}: duplicate id`);
      ids.add(p.id);
      assert.ok(groups.has(p.group), `${where}: unknown group ${p.group}`);
      assert.ok(p.label && p.help, `${where}: needs a label and help text`);
      assert.ok(["int", "float", "bool"].includes(p.type), `${where}: type`);
      if (p.type === "bool") {
        assert.equal(typeof p.default, "boolean", `${where}: default must be true/false`);
        continue;
      }
      assert.ok(p.step > 0 && p.min < p.max, `${where}: min < max and step > 0`);
      const steps = (p.max - p.min) / p.step;
      assert.ok(Math.abs(steps - Math.round(steps)) < 1e-6, `${where}: range must be a whole number of steps`);
      assert.ok(Math.round(steps) + 1 <= 2 ** 16, `${where}: too many steps for the code format`);
      assert.ok(p.default >= p.min && p.default <= p.max, `${where}: default out of range`);
      const k = (p.default - p.min) / p.step;
      assert.ok(Math.abs(k - Math.round(k)) < 1e-6, `${where}: default must sit on a step`);
      if (p.type === "int") assert.ok(Number.isInteger(p.min) && Number.isInteger(p.step), `${where}: int needs whole min/step`);
    }
    for (const p of m.params) {
      if (p.requires) assert.equal(m.params.find((q) => q.id === p.requires)?.type, "bool", `${p.id}: requires must name a switch`);
    }
    for (const c of m.checks) {
      const names = c.expr.match(/[a-z_][a-z0-9_]*/gi).filter((w) => !["and", "or", "not"].includes(w));
      for (const n of names) assert.ok(ids.has(n), `check "${c.expr}" uses unknown name ${n}`);
      assert.ok(c.message, `check "${c.expr}" needs a message`);
      new Function(...ids, `return (${c.expr.replace(/\bnot\b/g, "!").replace(/\band\b/g, "&&").replace(/\bor\b/g, "||")});`);
    }
    for (const pr of m.presets) for (const k of Object.keys(pr.values)) assert.ok(ids.has(k), `preset ${pr.name}: unknown ${k}`);
  });

  test(`${m.model} v${m.version}: engraves its config code`, async () => {
    const codec = await runtime.codec(m);
    const v = defaults(m);
    const code = codec.encode(m, reg, v);
    const plain = await runtime.build(m, v, code, { noEngrave: true });
    const engraved = await runtime.build(m, v, code);
    const removed = plain.volume - engraved.volume;
    assert.ok(removed > 5, `engraving removed only ${removed.toFixed(2)} mm³: the code must be cut into the part`);
    assert.deepEqual(engraved.bbox, plain.bbox, "engraving must not change the outer size");
    const longCode = codec.encode(m, reg, Object.fromEntries(m.params.map((p) =>
      [p.id, p.type === "bool" ? !p.default : p.default === p.max ? p.min : p.max])));
    const long = await runtime.build(m, v, longCode).catch((e) => assert.fail(`long code ${longCode} fails: ${e.message}`));
    assert.ok(plain.volume - long.volume > 5, `long code ${longCode} isn't engraved`);
  });

  test(`${m.model} v${m.version}: downloaded files carry the design`, async () => {
    const codec = await runtime.codec(m);
    const v = { ...defaults(m), ...(m.presets[0]?.values || {}) };
    const code = codec.encode(m, reg, v);
    const r = await runtime.build(m, v, code);
    const config = { aess: 1, code, model: m.model, version: m.version, params: v, generator: `https://aess.billowapp.dev/?c=${code}`, created: new Date().toISOString() };
    const back3mf = await readDesignFile(await write3MF(r.positions, r.indices, { config, title: "t", description: "d" }));
    assert.equal(back3mf.code, code);
    assert.deepEqual(back3mf.config.params, v);
    const backStl = await readDesignFile(writeSTL(r.positions, r.indices, `AESS ${code} ${m.model} v${m.version} aess.billowapp.dev`));
    assert.equal(backStl.code, code);
    const decoded = codec.decode(backStl.code, reg, (n, ver) => (n === m.model && ver === m.version ? m : null));
    assert.deepEqual(decoded.values, Object.fromEntries(m.params.map((p) => [p.id, codec.normalizeValue(p, v[p.id])])));
  });
}

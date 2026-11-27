import { estimatePrint } from "./estimate.js";

// Loads a browser-built model version (engine, font, kit and model are the frozen
// files its manifest names) and builds it. Runs in a Web Worker and in Node tests.

const MANIFOLD_STATIC = ["cube", "cylinder", "sphere", "tetrahedron", "extrude", "revolve", "compose",
  "union", "difference", "intersection", "levelSet", "smooth", "ofMesh", "hull"];
const MANIFOLD_MEMBER = ["add", "subtract", "intersect", "decompose", "warp", "transform", "translate", "rotate",
  "scale", "mirror", "calculateCurvature", "calculateNormals", "smoothByNormals", "smoothOut", "refine",
  "refineToLength", "refineToTolerance", "setProperties", "setTolerance", "simplify", "asOriginal", "trimByPlane",
  "split", "splitByPlane", "slice", "project", "hull"];
const CS_STATIC = ["square", "circle", "union", "difference", "intersection", "compose", "ofPolygons", "hull"];
const CS_MEMBER = ["add", "subtract", "intersect", "rectClip", "decompose", "transform", "translate", "rotate",
  "scale", "mirror", "simplify", "offset", "hull", "extrude", "revolve"];

// Track every object the engine hands out so a build can free them all afterwards.
function withGarbageCollection(wasm) {
  const live = [];
  const wrap = (owner, names) => {
    for (const name of names) {
      const fn = owner[name];
      if (typeof fn !== "function" || fn.__aess) continue;
      const wrapped = function (...args) {
        const out = fn.apply(this, args);
        if (out && typeof out === "object") live.push(out);
        return out;
      };
      wrapped.__aess = true;
      owner[name] = wrapped;
    }
  };
  wrap(wasm.Manifold, MANIFOLD_STATIC);
  wrap(wasm.Manifold.prototype, MANIFOLD_MEMBER);
  wrap(wasm.CrossSection, CS_STATIC);
  wrap(wasm.CrossSection.prototype, CS_MEMBER);
  return () => {
    for (const o of live.splice(0)) {
      for (const x of Array.isArray(o) ? o : [o]) { try { x.delete(); } catch {} }
    }
  };
}

export function createRuntime({ modelsBase, fetchBytes }) {
  const cache = new Map();
  const once = (key, fn) => { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); };
  const url = (path) => new URL(path, modelsBase).href;

  async function engine(path) {
    return once("engine:" + path, async () => {
      const Module = (await import(url(path))).default;
      const wasm = await Module();
      wasm.setup();
      return { wasm, cleanup: withGarbageCollection(wasm) };
    });
  }
  async function font(manifest) {
    const rt = manifest.runtime;
    return once("font:" + rt.font, async () => {
      const opentype = await import(url(rt.opentype));
      const bytes = await fetchBytes(url(rt.font));
      return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    });
  }
  async function module(manifest) {
    return once("model:" + manifest.model + manifest.version,
      () => import(url(`${manifest.model}/v${manifest.version}/${manifest.runtime.entry}`)));
  }

  return {
    async prepare(manifest) {
      await Promise.all([engine(manifest.runtime.manifold), font(manifest), module(manifest)]);
    },
    async codec(manifest) {
      return once("codec:" + manifest.runtime.codec, () => import(url(manifest.runtime.codec)));
    },
    // Build a design; returns plain arrays (safe to post between threads). With `onMesh`,
    // the mesh is handed over as soon as it exists and a print estimate is added after.
    async build(manifest, values, code, { noEngrave = false, onMesh = null, shouldEstimate = () => true } = {}) {
      const [{ wasm, cleanup }, f, mod] = await Promise.all([engine(manifest.runtime.manifold), font(manifest), module(manifest)]);
      const t0 = performance.now();
      try {
        const solid = mod.build(wasm, { font: f, noEngrave }, values, code);
        if (solid.status() !== "NoError") throw new Error(`model is not a valid solid (${solid.status()})`);
        const mesh = solid.getMesh();
        const bb = solid.boundingBox();
        const positions = new Float32Array(mesh.numVert * 3);
        for (let i = 0; i < mesh.numVert; i++) {
          positions[i * 3] = mesh.vertProperties[i * mesh.numProp];
          positions[i * 3 + 1] = mesh.vertProperties[i * mesh.numProp + 1];
          positions[i * 3 + 2] = mesh.vertProperties[i * mesh.numProp + 2];
        }
        const result = {
          positions, indices: new Uint32Array(mesh.triVerts),
          volume: solid.volume(), genus: solid.genus(), triangles: mesh.numTri,
          bbox: { min: [...bb.min], max: [...bb.max] }, ms: performance.now() - t0,
        };
        if (!onMesh) return result;
        onMesh(result);
        await new Promise((r) => setTimeout(r, 0)); // let newer requests arrive first
        return shouldEstimate() ? { estimate: estimatePrint(solid) } : {};
      } finally {
        cleanup();
      }
    },
  };
}

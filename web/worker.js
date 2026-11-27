// Builds models off the main thread so the page stays responsive.
import { createRuntime } from "./runtime.js";

const runtime = createRuntime({
  modelsBase: new URL("models/", self.location.href).href,
  fetchBytes: async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer()),
});

self.onmessage = async ({ data }) => {
  const { id, manifest, values, code } = data;
  try {
    if (data.type === "prepare") {
      await runtime.prepare(manifest);
      self.postMessage({ id, ok: true });
      return;
    }
    const r = await runtime.build(manifest, values, code);
    self.postMessage({ id, ok: true, result: r }, [r.positions.buffer, r.indices.buffer]);
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e?.message || e) });
  }
};

// Builds models off the main thread so the page stays responsive. Builds run one at a
// time; while one runs, only the newest waiting build is kept (older ones are skipped),
// and the print estimate is only worked out when no newer build is waiting.
import { createRuntime } from "./runtime.js";

const runtime = createRuntime({
  modelsBase: new URL("models/", self.location.href).href,
  fetchBytes: async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer()),
});

let queue = [];
let running = false;

self.onmessage = ({ data }) => {
  if (data.type === "build") {
    for (const old of queue.filter((m) => m.type === "build")) self.postMessage({ id: old.id, ok: false, skipped: true });
    queue = queue.filter((m) => m.type !== "build");
  }
  queue.push(data);
  pump();
};

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) await handle(queue.shift());
  running = false;
}

async function handle({ id, type, manifest, values, code }) {
  try {
    if (type === "prepare") {
      await runtime.prepare(manifest);
      self.postMessage({ id, ok: true });
      return;
    }
    const { estimate } = await runtime.build(manifest, values, code, {
      onMesh: (r) => self.postMessage({ id, ok: true, result: r }, [r.positions.buffer, r.indices.buffer]),
      shouldEstimate: () => !queue.some((m) => m.type === "build"),
    });
    if (estimate) self.postMessage({ id, estimate });
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e?.message || e) });
  }
}

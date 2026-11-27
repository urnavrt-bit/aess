import * as THREE from "three";
import { OrbitControls } from "three/addons/OrbitControls.js";
import { writeSTL, write3MF, readDesignFile } from "./files.js";

const SITE = "https://aess.billowapp.dev";

// ---------------------------------------------------------------- helpers
const $ = (s, root = document) => root.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = tag === "svg" ? document.createElementNS("http://www.w3.org/2000/svg", "svg") : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.setAttribute("class", v);
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, "");
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
};
const icon = (paths, cls = "i") => el("svg", { class: cls, viewBox: "0 0 24 24", html: paths });
const LS = {
  get(k, d) { try { const v = localStorage.getItem("aess." + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("aess." + k, JSON.stringify(v)); } catch {} },
};
const fmt = (n, d = 1) => (+n).toFixed(d).replace(/\.0+$/, "");

function toast(msg, err = false) {
  const t = el("div", { class: "toast" + (err ? " err" : "") }, msg);
  $("#toasts").append(t);
  setTimeout(() => t.remove(), err ? 5500 : 2600);
}

// ---------------------------------------------------------------- state
const S = {
  index: null,       // models/index.json
  manifest: null,    // browser-built manifest being edited
  values: {},
  baseline: {},
  baselineLabel: "the defaults",
  code: null,        // code of the current values
  result: null,      // last build (mesh arrays + stats) for `code`
  stack: false,
};
let codec = null;
const manifests = () => S.index.models;
const getManifest = (model, version) => manifests().find((m) => m.model === model && m.version === version && m.engine === "browser");
const latestOf = (model) => manifests().filter((m) => m.model === model && m.engine === "browser").sort((a, b) => b.version - a.version)[0];

// ---------------------------------------------------------------- build worker
const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
let nextId = 1;
const pending = new Map(), estimates = new Map();
worker.onmessage = ({ data }) => {
  if ("estimate" in data) {
    estimates.get(data.id)?.(data.estimate);
    estimates.delete(data.id);
    return;
  }
  const p = pending.get(data.id);
  if (!p) return;
  pending.delete(data.id);
  if (data.ok) p.resolve(data.result);
  else {
    estimates.delete(data.id);
    p.reject(Object.assign(new Error(data.error || "skipped"), { skipped: !!data.skipped }));
  }
};
// If the worker itself fails (e.g. a script didn't load), fail every waiting build.
function failAll(message) {
  for (const p of pending.values()) p.reject(new Error(message));
  pending.clear();
  estimates.clear();
}
worker.onerror = (e) => { e.preventDefault?.(); failAll("the 3D engine failed to start"); };
worker.onmessageerror = () => failAll("the 3D engine sent a broken reply");

// Resolves with the mesh; `onEstimate` is called a little later with the print estimate.
function work(msg, onEstimate = null) {
  const id = nextId++;
  if (onEstimate) estimates.set(id, onEstimate);
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ ...msg, id }); });
}

// ---------------------------------------------------------------- theme
let viewer = null;
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  viewer?.restyle();
}
applyTheme(LS.get("theme", null));
$("#themeBtn").onclick = () => {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const cur = document.documentElement.dataset.theme || (dark ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  LS.set("theme", next);
  applyTheme(next);
};

// ---------------------------------------------------------------- checks (shared expression syntax with the manifests)
function evalCheck(expr, vals) {
  const js = expr.replace(/\bnot\b/g, "!").replace(/\band\b/g, "&&").replace(/\bor\b/g, "||");
  const names = Object.keys(vals);
  const args = names.map((k) => (vals[k] === true ? 1 : vals[k] === false ? 0 : vals[k]));
  try { return !!new Function(...names, `return (${js});`)(...args); } catch { return true; }
}

// ---------------------------------------------------------------- panel
function renderTabs() {
  const nav = $("#modelTabs");
  nav.innerHTML = "";
  const reg = S.index.registry;
  const names = [...new Set(manifests().filter((m) => m.engine === "browser").map((m) => m.model))]
    .sort((a, b) => reg[a] - reg[b]);
  for (const name of names) {
    const m = latestOf(name);
    const active = S.manifest?.model === name;
    nav.append(el("button", { role: "tab", "aria-selected": String(active), onclick: () => selectModel(name) },
      m.title.replace("Storage ", "").replace(/^\w/, (c) => c.toUpperCase())));
  }
}

function selectModel(name, { version = null, values = null, label = null } = {}) {
  S.manifest = version ? getManifest(name, version) : latestOf(name);
  const defaults = Object.fromEntries(S.manifest.params.map((p) => [p.id, p.default]));
  const draft = values ? null : LS.get(`draft.${name}.v${S.manifest.version}`, null);
  S.values = { ...defaults, ...(values || draft || {}) };
  S.baseline = { ...defaults, ...(values || {}) };
  S.baselineLabel = label || (values ? "the original design" : "the defaults");
  LS.set("lastModel", name);
  renderTabs();
  renderPanel();
  onChange();
}

function renderPanel() {
  const m = S.manifest;
  $("#modelIntro").innerHTML = "";
  $("#modelIntro").append(
    el("h1", {}, m.title, el("span", { class: "ver", title: "Model version" }, `v${m.version}`)),
    el("p", {}, m.summary),
  );
  const latest = latestOf(m.model);
  const note = $("#versionNote");
  note.hidden = m.version === latest.version;
  if (!note.hidden) {
    note.innerHTML = "";
    note.append(
      el("div", {}, `This design uses ${m.title} v${m.version}; v${latest.version} is available. Your design stays exactly as it was unless you open it in the new version.`),
      el("div", { class: "row-end" }, el("button", { class: "btn ghost", onclick: () => openInLatest(m.model, S.values) }, `Open in v${latest.version}`)));
  }
  const pre = $("#presets");
  pre.innerHTML = "";
  for (const p of m.presets || []) pre.append(el("button", { class: "chip", title: p.help, onclick: () => applyPreset(p) }, p.name));

  const groups = $("#groups");
  groups.innerHTML = "";
  const openGroups = LS.get("openGroups", ["size", "strength", "inside", "edge", "floor"]);
  for (const g of m.groups) {
    const det = el("details", { class: "group", "data-group": g.id, open: openGroups.includes(g.id) });
    det.addEventListener("toggle", () => {
      const cur = new Set(LS.get("openGroups", openGroups));
      det.open ? cur.add(g.id) : cur.delete(g.id);
      LS.set("openGroups", [...cur]);
    });
    det.append(el("summary", {}, g.title, el("span", { class: "changed-count" }), icon('<path d="M6 9l6 6 6-6"/>', "chev")));
    det.append(el("div", { class: "group-help" }, g.help));
    const body = el("div", { class: "group-body" });
    for (const p of m.params.filter((q) => q.group === g.id)) body.append(renderParam(p));
    if (m.model === "baseplate" && g.id === "size") {
      body.append(el("div", { class: "extra" }, el("button", { class: "link-btn", onclick: openFit }, "Fit to a drawer…")));
    }
    det.append(body);
    groups.append(det);
  }
}

function infoBtn(text) {
  const b = el("button", { class: "info", type: "button", "aria-label": text }, "?");
  let tip;
  const show = () => {
    tip = el("div", { class: "tip" }, text);
    document.body.append(tip);
    const r = b.getBoundingClientRect(), tw = tip.offsetWidth;
    tip.style.left = Math.max(8, Math.min(innerWidth - tw - 8, r.left + r.width / 2 - tw / 2)) + "px";
    tip.style.top = (r.bottom + 8) + "px";
  };
  const hide = () => { tip?.remove(); tip = null; };
  b.addEventListener("mouseenter", show); b.addEventListener("mouseleave", hide);
  b.addEventListener("focus", show); b.addEventListener("blur", hide);
  b.addEventListener("click", (e) => { e.preventDefault(); tip ? hide() : show(); });
  return b;
}

const RESET_ICON = '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>';
function resetBtn(p) {
  return el("button", {
    class: "reset", type: "button", tabindex: "-1",
    onclick: () => { S.values[p.id] = S.baseline[p.id]; syncControls(); onChange(); },
  }, icon(RESET_ICON, ""));
}
function fmtValue(p, v) {
  if (p.type === "bool") return v ? "on" : "off";
  return `${v}${p.unit === "units" ? " u" : p.unit ? ` ${p.unit}` : ""}`;
}
const isChanged = (p) => (p.type === "bool" ? !!S.values[p.id] !== !!S.baseline[p.id] : Math.abs(S.values[p.id] - S.baseline[p.id]) > 1e-9);

function updateChanged() {
  const counts = {};
  let total = 0;
  for (const p of S.manifest.params) {
    const wrap = document.querySelector(`[data-param="${p.id}"]`);
    if (!wrap) continue;
    const changed = isChanged(p);
    wrap.classList.toggle("changed", changed);
    const btn = $(".reset", wrap);
    btn.title = `Reset to ${S.baselineLabel}: ${fmtValue(p, S.baseline[p.id])}`;
    btn.setAttribute("aria-label", `Reset ${p.label} to ${fmtValue(p, S.baseline[p.id])}`);
    btn.tabIndex = changed ? 0 : -1;
    if (changed) { counts[p.group] = (counts[p.group] || 0) + 1; total++; }
  }
  document.querySelectorAll(".group").forEach((g) => {
    const n = counts[g.dataset.group] || 0;
    $(".changed-count", g).textContent = n ? `${n} changed` : "";
  });
  $("#resetBar").hidden = total === 0;
  $("#resetMsg").textContent = `${total} ${total === 1 ? "value differs" : "values differ"} from ${S.baselineLabel}`;
}
$("#resetAll").onclick = () => { S.values = { ...S.baseline }; syncControls(); onChange(); toast(`Back to ${S.baselineLabel}`); };

function renderParam(p) {
  const id = "p_" + p.id;
  if (p.type === "bool") {
    const input = el("input", { type: "checkbox", id, checked: !!S.values[p.id] });
    input.addEventListener("change", () => setValue(p.id, input.checked));
    return el("div", { class: "param", "data-param": p.id },
      el("div", { class: "switch-row" }, el("label", { class: "name", for: id }, p.label), infoBtn(p.help), resetBtn(p),
        el("span", { class: "switch" }, input, el("span"))));
  }
  const range = el("input", { type: "range", min: p.min, max: p.max, step: p.step, value: S.values[p.id], "aria-label": p.label });
  const num = el("input", { class: "num", id, type: "number", inputmode: "decimal", min: p.min, max: p.max, step: p.step, value: S.values[p.id] });
  const setFill = () => range.style.setProperty("--p", `${((range.value - p.min) / (p.max - p.min)) * 100}%`);
  setFill();
  range.addEventListener("input", () => { num.value = range.value; setFill(); setValue(p.id, +range.value); });
  num.addEventListener("input", () => {
    if (num.value === "" || isNaN(+num.value)) return;
    range.value = num.value; setFill(); setValue(p.id, +num.value);
  });
  num.addEventListener("change", () => {
    const v = codec.normalizeValue(p, +num.value);
    num.value = v; range.value = v; setFill(); setValue(p.id, v);
  });
  const unit = p.unit === "units" ? "u" : p.unit;
  return el("div", { class: "param", "data-param": p.id },
    el("div", { class: "param-head" }, el("label", { for: id }, p.label), infoBtn(p.help), resetBtn(p)),
    el("div", { class: "param-ctl" }, range, el("div", { class: "num-wrap" }, num, unit ? el("span", { class: "unit" }, unit) : null)));
}

function syncControls() {
  for (const p of S.manifest.params) {
    const wrap = document.querySelector(`[data-param="${p.id}"]`);
    if (!wrap) continue;
    if (p.type === "bool") $("input", wrap).checked = !!S.values[p.id];
    else {
      const [range, num] = wrap.querySelectorAll("input");
      range.value = num.value = S.values[p.id];
      range.style.setProperty("--p", `${((S.values[p.id] - p.min) / (p.max - p.min)) * 100}%`);
    }
  }
}

function applyPreset(preset) {
  for (const p of S.manifest.params) S.values[p.id] = p.default;
  Object.assign(S.values, preset.values);
  syncControls();
  onChange();
  toast(`Preset: ${preset.name}`);
}
function setValue(id, v) { S.values[id] = v; onChange(); }

function validate() {
  const issues = [], bad = new Set();
  for (const p of S.manifest.params) {
    const v = S.values[p.id];
    if (p.type !== "bool" && (typeof v !== "number" || isNaN(v) || v < p.min || v > p.max)) {
      issues.push(`${p.label} must be between ${p.min} and ${p.max}.`);
      bad.add(p.id);
    }
  }
  for (const c of S.manifest.checks || []) if (!evalCheck(c.expr, S.values)) issues.push(c.message);
  return { issues, bad };
}

// ---------------------------------------------------------------- live build
let buildTimer, buildSeq = 0;
function onChange() {
  for (const p of S.manifest.params) {
    const wrap = document.querySelector(`[data-param="${p.id}"]`);
    if (wrap) wrap.classList.toggle("disabled", !!p.requires && !S.values[p.requires]);
  }
  updateChanged();
  const { issues, bad } = validate();
  document.querySelectorAll(".param").forEach((w) => w.classList.toggle("invalid", bad.has(w.dataset.param)));
  const list = $("#issues");
  list.hidden = !issues.length;
  list.innerHTML = "";
  issues.forEach((i) => list.append(el("li", {}, i)));
  updateDims();
  LS.set(`draft.${S.manifest.model}.v${S.manifest.version}`, S.values);
  if (issues.length) {
    S.code = null; S.result = null;
    setUrl(null);
    renderResult();
    return;
  }
  S.code = codec.encode(S.manifest, S.index.registry, S.values);
  setUrl(S.code);
  renderResult("building");
  clearTimeout(buildTimer);
  buildTimer = setTimeout(rebuild, 60);
}

async function rebuild() {
  const seq = ++buildSeq, code = S.code, manifest = S.manifest, values = { ...S.values };
  if (!(await S.engineReady)) {
    if (seq === buildSeq) renderResult("error", "the 3D engine couldn't load");
    return;
  }
  try {
    const job = work({ type: "build", manifest, values, code }, (estimate) => {
      if (S.result?.code !== code) return;
      S.result.estimate = estimate;
      renderResult();
    });
    // Never spin forever: a build that hasn't answered in 20 s is reported as failed.
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("the 3D engine isn't responding")), 20000); });
    const r = await Promise.race([job, timeout]).finally(() => clearTimeout(timer));
    if (seq !== buildSeq) return; // a newer edit is on its way
    S.result = { ...r, code, manifest, values };
    viewer.showMesh(r.positions, r.indices);
    renderResult();
  } catch (e) {
    if (seq !== buildSeq || e.skipped) return;
    S.result = null;
    renderResult("error", e.message);
  }
}

function setUrl(code) {
  const url = new URL(location.href);
  url.search = code ? `?c=${code}` : "";
  url.hash = "";
  if (url.href !== location.href) history.replaceState(null, "", url);
}

// ---------------------------------------------------------------- result panel
function renderResult(state = "ready", error = "") {
  const r = $("#result");
  r.innerHTML = "";
  if (!S.code) {
    r.append(el("div", { class: "build-msg" }, "Fix the highlighted settings to get a printable design."));
    return;
  }
  const chip = el("button", { class: "code-chip", title: "Copy code" }, S.code);
  chip.onclick = () => copy(S.code, "Code copied");
  const share = el("button", { class: "btn ghost", title: "Copy share link" },
    icon('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'), "Link");
  share.onclick = () => copy(shareLink(S.code), "Share link copied");
  r.append(el("div", { class: "code-row" }, chip, share));
  r.append(el("div", { class: "build-msg" }, "This code is engraved under the part and saved inside the files. Type it in, or open the file here, to get this exact design back."));
  const ready = state === "ready" && S.result?.code === S.code;
  if (state === "error") {
    r.append(el("div", { class: "error-box" }, `This design couldn't be built: ${error}. `,
      el("button", { class: "link-btn", onclick: () => location.reload() }, "Reload the page")));
  }
  const dl = el("div", { class: "dl-row two" },
    el("button", { class: "btn primary", disabled: !ready, onclick: () => download("3mf"), title: "Best for slicers: Bambu Studio, PrusaSlicer, OrcaSlicer, Cura" },
      icon('<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 19h14"/>'), "Download 3MF"),
    el("button", { class: "btn", disabled: !ready, onclick: () => download("stl"), title: "Works with any slicer" }, "STL"));
  r.append(dl);
  if (ready) {
    const est = S.result.estimate;
    const how = "Estimated like a slicer would print it: PETG, 0.2 mm layers, 3 walls, 4 top/bottom layers, 15% infill. Your slicer may differ by about 10%.";
    r.append(el("div", { class: "stats" },
      el("div", { class: "stat", title: est ? `${how} Printed 100% solid it would be ${Math.round(est.solidGrams)} g.` : how },
        el("b", {}, est ? `≈ ${Math.round(est.grams)} g` : "…"), el("span", {}, "filament (PETG)")),
      el("div", { class: "stat", title: how }, el("b", {}, est ? `≈ ${fmt(est.meters)} m` : "…"), el("span", {}, "of 1.75 mm")),
      el("div", { class: "stat" }, el("b", {}, `${Math.max(1, Math.round(S.result.ms))} ms`), el("span", {}, "build time"))));
  } else if (state === "building") {
    r.append(el("div", { class: "progress" }, el("i")));
  }
}

function shareLink(code) {
  const base = location.hostname.endsWith("github.io") ? location.origin + location.pathname.replace(/[^/]*$/, "") : `${SITE}/`;
  return `${base}?c=${code}`;
}

async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); } catch { prompt("Copy this:", text); }
  remember(S.code);
}

function designName(m, v) {
  return m.model === "bin" ? `bin-${v.gx}x${v.gy}x${v.gz}` : `baseplate-${v.gx}x${v.gy}`;
}

async function download(kind) {
  const { positions, indices, code, manifest, values, estimate } = S.result;
  const name = `aess-${designName(manifest, values)}-${code}.${kind}`;
  const config = {
    aess: 1, code, model: manifest.model, version: manifest.version, params: values,
    generator: shareLink(code), created: new Date().toISOString(),
  };
  const title = `AESS ${manifest.title} ${designName(manifest, values).split("-")[1]} (${code})`;
  let blob;
  if (kind === "stl") {
    blob = writeSTL(positions, indices, `AESS ${code} ${manifest.model} v${manifest.version} aess.billowapp.dev`);
  } else {
    const thumbnail = await viewer.thumbnail();
    const description = `${manifest.title} v${manifest.version}. ` +
      manifest.params.map((p) => `${p.label}: ${fmtValue(p, values[p.id])}`).join("; ") +
      (estimate ? `. About ${Math.round(estimate.grams)} g of PETG (0.2 mm layers, 3 walls, 15% infill)` : "") +
      `. Reopen or edit: ${config.generator}`;
    blob = await write3MF(positions, indices, { config, title, description, thumbnail });
  }
  const a = el("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  remember(code);
}

function remember(code) {
  if (!code || !S.manifest) return;
  const v = S.values;
  const desc = S.manifest.model === "bin" ? `Bin ${v.gx}×${v.gy}×${v.gz}` : `Baseplate ${v.gx}×${v.gy}`;
  const list = LS.get("recent", []).filter((r) => r.code !== code);
  list.unshift({ code, desc: `${desc} · v${S.manifest.version}`, t: Date.now() });
  LS.set("recent", list.slice(0, 40));
}

// ---------------------------------------------------------------- opening codes and files
async function openCode(raw, { quiet = false } = {}) {
  const text = String(raw).trim();
  if (!text) return;
  try {
    if (!codec.normalizeCode(text)) throw new Error("That doesn't look like an AESS code (they start with AE2-).");
    const d = codec.decode(text, S.index.registry, getManifest);
    selectModel(d.model, { version: d.version, values: d.values, label: d.code });
    if (!quiet) toast(`Opened ${d.code}`);
  } catch (e) {
    toast(e.message, true);
  }
}
$("#codeForm").addEventListener("submit", (e) => { e.preventDefault(); openCode($("#codeInput").value); $("#codeInput").value = ""; });

function openInLatest(model, values) {
  const latest = latestOf(model);
  const carried = Object.fromEntries(Object.entries(values).filter(([k]) => latest.params.some((p) => p.id === k)));
  selectModel(model, { values: carried, label: "the original design" });
  toast(`Opened in ${latest.title} v${latest.version}. It has a new code.`);
}

async function openFile(file) {
  try {
    const { code } = await readDesignFile(file);
    await openCode(code, { quiet: true });
    toast(`Opened ${code} from ${file.name}`);
  } catch (e) {
    toast(e.message, true);
  }
}
$("#fileBtn").onclick = () => $("#fileInput").click();
$("#fileInput").onchange = (e) => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ""; };
let dragDepth = 0;
addEventListener("dragenter", (e) => { if (e.dataTransfer?.types.includes("Files")) { dragDepth++; document.body.classList.add("dropping"); } });
addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove("dropping"); } });
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", (e) => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove("dropping");
  const f = e.dataTransfer?.files?.[0];
  if (f) openFile(f);
});

// ---------------------------------------------------------------- dimensions HUD
function updateDims() {
  const v = S.values, box = $("#dims");
  if (S.manifest.model === "bin") {
    const W = 42 * v.gx - 0.5, D = 42 * v.gy - 0.5, H = 7 * v.gz, Ht = H + (v.lip ? 4.4 - v.lip_flat : 0);
    const iw = W - 2 * v.wall, id = D - 2 * v.wall, depth = H - (v.lip ? 2.6 - v.wall : 0) - v.floor_z;
    const cw = (iw - v.ndx * v.div_t) / (v.ndx + 1), cd = (id - v.ndy * v.div_t) / (v.ndy + 1);
    const comp = (v.ndx + 1) * (v.ndy + 1);
    box.innerHTML = `<div class="big">${fmt(W)} × ${fmt(D)} × ${fmt(Ht)} mm</div>
      <div class="sub">Inside <b>${fmt(iw)} × ${fmt(id)}</b>, <b>${fmt(depth)}</b> deep</div>
      ${comp > 1 ? `<div class="sub"><b>${comp}</b> compartments of <b>${fmt(cw)} × ${fmt(cd)}</b> mm</div>` : ""}
      <div class="sub">${v.lip ? "Stackable" : "Flat top, no stacking"} · fits ${v.gx}×${v.gy} grid</div>`;
  } else {
    const W = 42 * v.gx - 0.5 + 2 * v.pad_x, D = 42 * v.gy - 0.5 + 2 * v.pad_y, Hp = 4.65 + v.floor_t;
    const bed = LS.get("bed", 256), fits = W <= bed && D <= bed;
    box.innerHTML = `<div class="big">${fmt(W)} × ${fmt(D)} × ${fmt(Hp, 2)} mm</div>
      <div class="sub">Holds <b>${v.gx * v.gy}</b> grid squares (${v.gx} × ${v.gy})</div>
      <div class="sub">${fits ? `Fits a ${bed} mm bed` : `<span style="color:var(--warn)">Larger than a ${bed} mm bed: split into smaller plates</span>`}</div>`;
  }
}

// ---------------------------------------------------------------- dialogs
document.querySelectorAll("dialog [data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));
$("#helpBtn").onclick = () => $("#helpDlg").showModal();
document.querySelectorAll(".help-nav a").forEach((a) => a.addEventListener("click", (e) => {
  e.preventDefault(); $(a.getAttribute("href")).scrollIntoView({ behavior: "smooth", block: "start" });
}));
$("#recentBtn").onclick = () => {
  const list = LS.get("recent", []);
  const ul = $("#recentList");
  ul.innerHTML = "";
  $("#recentEmpty").hidden = list.length > 0;
  for (const r of list) {
    ul.append(el("li", {}, el("button", { onclick: () => { $("#recentDlg").close(); openCode(r.code); } },
      el("span", { class: "c" }, r.code), el("span", { class: "d" }, r.desc), el("span", { class: "t" }, new Date(r.t).toLocaleDateString()))));
  }
  $("#recentDlg").showModal();
};

function openFit() {
  const f = $("#fitForm");
  f.bed.value = LS.get("bed", 256);
  const calc = () => {
    const w = +f.w.value, d = +f.d.value, c = +f.c.value || 0, bed = +f.bed.value || 256;
    const gx = Math.max(1, Math.floor((w - 2 * c + 0.5) / 42)), gy = Math.max(1, Math.floor((d - 2 * c + 0.5) / 42));
    const px = Math.max(0, (w - 2 * c - (42 * gx - 0.5)) / 2), py = Math.max(0, (d - 2 * c - (42 * gy - 0.5)) / 2);
    const fx = Math.min(40, Math.floor(px * 4) / 4), fy = Math.min(40, Math.floor(py * 4) / 4);
    const W = 42 * gx - 0.5 + 2 * fx, D = 42 * gy - 0.5 + 2 * fy;
    const per = Math.max(1, Math.floor((bed - 2) / 42));
    $("#fitOut").innerHTML = `Grid <b>${gx} × ${gy}</b> (${gx * gy} squares), padding <b>${fx}</b> / <b>${fy}</b> mm per side.<br>Plate: <b>${fmt(W)} × ${fmt(D)} mm</b>.` +
      (W > bed || D > bed ? `<br>Too big for a ${bed} mm bed: print <b>${Math.ceil(gx / per) * Math.ceil(gy / per)}</b> plates of up to ${per} × ${per} squares and set the padding only on the outer edges.` : "");
    return { gx: Math.min(10, gx), gy: Math.min(10, gy), pad_x: fx, pad_y: fy, bed };
  };
  f.oninput = calc;
  calc();
  $("#fitDlg").showModal();
  $("#fitDlg").onclose = () => {
    if ($("#fitDlg").returnValue !== "apply") return;
    const r = calc();
    LS.set("bed", r.bed);
    Object.assign(S.values, { gx: r.gx, gy: r.gy, pad_x: r.pad_x, pad_y: r.pad_y });
    syncControls();
    onChange();
  };
}

// ---------------------------------------------------------------- viewer
class Viewer {
  constructor(host) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    host.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(-120, -200, 260);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.6);
    rim.position.set(200, 160, 120);
    this.scene.add(rim);
    const under = new THREE.DirectionalLight(0xffffff, 0.5);
    under.position.set(0, 80, -200);
    this.scene.add(under);
    this.grid = new THREE.GridHelper(1008, 24, 0x000000, 0x000000);
    this.grid.rotation.x = Math.PI / 2;
    this.grid.material.transparent = true;
    this.scene.add(this.grid);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.mat = new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide });
    this.ghost = new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: 0.55, transparent: true, opacity: 0.4 });
    this.mesh = null;
    this.fitted = null;
    this.view = "iso";
    this.restyle();
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    const loop = () => { this.controls.update(); this.renderer.render(this.scene, this.camera); requestAnimationFrame(loop); };
    loop();
  }
  restyle() {
    const cs = getComputedStyle(document.documentElement);
    const dark = cs.getPropertyValue("color-scheme").trim() === "dark";
    this.grid.material.opacity = dark ? 0.14 : 0.08;
    this.grid.material.color.set(dark ? 0xffffff : 0x000000);
    this.mat.color.set(dark ? 0xa3a9b3 : 0xc9ccd2);
    this.ghost.color.set(dark ? 0xa3a9b3 : 0xc9ccd2);
  }
  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  setGeometry(geom) {
    geom.computeVertexNormals();
    for (const c of [...this.group.children]) { this.group.remove(c); if (c.geometry !== geom) c.geometry?.dispose(); }
    this.group.add(new THREE.Mesh(geom, this.mat));
    if (S.stack && S.manifest?.model === "bin" && S.values.lip) {
      const top = new THREE.Mesh(geom, this.ghost);
      top.position.z = 7 * S.values.gz;
      this.group.add(top);
    }
    const size = new THREE.Box3().setFromObject(this.group).getSize(new THREE.Vector3());
    const key = [size.x, size.y, size.z].map((x) => Math.round(x / 20)).join(":");
    if (key !== this.fitted) { this.fitted = key; this.frame(this.view); }
  }
  showMesh(positions, indices) {
    // flat shading: split vertices so edges stay crisp
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setIndex(new THREE.BufferAttribute(indices, 1));
    this.lastGeom = geom.toNonIndexed();
    this.setGeometry(this.lastGeom);
  }
  refresh() { if (this.lastGeom) this.setGeometry(this.lastGeom); }
  frame(view = "iso") {
    this.view = view;
    const box = new THREE.Box3().setFromObject(this.group);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const r = Math.max(s.x, s.y, s.z * 1.4, 40);
    const d = r * 2.2 / Math.min(1, this.camera.aspect * 0.95);
    const dirs = { iso: [-0.75, -1.15, 0.95], top: [0, -0.001, 1], front: [0, -1, 0.12], bottom: [0.001, -0.25, -1] };
    this.camera.position.copy(c).add(new THREE.Vector3(...dirs[view]).normalize().multiplyScalar(d));
    this.controls.target.copy(c);
    this.camera.near = d / 100; this.camera.far = d * 20;
    this.camera.updateProjectionMatrix();
  }
  // A square iso render for the 3MF thumbnail.
  async thumbnail() {
    const size = 512, cam = this.camera.clone(), old = this.renderer.getSize(new THREE.Vector2());
    const box = new THREE.Box3().setFromObject(this.group), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const d = Math.max(s.x, s.y, s.z * 1.4, 40) * 2.1;
    cam.aspect = 1;
    cam.position.copy(c).add(new THREE.Vector3(-0.75, -1.15, 0.95).normalize().multiplyScalar(d));
    cam.lookAt(c);
    cam.updateProjectionMatrix();
    const grid = this.grid.visible;
    this.grid.visible = false;
    this.renderer.setSize(size, size, false);
    this.renderer.render(this.scene, cam);
    const blob = await new Promise((res) => this.renderer.domElement.toBlob(res, "image/png"));
    this.grid.visible = grid;
    this.renderer.setSize(old.x, old.y);
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  }
}

viewer = new Viewer($("#viewer"));
document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => viewer.frame(b.dataset.view)));
$("#stackBtn").addEventListener("click", () => {
  S.stack = !S.stack;
  $("#stackBtn").classList.toggle("on", S.stack);
  viewer.fitted = null;
  viewer.refresh();
});

// ---------------------------------------------------------------- boot
(async function boot() {
  try {
    S.index = await (await fetch("models/index.json", { cache: "no-cache" })).json();
  } catch {
    toast("Couldn't load the models. Please reload.", true);
    return;
  }
  const first = latestOf(LS.get("lastModel", "bin")) || latestOf("bin");
  codec = await import(`./models/${first.runtime.codec}`);
  // Load the 3D engine. If it isn't ready in 15 s, say so (with a reload button) instead
  // of spinning; if it turns up later after all, carry on as normal.
  // The panel shows straight away; builds wait for the engine.
  const prepared = work({ type: "prepare", manifest: first }).then(() => true, () => false);
  S.engineReady = Promise.race([prepared, new Promise((r) => setTimeout(() => r(false), 15000))]);
  S.engineReady.then((ok) => {
    if (!ok) prepared.then((late) => { if (late) { S.engineReady = Promise.resolve(true); onChange(); } });
  });
  // ?c=CODE share links
  const q = new URLSearchParams(location.search).get("c") || (location.hash.match(/c=([\w-]+)/) || [])[1];
  if (q) {
    selectModel(first.model);
    await openCode(q, { quiet: true });
  } else {
    selectModel(first.model);
  }
})();

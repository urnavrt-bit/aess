import * as THREE from "three";
import { OrbitControls } from "three/addons/OrbitControls.js";
import { STLLoader } from "three/addons/STLLoader.js";

// ---------------------------------------------------------------- state
const $ = (s, el = document) => el.querySelector(s);
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

const S = {
  models: {},        // name -> { versions: {v: manifest}, latest }
  manifest: null,    // manifest being edited
  values: {},        // current values
  baseline: {},      // what "reset" goes back to: the defaults, or the values of the opened code
  baselineLabel: "the defaults",
  code: null,        // code of the generated design matching `values` (null when edited since)
  loadedCode: null,  // code opened from the URL or the code box
  poll: null,
  stack: false,
};
const LS = {
  get(k, d) { try { const v = localStorage.getItem("aess." + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("aess." + k, JSON.stringify(v)); } catch {} },
};

// ---------------------------------------------------------------- api
async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  let data = {};
  try { data = await r.json(); } catch {}
  if (!r.ok) {
    const err = new Error(data.error || `request failed (${r.status})`);
    err.details = data.details || [];
    err.status = r.status;
    throw err;
  }
  return data;
}

function toast(msg, err = false) {
  const t = el("div", { class: "toast" + (err ? " err" : "") }, msg);
  $("#toasts").append(t);
  setTimeout(() => t.remove(), err ? 5000 : 2600);
}

// ---------------------------------------------------------------- theme
let viewer = null; // created once the page is set up (see bottom)
const themeBtn = $("#themeBtn");
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  viewer?.restyle();
}
applyTheme(LS.get("theme", null));
themeBtn.onclick = () => {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const cur = document.documentElement.dataset.theme || (dark ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  LS.set("theme", next);
  applyTheme(next);
};

// ---------------------------------------------------------------- expressions (manifest checks)
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
  for (const [name, info] of Object.entries(S.models)) {
    const m = info.versions[info.latest];
    nav.append(el("button", {
      role: "tab", "aria-selected": String(S.manifest?.model === name),
      onclick: () => { if (S.manifest?.model !== name) selectModel(name); },
    }, m.title.replace("Storage ", "").replace(/^\w/, (c) => c.toUpperCase())));
  }
}

function selectModel(name, version = null, values = null) {
  const info = S.models[name];
  const v = version ?? info.latest;
  S.manifest = info.versions[v];
  const saved = LS.get(`draft.${name}.v${v}`, null);
  S.values = {};
  for (const p of S.manifest.params) S.values[p.id] = p.default;
  S.baseline = { ...S.values, ...(values || {}) };
  S.baselineLabel = values ? "the original design" : "the defaults";
  Object.assign(S.values, values || saved || {});
  S.code = null;
  clearInterval(S.poll);
  $("#result").hidden = true;
  if (!values) { S.loadedCode = null; setUrl(null); }
  resetGen();
  renderTabs();
  renderPanel();
  onChange(true);
}

function renderPanel() {
  const m = S.manifest;
  const latest = S.models[m.model].latest;
  $("#modelIntro").innerHTML = "";
  $("#modelIntro").append(
    el("h1", {}, m.title, el("span", { class: "ver", title: "Model version" }, `v${m.version}`)),
    el("p", {}, m.summary),
  );
  const note = $("#versionNote");
  if (m.version < latest) {
    note.hidden = false;
    note.innerHTML = "";
    note.append(
      el("div", {}, `This design uses ${m.title} v${m.version}. Version ${latest} is available. Your design is unchanged; it will keep building exactly as it was.`),
      el("div", { class: "row-end" },
        el("button", { class: "btn ghost", onclick: upgradeDesign }, `Open in v${latest}`)),
    );
  } else note.hidden = true;

  const pre = $("#presets");
  pre.innerHTML = "";
  for (const p of m.presets || []) {
    pre.append(el("button", { class: "chip", title: p.help, onclick: () => applyPreset(p) }, p.name));
  }
  pre.after($("#resetBar") || el("div", { class: "reset-bar", id: "resetBar", hidden: true },
    el("span", { class: "reset-msg" }),
    el("button", { class: "link-btn", type: "button", onclick: resetAll }, "Reset all")));

  const groups = $("#groups");
  groups.innerHTML = "";
  const openGroups = LS.get("openGroups", ["size", "strength", "inside", "edge", "floor"]);
  for (const g of m.groups) {
    const params = m.params.filter((p) => p.group === g.id);
    const det = el("details", { class: "group", "data-group": g.id, open: openGroups.includes(g.id) });
    det.addEventListener("toggle", () => {
      const cur = new Set(LS.get("openGroups", openGroups));
      det.open ? cur.add(g.id) : cur.delete(g.id);
      LS.set("openGroups", [...cur]);
    });
    det.append(el("summary", {}, g.title, el("span", { class: "changed-count" }),
      el("svg", { class: "chev", viewBox: "0 0 24 24", html: '<path d="M6 9l6 6 6-6"/>' })));
    det.append(el("div", { class: "group-help" }, g.help));
    const body = el("div", { class: "group-body" });
    for (const p of params) body.append(renderParam(p));
    if (m.model === "baseplate" && g.id === "size") {
      body.append(el("div", { class: "extra" },
        el("button", { class: "link-btn", onclick: openFit }, "Fit to a drawer…")));
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
    const r = b.getBoundingClientRect();
    const tw = tip.offsetWidth;
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
  }, el("svg", { viewBox: "0 0 24 24", html: RESET_ICON }));
}

function fmtValue(p, v) {
  if (p.type === "bool") return v ? "on" : "off";
  const unit = p.unit === "units" ? " u" : p.unit ? ` ${p.unit}` : "";
  return `${v}${unit}`;
}

const isChanged = (p) => p.type === "bool"
  ? !!S.values[p.id] !== !!S.baseline[p.id]
  : Math.abs(S.values[p.id] - S.baseline[p.id]) > 1e-9;

function updateChanged() {
  const origin = S.baselineLabel;
  const counts = {};
  let total = 0;
  for (const p of S.manifest.params) {
    const wrap = document.querySelector(`[data-param="${p.id}"]`);
    if (!wrap) continue;
    const changed = isChanged(p);
    wrap.classList.toggle("changed", changed);
    const btn = $(".reset", wrap);
    btn.title = `Reset to ${origin}: ${fmtValue(p, S.baseline[p.id])}`;
    btn.setAttribute("aria-label", `Reset ${p.label} to ${fmtValue(p, S.baseline[p.id])}`);
    btn.tabIndex = changed ? 0 : -1;
    if (changed) { counts[p.group] = (counts[p.group] || 0) + 1; total++; }
  }
  document.querySelectorAll(".group").forEach((g) => {
    const n = counts[g.dataset.group] || 0;
    $(".changed-count", g).textContent = n ? `${n} changed` : "";
  });
  const bar = $("#resetBar");
  if (bar) {
    bar.hidden = total === 0;
    $(".reset-msg", bar).textContent =
      `${total} ${total === 1 ? "value differs" : "values differ"} from ${S.baselineLabel}`;
  }
}

function resetAll() {
  S.values = { ...S.baseline };
  syncControls();
  onChange();
  toast(`Back to ${S.baselineLabel}`);
}

function renderParam(p) {
  const id = "p_" + p.id;
  if (p.type === "bool") {
    const input = el("input", { type: "checkbox", id, checked: !!S.values[p.id] });
    input.addEventListener("change", () => setValue(p.id, input.checked));
    return el("div", { class: "param", "data-param": p.id },
      el("div", { class: "switch-row" },
        el("label", { class: "name", for: id }, p.label), infoBtn(p.help), resetBtn(p),
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
    let v = Math.min(p.max, Math.max(p.min, +num.value || p.min));
    v = p.type === "int" ? Math.round(v) : Math.round(v / p.step) * p.step;
    v = +v.toFixed(4);
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

function setValue(id, v) {
  S.values[id] = v;
  onChange();
}

function validate() {
  const issues = [];
  const bad = new Set();
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

let changeTimer;
function onChange(initial = false) {
  // dependent params
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
  $("#generateBtn").disabled = issues.length > 0;

  if (!initial && S.code) {
    S.code = null;
    clearInterval(S.poll);
    $("#result").classList.add("stale");
    setUrl(null);
    if (!genBtn.classList.contains("busy")) $(".lbl", genBtn).textContent = "Generate model";
  }
  if (!S.code) setBadge(false);
  updateDims();
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    viewer.showSketch(S.manifest.model, S.values);
    LS.set(`draft.${S.manifest.model}.v${S.manifest.version}`, S.values);
  }, initial ? 0 : 40);
}

// ---------------------------------------------------------------- dimensions HUD
const fmt = (n, d = 1) => (+n).toFixed(d).replace(/\.0+$/, "");
function binGeom(v) {
  const W = 42 * v.gx - 0.5, D = 42 * v.gy - 0.5, H = 7 * v.gz;
  const Ht = H + (v.lip ? 4.4 - v.lip_flat : 0);
  const iw = W - 2 * v.wall, id = D - 2 * v.wall;
  const depth = H - (v.lip ? 2.6 - v.wall : 0) - v.floor_z;
  const cw = (iw - v.ndx * v.div_t) / (v.ndx + 1), cd = (id - v.ndy * v.div_t) / (v.ndy + 1);
  return { W, D, H, Ht, iw, id, depth, cw, cd };
}
function plateGeom(v) {
  const W = 42 * v.gx - 0.5 + 2 * v.pad_x, D = 42 * v.gy - 0.5 + 2 * v.pad_y, Hp = 4.65 + v.floor_t;
  return { W, D, Hp };
}
function updateDims() {
  const v = S.values, box = $("#dims");
  box.className = "hud top-left dims";
  if (S.manifest.model === "bin") {
    const g = binGeom(v);
    const comp = (v.ndx + 1) * (v.ndy + 1);
    box.innerHTML = `<div class="big">${fmt(g.W)} × ${fmt(g.D)} × ${fmt(g.Ht)} mm</div>
      <div class="sub">Inside <b>${fmt(g.iw)} × ${fmt(g.id)}</b>, <b>${fmt(g.depth)}</b> deep</div>
      ${comp > 1 ? `<div class="sub"><b>${comp}</b> compartments of <b>${fmt(g.cw)} × ${fmt(g.cd)}</b> mm</div>` : ""}
      <div class="sub">${v.lip ? "Stackable" : "Flat top, no stacking"} · fits ${v.gx}×${v.gy} grid</div>`;
  } else {
    const g = plateGeom(v);
    const bed = LS.get("bed", 256);
    const fits = g.W <= bed && g.D <= bed;
    box.innerHTML = `<div class="big">${fmt(g.W)} × ${fmt(g.D)} × ${fmt(g.Hp, 2)} mm</div>
      <div class="sub">Holds <b>${v.gx * v.gy}</b> grid squares (${v.gx} × ${v.gy})</div>
      <div class="sub">${fits ? `Fits a ${bed} mm bed` : `<span style="color:var(--warn)">Larger than a ${bed} mm bed: split into smaller plates</span>`}</div>`;
  }
}

// ---------------------------------------------------------------- generate / codes
function setUrl(code) {
  const path = code ? `/c/${code}` : "/";
  if (location.pathname !== path) history.replaceState(null, "", path);
}

function setBadge(exact) {
  const b = $("#previewBadge");
  b.textContent = exact ? "Exact model" : "Sketch preview";
  b.classList.toggle("exact", exact);
}

const genBtn = $("#generateBtn");
genBtn.addEventListener("click", generate);
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !genBtn.disabled) generate();
});

async function generate() {
  genBtn.disabled = true; genBtn.classList.add("busy");
  $(".lbl", genBtn).textContent = "Saving design…";
  try {
    const cfg = await api("/api/configs", {
      method: "POST",
      body: JSON.stringify({ model: S.manifest.model, version: S.manifest.version, params: S.values }),
    });
    S.code = cfg.code;
    S.loadedCode = cfg.code;
    setUrl(cfg.code);
    remember(cfg);
    await startBuild(cfg);
  } catch (e) {
    showError(e);
    resetGen();
  }
}

function resetGen() {
  genBtn.classList.remove("busy");
  $(".lbl", genBtn).textContent = "Generate model";
  genBtn.disabled = validate().issues.length > 0;
}

function showError(e) {
  const msg = e.details?.length ? e.details.map((d) => d.message).join(" ") : e.message;
  toast(msg, true);
}

async function startBuild(cfg) {
  renderResult(cfg, { state: "queued" });
  let st = cfg.build;
  if (st.state !== "done") {
    try { st = await api(`/api/build/${cfg.code}`, { method: "POST" }); }
    catch (e) { showError(e); renderResult(cfg, { state: "error", error: e.message }); resetGen(); return; }
  }
  clearInterval(S.poll);
  const t0 = Date.now();
  const tick = async () => {
    if (S.code !== cfg.code && S.loadedCode !== cfg.code) { clearInterval(S.poll); return; }
    if (st.state === "done") {
      clearInterval(S.poll);
      renderResult(cfg, st);
      resetGen();
      $(".lbl", genBtn).textContent = "Generated ✓";
      if (S.code === cfg.code) await viewer.showExact(`/files/${cfg.code}/model.stl`);
      return;
    }
    if (st.state === "error") {
      clearInterval(S.poll);
      renderResult(cfg, st);
      resetGen();
      return;
    }
    $(".lbl", genBtn).textContent = st.state === "queued" ? `Queued${st.position > 1 ? ` (#${st.position})` : ""}…` : "Building model…";
    renderResult(cfg, st, Math.round((Date.now() - t0) / 1000));
    try { st = await api(`/api/build/${cfg.code}`); } catch {}
  };
  await tick();
  if (st.state !== "done" && st.state !== "error") S.poll = setInterval(tick, 1200);
}

const DENS = { PLA: 1.24, PETG: 1.27 };
function renderResult(cfg, st, secs = 0) {
  const r = $("#result");
  r.hidden = false;
  r.classList.remove("stale");
  r.innerHTML = "";
  const chip = el("button", { class: "code-chip", title: "Copy code" }, cfg.code);
  chip.onclick = () => copy(cfg.code, "Code copied");
  const share = el("button", { class: "btn ghost", title: "Copy share link" },
    el("svg", { class: "i", viewBox: "0 0 24 24", html: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>' }), "Link");
  share.onclick = () => copy(`${location.origin}/c/${cfg.code}`, "Share link copied");
  r.append(el("div", { class: "code-row" }, chip, share));
  r.append(el("div", { class: "build-msg" }, "This code is engraved on the underside of the part. Type it here any time to get this exact design back."));

  if (st.state === "done") {
    const dl = (fmtName, label, hint) => el("a", {
      class: "btn", href: `/files/${cfg.code}/model.${fmtName}?download`, download: `${cfg.label}.${fmtName}`, title: hint,
    }, label, el("small", {}, ` ${(st.files[fmtName] / 1e6).toFixed(1)} MB`));
    r.append(el("div", { class: "dl-row" },
      dl("3mf", "3MF", "Best for slicers (Bambu, Prusa, Orca, Cura)"),
      dl("stl", "STL", "Works everywhere"),
      dl("step", "STEP", "For editing in CAD (Fusion, Onshape, FreeCAD)")));
    const vol = st.stats.volume_mm3 / 1000;
    r.append(el("div", { class: "stats" },
      el("div", { class: "stat" }, el("b", {}, `${Math.round(vol * DENS.PETG)} g`), el("span", {}, "PETG, solid")),
      el("div", { class: "stat" }, el("b", {}, `${fmt(vol, 1)} cm³`), el("span", {}, "volume")),
      el("div", { class: "stat" }, el("b", {}, `${st.build_seconds}s`), el("span", {}, "build time"))));
  } else if (st.state === "error") {
    r.append(el("div", { class: "error-box" }, st.error || "The build failed."));
  } else {
    r.append(el("div", { class: "progress" }, el("i")));
    r.append(el("div", { class: "build-msg" },
      st.state === "queued" ? `Waiting for a build slot${st.position ? ` (position ${st.position})` : ""}…`
        : `Building the exact model on the server… ${secs}s (big bins with many dividers can take up to a minute)`));
  }
}

async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch { prompt("Copy this:", text); }
}

function remember(cfg) {
  const list = LS.get("recent", []).filter((r) => r.code !== cfg.code);
  const p = cfg.params;
  const desc = cfg.model === "bin" ? `Bin ${p.gx}×${p.gy}×${p.gz}` : `Baseplate ${p.gx}×${p.gy}`;
  list.unshift({ code: cfg.code, desc: `${desc} · v${cfg.version}`, t: Date.now() });
  LS.set("recent", list.slice(0, 30));
}

async function openCode(raw) {
  const code = raw.trim();
  if (!code) return;
  try {
    const cfg = await api(`/api/configs/${encodeURIComponent(code)}`);
    const info = S.models[cfg.model];
    if (!info?.versions[cfg.version]) throw new Error("This design's model version isn't available on this server.");
    S.manifest = info.versions[cfg.version];
    S.values = { ...cfg.params };
    S.baseline = { ...cfg.params };
    S.baselineLabel = cfg.code;
    S.loadedCode = cfg.code;
    renderTabs();
    renderPanel();
    onChange(true);
    S.code = cfg.code;
    setUrl(cfg.code);
    $("#codeInput").value = "";
    remember(cfg);
    toast(`Opened ${cfg.code}`);
    await startBuild(cfg);
  } catch (e) {
    showError(e);
  }
}
$("#codeForm").addEventListener("submit", (e) => { e.preventDefault(); openCode($("#codeInput").value); });

async function upgradeDesign() {
  if (!S.loadedCode) { selectModel(S.manifest.model, null, S.values); return; }
  try {
    const up = await api(`/api/configs/${S.loadedCode}/upgrade`);
    const from = S.loadedCode;
    S.loadedCode = null;
    selectModel(up.model, up.version, up.params);
    toast(`Opened ${from} in v${up.version}. Generate to get a new code.` + (up.dropped.length ? ` Not carried over: ${up.dropped.join(", ")}` : ""));
  } catch (e) { showError(e); }
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
      el("span", { class: "c" }, r.code), el("span", { class: "d" }, r.desc),
      el("span", { class: "t" }, new Date(r.t).toLocaleDateString()))));
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
    const fitPx = Math.min(40, Math.floor(px * 4) / 4), fitPy = Math.min(40, Math.floor(py * 4) / 4);
    const W = 42 * gx - 0.5 + 2 * fitPx, D = 42 * gy - 0.5 + 2 * fitPy;
    const per = Math.max(1, Math.floor((bed - 2) / 42));
    const nx = Math.ceil(gx / per), ny = Math.ceil(gy / per);
    $("#fitOut").innerHTML = `Grid <b>${gx} × ${gy}</b> (${gx * gy} squares), padding <b>${fitPx}</b> / <b>${fitPy}</b> mm per side.<br>
      Plate: <b>${fmt(W)} × ${fmt(D)} mm</b>.` + (W > bed || D > bed
      ? `<br>Too big for a ${bed} mm bed: print <b>${nx * ny}</b> plates of up to ${per} × ${per} squares and set the padding only on the outer edges.` : "");
    return { gx: Math.min(10, gx), gy: Math.min(10, gy), pad_x: fitPx, pad_y: fitPy, bed };
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
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    host.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-120, -200, 260);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.6);
    rim.position.set(200, 160, 120);
    this.scene.add(rim);
    this.grid = new THREE.GridHelper(1000, 1000 / 42 | 0, 0x000000, 0x000000);
    this.grid.rotation.x = Math.PI / 2;
    this.grid.material.transparent = true;
    this.scene.add(this.grid);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.matSketch = new THREE.MeshStandardMaterial({ color: 0xd9dce1, roughness: .7, metalness: 0, transparent: true, opacity: .92, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    this.matModel = new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: .55, metalness: .05 });
    this.lineMat = new THREE.LineBasicMaterial({ color: 0xe8590c, transparent: true, opacity: .55 });
    this.loader = new STLLoader();
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
    this.matModel.color.set(dark ? 0x9aa0aa : 0xc9ccd2);
    this.matSketch.color.set(dark ? 0x8d929b : 0xdadde2);
    this.lineMat.color.set(cs.getPropertyValue("--accent").trim() || "#e8590c");
  }
  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  clear() {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
  }
  setContent(obj, refit) {
    this.clear();
    this.group.add(obj);
    if (S.stack && S.manifest.model === "bin" && S.values.lip) {
      const copy = obj.clone();
      copy.position.z += 7 * S.values.gz;
      copy.traverse((o) => { if (o.material === this.matModel || o.material === this.matSketch) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = .45; } });
      this.group.add(copy);
    }
    const box = new THREE.Box3().setFromObject(this.group);
    const size = box.getSize(new THREE.Vector3());
    const key = `${Math.round(size.x / 20)}:${Math.round(size.y / 20)}:${Math.round(size.z / 20)}`;
    if (refit || key !== this.fitted) { this.fitted = key; this.frame(this.view); }
  }
  frame(view = "iso") {
    this.view = view;
    const box = new THREE.Box3().setFromObject(this.group);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const r = Math.max(s.x, s.y, s.z * 1.4, 40);
    const d = r * 2.2 / Math.min(1, this.camera.aspect * 0.95);
    const dirs = { iso: [-0.75, -1.15, 0.95], top: [0, -0.001, 1], front: [0, -1, 0.12], bottom: [0.001, -0.25, -1] };
    const v = new THREE.Vector3(...dirs[view]).normalize().multiplyScalar(d);
    this.camera.position.copy(c).add(v);
    this.controls.target.copy(c);
    this.camera.near = d / 100; this.camera.far = d * 20;
    this.camera.updateProjectionMatrix();
  }
  withEdges(mesh) {
    const g = new THREE.Group();
    g.add(mesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 30), this.lineMat);
    edges.position.copy(mesh.position);
    g.add(edges);
    return g;
  }
  showSketch(model, v) {
    const root = new THREE.Group();
    const parts = model === "bin" ? sketchBin(v) : sketchPlate(v);
    for (const geom of parts) root.add(this.withEdges(new THREE.Mesh(geom, this.matSketch)));
    this.exact = null;
    this.setContent(root, false);
    setBadge(false);
  }
  async showExact(url) {
    try {
      const geom = await this.loader.loadAsync(url);
      geom.computeVertexNormals();
      const mesh = new THREE.Mesh(geom, this.matModel);
      this.exact = mesh;
      this.setContent(mesh, false);
      setBadge(true);
    } catch (e) {
      toast("Couldn't load the 3D model preview, but the downloads still work.", true);
    }
  }
  refresh() {
    if (this.exact) this.setContent(this.exact, false); else this.showSketch(S.manifest.model, S.values);
  }
}

// sketch geometry: fast approximations of the real model for live feedback
function rrShape(w, d, r, cx = 0, cy = 0) {
  r = Math.max(0.05, Math.min(r, w / 2 - 0.01, d / 2 - 0.01));
  const s = new THREE.Shape();
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - d / 2, y1 = cy + d / 2;
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0); s.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x1, y1 - r); s.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
  s.lineTo(x0 + r, y1); s.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x0, y0 + r); s.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}
function ring(w, d, r, iw, id, ir) {
  const s = rrShape(w, d, r);
  s.holes.push(rrShape(iw, id, ir));
  return s;
}
function slab(shape, z0, z1) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.01, z1 - z0), bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, z0);
  return g;
}
function box(x, y, z, cx, cy, cz) {
  const g = new THREE.BoxGeometry(x, y, z);
  g.translate(cx, cy, cz);
  return g;
}
function profileAlongX(points, length) {
  const pos = [], idx = [];
  // simple prism: points (y,z) polygon, swept from -L/2 to L/2 in x
  const n = points.length;
  for (const sx of [-length / 2, length / 2]) for (const [y, z] of points) pos.push(sx, y, z);
  const tris = THREE.ShapeUtils.triangulateShape(points.map(([y, z]) => new THREE.Vector2(y, z)), []);
  for (const [a, b, c] of tris) { idx.push(a, c, b); idx.push(n + a, n + b, n + c); }
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(i, j, n + j, i, n + j, n + i); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  return ng;
}

function sketchBin(v) {
  const g = binGeom(v);
  const parts = [];
  const r = 3.75;
  for (let i = 0; i < v.gx; i++) for (let j = 0; j < v.gy; j++) {
    const cx = (i - (v.gx - 1) / 2) * 42, cy = (j - (v.gy - 1) / 2) * 42;
    parts.push(slab(rrShape(35.6, 35.6, 0.8, cx, cy), 0, 0.8));
    parts.push(slab(rrShape(37.2, 37.2, 1.6, cx, cy), 0.8, 2.6));
    parts.push(slab(rrShape(40.0, 40.0, 3.0, cx, cy), 2.6, 4.75));
  }
  parts.push(slab(rrShape(g.W, g.D, r), 4.75, v.floor_z));
  const wallTop = v.lip ? g.H - (2.6 - v.wall) : g.H;
  parts.push(slab(ring(g.W, g.D, r, g.iw, g.id, r - v.wall), v.floor_z, wallTop));
  if (v.lip) {
    parts.push(slab(ring(g.W, g.D, r, g.W - 5.2, g.D - 5.2, 1.15), wallTop, g.H + 0.7));
    parts.push(slab(ring(g.W, g.D, r, g.W - 3.8, g.D - 3.8, 1.85), g.H + 0.7, g.H + 2.5));
    parts.push(slab(ring(g.W, g.D, r, g.W - 2 * v.lip_flat - 1.2, g.D - 2 * v.lip_flat - 1.2, 2.9), g.H + 2.5, g.Ht));
  }
  const divTop = (v.lip ? g.H - (2.6 - v.wall) : g.H) - v.div_drop;
  const dh = divTop - v.floor_z;
  if (dh > 0.5) {
    const sx = (g.iw + v.div_t) / (v.ndx + 1);
    for (let k = 1; k <= v.ndx; k++) parts.push(box(v.div_t, g.id, dh, -g.iw / 2 + k * sx - v.div_t / 2, 0, v.floor_z + dh / 2));
    const sy = (g.id + v.div_t) / (v.ndy + 1);
    for (let k = 1; k <= v.ndy; k++) parts.push(box(g.iw, v.div_t, dh, 0, -g.id / 2 + k * sy - v.div_t / 2, v.floor_z + dh / 2));
  }
  if (v.label) {
    const top = v.lip ? g.H - (2.6 - v.wall) : g.H;
    const yb = g.id / 2, yf = yb - v.label_w;
    parts.push(profileAlongX([[yb, top], [yf, top], [yf, top - 1.2], [yb, top - 1.2 - v.label_w]], g.iw));
  }
  if (v.scoop) {
    const y0 = -g.id / 2, z0 = v.floor_z, rr = v.scoop_r, pts = [[y0, z0], [y0 + rr, z0]];
    for (let a = 1; a < 16; a++) {
      const t = (a / 16) * (Math.PI / 2);
      pts.push([y0 + rr - rr * Math.sin(t), z0 + rr - rr * Math.cos(t)]);
    }
    pts.push([y0, z0 + rr]);
    parts.push(profileAlongX(pts, g.iw));
  }
  return parts;
}

function sketchPlate(v) {
  const g = plateGeom(v);
  const parts = [];
  if (v.floor_t > 0) parts.push(slab(rrShape(g.W, g.D, 4), 0, v.floor_t));
  const low = rrShape(g.W, g.D, 4), high = rrShape(g.W, g.D, 4);
  for (let i = 0; i < v.gx; i++) for (let j = 0; j < v.gy; j++) {
    const cx = (i - (v.gx - 1) / 2) * 42, cy = (j - (v.gy - 1) / 2) * 42;
    low.holes.push(rrShape(37.0, 37.0, 1.5, cx, cy));
    high.holes.push(rrShape(40.6, 40.6, 3.3, cx, cy));
  }
  parts.push(slab(low, v.floor_t, v.floor_t + 2.5));
  parts.push(slab(high, v.floor_t + 2.5, g.Hp));
  return parts;
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
    const data = await api("/api/models");
    for (const m of data.models) {
      const info = (S.models[m.model] ||= { versions: {}, latest: 0 });
      info.versions[m.version] = m;
      info.latest = Math.max(info.latest, m.version);
    }
  } catch (e) {
    toast("Couldn't reach the server. Please reload.", true);
    return;
  }
  const m = location.pathname.match(/^\/c\/([A-Za-z0-9-]+)/) || location.search.match(/[?&]c=([A-Za-z0-9-]+)/);
  selectModel(LS.get("lastModel", "bin") in S.models ? LS.get("lastModel", "bin") : Object.keys(S.models)[0]);
  if (m) await openCode(decodeURIComponent(m[1]));
  new MutationObserver(() => LS.set("lastModel", S.manifest.model)).observe($("#modelTabs"), { childList: true });
})();

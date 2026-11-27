# AESS — parametric Gridfinity-compatible storage ecosystem

Tough, modular, fully parametric storage for home and shop. Not shop-only: every part must make sense in a kitchen drawer as much as on a workbench.
Public generator: https://aess.billowapp.dev, a fully static site on GitHub Pages (repo `urnavrt-bit/aess`), deployed by `.github/workflows/ci.yml` on every push to `main`.

## Architecture
- **Models are built in the visitor's browser** with Manifold (WebAssembly) from versioned JavaScript models (`models/<model>/v<N>/model.js`). No backend.
- **SolidCraft is the design and reference tool**, not part of the site. The SolidCraft reference model for a browser version is named in its manifest (`reference.solidcraft`). `scripts/make_reference.py` builds a spread of designs with SolidCraft into `tests/reference/`, and `tests/js/models.test.mjs` checks the browser model against them (volume within 0.05%, bounding box within 0.02 mm). Today they agree to 0.01%.
- v1 models (`models/*/v1/model.sc`) were built on the old SolidCraft server. Their designs live on as static files in `legacy/<code>/` (made by `scripts/export_legacy.py`), and their codes still open.

## Hard rules (apply to everything from here on)

### 1. Config codes must reproduce the exact design, forever
- Every design has a **config code**. It is **self-contained**: scheme c1 (`models/_codec/c1/codec.js`, prefix `AE2-`) packs the model id, the **model version** and every value that differs from that version's defaults, plus a checksum. No database.
- The same model + version + values always give the same code. A code always decodes with *its* version's manifest and builds with *its* version's model, so it reproduces the same part after any number of releases.
- When a newer version exists, the site may *offer* to open a design in it. That is an explicit user choice, and the original version always stays available.
- **The code is engraved into every part** on a face that prints cleanly, on the underside so it reads correctly when the part is tipped toward you (bin: under the first foot, between the magnet holes; baseplate: underside of the front rim). Every new model must do this.
- **Every downloaded file carries its design.** 3MF: `Metadata/aess.json` (code, model, version, every parameter, generator link) plus readable metadata and a thumbnail. STL: the code in the 80-byte header. The site opens either file back into the editor (`web/files.js`). Keep this for every model and format.
- Old v1 codes (`AE-XXXXX-XXXXX`) keep opening, with their original files from `legacy/`.

### 2. Published files are immutable
- `models/LOCK.json` locks checksums of every published model version **and everything it depends on**: `models/_engine/*` (Manifold build), `_lib/*`, `_fonts/*`, `_kit/*` (shared geometry), `_codec/*` (code formats), plus the append-only `models/registry.json` (model ids used inside codes). `scripts/lock_models.py --add` locks new folders when publishing; the tests fail if a locked file changes or a published version isn't locked.
- Never edit a locked folder. Any change, however small, goes into a new folder (`bin/v3`, `_kit/k2`, `_engine/manifold-<new>`, `_codec/c2`) that new model versions point at. Old versions keep pointing at the old folders.
- Do not rename, remove or reinterpret parameters within a published manifest.
- New model ids are only ever appended to `models/registry.json`.

### 3. Gridfinity compatibility
- 42 mm pitch, 7 mm height unit, standard base and stacking-lip profile. Toughness comes from parameters (walls, floor, fillets, flat lip top), never from changing the interface geometry.

### 4. Print quality
- Curves are faceted to within 0.005 mm of the true shape (`_kit/k1` `TOL`), well below what a printer shows. Never ship coarser geometry.

## Working on it
- Site source is `web/`; `scripts/build_site.py` assembles `_site/` (web + models + legacy + 404 redirect for old `/c/<code>` links). Preview locally: `python3 scripts/build_site.py && python3 scripts/serve.py`.
- Tests: `python3 -m unittest discover -s tests` (locks) and `node --test tests/js/*.test.mjs` (models, codes, files).
- New model version: copy the latest `models/<model>/v<N>` to `v<N+1>`, change it, add `reference.solidcraft` if a SolidCraft reference exists (`scripts/make_reference.py`), run the tests, then `scripts/lock_models.py --add` in the commit that publishes it.

## Environment
- Headless Ubuntu server, no GUI, no sudo. SolidCraft 0.50.0 is in `~/.local/opt/solidcraft-0.50.0/` with `solidcraft-cli` on PATH; the `solidcraft` MCP server runs headless. Node 22 is in `~/.local/opt/node-*` (`node`, `npm` on PATH). `gh` is logged in as `urnavrt-bit`.
- Browser testing: Playwright with headless Chromium in the session scratchpad (system libraries unpacked locally, `LD_LIBRARY_PATH` + `FONTCONFIG_FILE` needed).
- The old Python server still runs from `~/aess` (systemd user unit `aess`, data `~/aess-data`) and serves aess.billowapp.dev until DNS points at GitHub Pages; after that, stop and disable it.

## Layout
- `web/` site source (app, worker, runtime, file reader/writer, vendored three.js)
- `models/<model>/v<N>/` model versions; `models/_*/` frozen shared dependencies; `models/registry.json`; `models/LOCK.json`
- `legacy/<code>/` v1 designs (config + original STL/3MF/STEP)
- `scripts/` build_site, lock_models, make_reference, export_legacy
- `tests/` Python lock tests, `tests/js/` Node tests, `tests/reference/` SolidCraft reference numbers

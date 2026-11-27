# AESS — parametric Gridfinity-compatible storage ecosystem

Tough, modular, fully parametric storage for home and shop. Not shop-only: every part must make sense in a kitchen drawer as much as on a workbench.
Public generator website: https://aess.billowapp.dev (served by this repo on port 8000).

## Hard rules (apply to everything from here on)

### 1. Config codes must reproduce the exact design, forever
- Every design generated on the website gets a **config code** (short, human-typeable, e.g. `AE-7K3P-Q9XD`).
- Entering a code on the website must return the **exact same configuration and geometry** it was made with. This must hold after any number of later releases.
- A code stores: model id, **model version**, the full parameter set (all values, defaults included, never just the ones the user changed), generator version and creation time. Codes are never deleted or rewritten.
- The same model + version + parameters must always give the same code (it is derived from a canonical hash).
- **The code is engraved into every generated part** on a face that prints cleanly, on the underside so it reads correctly when the part is flipped toward you (bin: under the first foot, between the magnet holes; baseplate: the underside of the front rim). Models take it through text parameters listed under `engrave_code` in the manifest (`full`, `head` = `AE-XXXXX`, `tail` = the rest). Every new model must do the same.
- When a newer model version exists, the site may *offer* to open a code in the latest version. That is an explicit user choice, and the original version is always kept.

### 2. Published model versions are immutable
- Models live in `models/<model>/v<N>/` (design file `model.sc` + `manifest.json`: parameters, ranges, defaults, toggles, help text).
- `models/LOCK.json` holds the checksums of published versions (`scripts/lock_models.py --add` locks new ones; the test suite fails if a locked file changes). bin/v1 and baseplate/v1 are published and locked.
- Once a version is published (any code points at it), **never edit its files**. A change of any size goes in a new `v<N+1>` folder; the old one stays and still builds.
- Do not rename, remove or reinterpret parameters in a published manifest. A new version may change them; the old manifest keeps its meaning.
- Keep the SolidCraft build that published a version recorded in its manifest (`solidcraft_version`). If a SolidCraft upgrade changes the output of an old version, keep the old CLI available to build it.

### 3. One server, backend + frontend
- `server/` serves the UI (`server/static/`) and the API on the same port (8000). No separate frontend host.
- The backend runs `solidcraft-cli` to build files. It validates every parameter against the manifest (type, range, step); nothing from the client reaches the CLI unchecked. The CLI is called with an argument list, never through a shell.
- Generated files are cached by config code.

### 4. Gridfinity compatibility
- 42 mm pitch, 7 mm height unit, standard base and stacking-lip profile. Toughness comes from parameters (walls, floor, fillets, flat lip top), never from changing the interface geometry.

## Environment
- Headless Ubuntu server, no GUI, no sudo. SolidCraft 0.50.0 lives in `~/.local/opt/solidcraft-0.50.0/`, with `solidcraft-cli` on PATH. The `solidcraft` MCP server runs headless.
- Python 3.14 standard library only for the server (no pip available).

## Layout
- `models/<model>/v<N>/` — versioned, immutable model versions
- `server/` — generator website (backend + frontend)
- `data/` — config code database (SQLite) and the build cache. Back up `data/codes.sqlite`: losing it breaks codes.
- `exports/`, `renders/` — ad-hoc outputs

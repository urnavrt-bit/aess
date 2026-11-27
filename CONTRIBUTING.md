# Contributing to AESS

Thanks for helping! A few rules keep every config code working forever.

## The golden rules

1. **Never edit a published model version.** Anything under `models/<model>/v<N>/` that is listed in `models/LOCK.json` is frozen, because config codes point at it. `python3 -m unittest discover -s tests` fails if a locked file changes.
2. **Changes go in a new version.** Copy `v<N>` to `v<N+1>`, make the change, bump `version` in the manifest, then run `python3 scripts/lock_models.py --add` once the version is released.
3. **Never reinterpret a parameter** inside a version. A new version may rename or drop parameters; the server carries matching ones over when someone opens an old code in the new version.
4. **Every model engraves its config code** on a face that prints cleanly (usually the underside), through text parameters listed in the manifest's `engrave_code`.
5. **Stay Gridfinity-compatible**: 42 mm pitch, 7 mm height units, standard base and lip profile. Toughness comes from parameters, not from changing the interface.

## Adding or changing a model

Models are built in [SolidCraft](https://solidcraft.io) (desktop app, CLI, or its MCP server for AI agents).

- Drive every size from named parameters (expressions such as `pitch*gx - gap`), never fixed numbers.
- Name every feature. Toggles work by suppressing features, so each optional feature (and its patterns) needs a stable name.
- Pattern counts must be ≥ 1. A count that can be 0 uses `zero_suppress` in the manifest (the server sets the count to 1 and suppresses the features).
- Verify each stage: compare measured volume and bounding box with numbers you worked out, then check several extreme parameter combinations (`solidcraft-cli eval` or the MCP `check_parameters`).

### Manifest reference

```jsonc
{
  "model": "bin", "version": 2, "title": "...", "summary": "...",
  "solidcraft_version": "0.50.0",          // build used to publish this version
  "body": "Bin",
  "engrave_code": {"code1": "head", "code2": "tail"},   // text params ← full | head | tail
  "groups": [{"id": "size", "title": "Size", "help": "..."}],
  "params": [
    {"id": "gx", "group": "size", "label": "Width", "type": "int", "unit": "units",
     "min": 1, "max": 8, "step": 1, "default": 2, "set": "gx", "help": "..."},
    {"id": "magnets", "type": "bool", "default": false,
     "on": {"set": {...}, "suppress": [...]}, "off": {"suppress": ["MagnetHoles"]}},
    {"id": "ndx", "type": "int", "set": "ndx", "zero_suppress": ["DividerX", "DividersX"]},
    {"id": "label_w", "requires": "label", ...}             // greyed out unless label is on
  ],
  "checks": [{"expr": "not screws or screw_h <= floor_z - 1", "message": "..."}],
  "presets": [{"name": "Small parts", "help": "...", "values": {...}}]
}
```

`checks` use a tiny, sandboxed expression language (numbers, parameter names, `+ - * /`, comparisons, `and`/`or`/`not`). They run both in the browser and on the server.

## Code style & tests

- Server: Python standard library only, no external dependencies.
- Frontend: plain ES modules, no build step; three.js is vendored under `server/static/vendor/three/`.
- Run `python3 -m unittest discover -s tests` before opening a pull request.

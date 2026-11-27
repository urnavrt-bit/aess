# Contributing to AESS

Thanks for helping! A few rules keep every config code and every file working forever.

## The golden rules

1. **Never edit anything published.** Model versions (`models/<model>/v<N>/`) and their frozen dependencies (`models/_engine`, `_lib`, `_fonts`, `_kit`, `_codec`) are locked in `models/LOCK.json`, because codes and files in the wild point at them. The tests fail if a locked file changes.
2. **Changes go in new folders.** A model change means `v<N+1>`. A kit, font, engine or code-format change means a new folder (`_kit/k2`, …) that only new model versions use.
3. **Never reinterpret a parameter** inside a version. A new version may rename or drop parameters; when someone opens an old design in the new version, matching parameters are carried over.
4. **Every model engraves its config code** on a face that prints cleanly (usually the underside), and its files carry the design (the 3MF config, the STL header code).
5. **Stay Gridfinity-compatible**: 42 mm pitch, 7 mm height units, standard base and lip profile. Toughness comes from parameters, not from changing the interface.
6. **Print quality:** curves within 0.005 mm of the true shape (the kit does this for you).

## Adding or changing a model

1. Design or update the shape in [SolidCraft](https://solidcraft.io) (desktop app, CLI or its MCP server for AI agents): drive every size from named parameters and name every feature. This is the reference.
2. Copy the latest `models/<model>/v<N>` to `v<N+1>` and update `model.js` (and `manifest.json`). `build(M, ctx, values, code)` returns a Manifold solid; use the kit (`rrLoft`, `rrPrism`, `textBlock`, `undersideText`…).
3. Point `reference.solidcraft` at the SolidCraft model and run `scripts/make_reference.py` (needs `solidcraft-cli`) to record reference numbers.
4. `node --test tests/js/*.test.mjs`: the model must match its reference, every preset and a few dozen random valid designs must build as solids, and codes must round-trip.
5. Preview with `python3 scripts/build_site.py && python3 scripts/serve.py`.
6. In the commit that publishes it, run `python3 scripts/lock_models.py --add`. New models also get the next id appended to `models/registry.json`.

### Manifest reference

```jsonc
{
  "model": "bin", "version": 3, "title": "...", "summary": "...",
  "engine": "browser",
  "runtime": {                                   // frozen folders this version builds with
    "manifold": "_engine/manifold-3.5.5/manifold.js", "opentype": "_lib/opentype-1.3.4/opentype.module.js",
    "font": "_fonts/atkinson-hyperlegible-bold/font.ttf", "kit": "_kit/k1/kit.js",
    "codec": "_codec/c1/codec.js", "entry": "model.js"
  },
  "reference": {"solidcraft": "bin/v1"},         // SolidCraft model it is checked against
  "formats": ["3mf", "stl"],
  "groups": [{"id": "size", "title": "Size", "help": "..."}],
  "params": [
    {"id": "gx", "group": "size", "label": "Width", "type": "int", "unit": "units",
     "min": 1, "max": 8, "step": 1, "default": 2, "help": "..."},
    {"id": "magnets", "group": "base", "label": "Magnet holes", "type": "bool", "default": false, "help": "..."},
    {"id": "mag_d", "requires": "magnets", ...}            // greyed out unless magnets is on
  ],
  "checks": [{"expr": "not screws or screw_h <= floor_z - 1", "message": "..."}],
  "presets": [{"name": "Small parts", "help": "...", "values": {...}}]
}
```

A version's `params` order is part of its codes; that's one more reason published manifests never change. A new version may order its parameters freely. `checks` use a tiny expression language (numbers, parameter names, `+ - * /`, comparisons, `and`/`or`/`not`).

## Code style & tests

- No build step: plain ES modules; dependencies are vendored.
- `python3 -m unittest discover -s tests` and `node --test tests/js/*.test.mjs` must pass before a pull request.

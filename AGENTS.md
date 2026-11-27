# Instructions for AI coding agents

**Read [CLAUDE.md](CLAUDE.md) before changing anything.** It is the single source of truth for this repo's rules, architecture and workflow. This file only repeats the rules that must never be broken.

1. **Never edit anything listed in `models/LOCK.json`**: published model versions (`models/<model>/v<N>/`) and the frozen folders they depend on (`models/_engine`, `_lib`, `_fonts`, `_kit`, `_codec`). Config codes and downloaded files in the wild depend on them. Any change goes in a new folder (`v<N+1>`, `_kit/k2`, …); old versions keep pointing at the old folders.
2. **Config codes are the design.** `AE2-` codes pack model, version and changed values; the same design always gives the same code, and a code must rebuild the identical part forever.
3. **Every model engraves its config code** on a face that prints cleanly, and **every downloaded file carries its design** (3MF: `Metadata/aess.json` with every parameter; STL: the code in its header).
4. **Stay Gridfinity-compatible** (42 mm pitch, 7 mm height units, standard base and lip). Toughness comes from parameters.
5. **Curves within 0.005 mm** of the true shape.
6. `models/registry.json` is append-only.

Before you finish, both test suites must pass. CI runs them and only deploys when they do:

```bash
python3 -m unittest discover -s tests     # locked files unchanged; published versions locked
node --test tests/js/*.test.mjs           # manifests valid, models match SolidCraft references,
                                          # codes round-trip, codes engraved, files carry the design
```

Publishing a new model version: follow "Working on it" in CLAUDE.md, and run `python3 scripts/lock_models.py --add` in the commit that publishes it.

#!/usr/bin/env python3
"""Record or verify checksums of everything a published design depends on (models/LOCK.json).

Config codes and files in the wild point at exact model versions, so these never change:
  models/<model>/v<N>/     a published model version (manifest + model)
  models/_<kind>/<name>/   frozen engine, libraries, fonts, kits and code formats
  models/registry.json     model ids used inside codes: append-only

  scripts/lock_models.py          verify (exit 1 on any change)
  scripts/lock_models.py --add    also lock what isn't locked yet (do this when publishing)

An existing entry is never rewritten. To change something, add a new version folder.
"""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "models"
LOCK = MODELS / "LOCK.json"


def digest(folder: Path) -> dict:
    return {str(f.relative_to(folder)): hashlib.sha256(f.read_bytes()).hexdigest()
            for f in sorted(folder.rglob("*")) if f.is_file() and not f.name.endswith(".bak")}


def lockable() -> dict:
    out = {}
    for manifest in sorted(MODELS.glob("*/v*/manifest.json")):
        folder = manifest.parent
        out[f"{folder.parent.name}/{folder.name}"] = folder
    for folder in sorted(MODELS.glob("_*/*")):
        if folder.is_dir():
            out[str(folder.relative_to(MODELS))] = folder
    return out


def main() -> int:
    add = "--add" in sys.argv
    lock = json.loads(LOCK.read_text()) if LOCK.exists() else {}
    bad = []
    for key, folder in lockable().items():
        now = digest(folder)
        if key in lock:
            if lock[key] != now:
                bad.append(key)
        elif add:
            lock[key] = now
            print(f"locked {key}")
        else:
            print(f"not locked yet (unpublished): {key}")
    for key in lock:
        if key != "registry.json" and not (MODELS / key).is_dir():
            bad.append(f"{key} (deleted)")
    registry = json.loads((MODELS / "registry.json").read_text())
    locked_reg = lock.get("registry.json", {})
    for name, ident in locked_reg.items():
        if registry.get(name) != ident:
            bad.append(f"registry.json: {name} must stay {ident}")
    if len(set(registry.values())) != len(registry):
        bad.append("registry.json: model ids must be unique")
    if add:
        lock["registry.json"] = {**locked_reg, **registry}
        LOCK.write_text(json.dumps(lock, indent=2, sort_keys=True) + "\n")
    for key in bad:
        print(f"CHANGED: {key}. Published files must not change; restore it and put the change in a "
              f"new version.", file=sys.stderr)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

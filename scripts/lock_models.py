#!/usr/bin/env python3
"""Record or verify the checksums of published model versions (models/LOCK.json).

Published versions are immutable: config codes point at them forever.
  scripts/lock_models.py          verify every locked version (exit 1 on any change)
  scripts/lock_models.py --add    also lock versions not yet in LOCK.json

An existing entry is never rewritten. To change a model, add a new version folder.
"""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCK = ROOT / "models" / "LOCK.json"


def digest(folder: Path) -> dict:
    return {f.name: hashlib.sha256(f.read_bytes()).hexdigest()
            for f in sorted(folder.iterdir()) if f.is_file() and not f.name.endswith(".bak")}


def main() -> int:
    add = "--add" in sys.argv
    lock = json.loads(LOCK.read_text()) if LOCK.exists() else {}
    bad = []
    for manifest in sorted(ROOT.glob("models/*/v*/manifest.json")):
        folder = manifest.parent
        key = f"{folder.parent.name}/{folder.name}"
        now = digest(folder)
        if key in lock:
            if lock[key] != now:
                bad.append(key)
        elif add:
            lock[key] = now
            print(f"locked {key}")
        else:
            print(f"unlocked (unpublished) {key}")
    if add:
        LOCK.write_text(json.dumps(lock, indent=2, sort_keys=True) + "\n")
    for key in bad:
        print(f"CHANGED: {key} differs from models/LOCK.json. Published versions must not be edited; "
              f"restore it and put the change in a new version.", file=sys.stderr)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

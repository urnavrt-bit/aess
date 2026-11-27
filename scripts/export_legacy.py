#!/usr/bin/env python3
"""Export v1 (server-built) designs into legacy/<code>/ so their codes keep working
on the static site: config.json plus the files exactly as they were built.
    scripts/export_legacy.py [~/aess-data]
"""
import json
import shutil
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
data = Path(sys.argv[1] if len(sys.argv) > 1 else Path.home() / "aess-data").expanduser()
out = ROOT / "legacy"
db = sqlite3.connect(data / "codes.sqlite")
n = 0
for code, model, version, params, created, generator, solidcraft in db.execute(
        "SELECT code, model, version, params, created, generator, solidcraft FROM codes ORDER BY code"):
    build = data / "builds" / code
    if not (build / "meta.json").exists():
        print(f"skip {code}: never built")
        continue
    dest = out / code
    dest.mkdir(parents=True, exist_ok=True)
    meta = json.loads((build / "meta.json").read_text())
    (dest / "config.json").write_text(json.dumps({
        "aess": 1, "code": code, "model": model, "version": version, "params": json.loads(params),
        "created": created, "generator": f"generator {generator}, SolidCraft {solidcraft}",
        "stats": meta["stats"]}, indent=1, sort_keys=True) + "\n")
    for fmt in ("stl", "3mf", "step"):
        shutil.copyfile(build / f"model.{fmt}", dest / f"model.{fmt}")
    n += 1
print(f"exported {n} designs to {out}")

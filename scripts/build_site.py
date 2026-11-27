#!/usr/bin/env python3
"""Assemble the static site (GitHub Pages) into _site/.

    scripts/build_site.py [--out _site] [--cname aess.billowapp.dev]

web/            -> the app
models/         -> manifests, browser model code and its frozen runtime (no SolidCraft files)
models/index.json  (generated) every manifest + the model registry
404.html        -> sends unknown paths back to the generator
"""
import argparse
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHARED = ("_engine", "_lib", "_fonts", "_kit", "_codec")

REDIRECT_404 = """<!doctype html><meta charset="utf-8"><title>AESS</title>
<script>
  var p = location.pathname, i = p.indexOf("/", 1);
  location.replace(location.hostname.endsWith("github.io") && i > 0 ? p.slice(0, i + 1) : "/");
</script>
<p>Redirecting… <a href="./">Open the AESS generator</a></p>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "_site"))
    ap.add_argument("--cname", default=None, help="custom domain to serve the site on")
    args = ap.parse_args()
    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT / "web", out)

    models_out = out / "models"
    models_out.mkdir()
    for shared in SHARED:
        shutil.copytree(ROOT / "models" / shared, models_out / shared)
    registry = json.loads((ROOT / "models" / "registry.json").read_text())
    shutil.copy(ROOT / "models" / "registry.json", models_out / "registry.json")
    manifests = []
    for mpath in sorted((ROOT / "models").glob("*/v*/manifest.json")):
        m = json.loads(mpath.read_text())
        if m.get("engine") != "browser":
            continue  # SolidCraft reference models are for development only
        manifests.append(m)
        dest = models_out / mpath.parent.relative_to(ROOT / "models")
        dest.mkdir(parents=True)
        shutil.copy(mpath, dest / "manifest.json")
        shutil.copy(mpath.parent / m["runtime"]["entry"], dest / m["runtime"]["entry"])
    (models_out / "index.json").write_text(json.dumps({"registry": registry, "models": manifests}, separators=(",", ":")))

    (out / "404.html").write_text(REDIRECT_404)
    (out / ".nojekyll").write_text("")
    if args.cname:
        (out / "CNAME").write_text(args.cname + "\n")
    size = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    print(f"site built in {out} ({size / 1e6:.1f} MB, {len(manifests)} model versions)")


if __name__ == "__main__":
    main()

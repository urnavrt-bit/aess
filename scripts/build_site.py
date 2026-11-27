#!/usr/bin/env python3
"""Assemble the static site (GitHub Pages) into _site/.

    scripts/build_site.py [--out _site] [--cname aess.billowapp.dev]

web/            -> the app
models/         -> manifests, browser model code and its frozen runtime (no SolidCraft files)
models/index.json  (generated) every manifest + the model registry
legacy/         -> v1 designs, kept exactly as they were built
404.html        -> forwards old /c/<code> links to ?c=<code>
"""
import argparse
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHARED = ("_engine", "_lib", "_fonts", "_kit", "_codec")

REDIRECT_404 = """<!doctype html><meta charset="utf-8"><title>AESS</title>
<script>
  // Old links looked like /c/<code>; the static site uses ?c=<code>.
  var p = location.pathname, i = p.indexOf("/c/");
  if (i >= 0) location.replace(p.slice(0, i + 1) + "?c=" + encodeURIComponent(p.slice(i + 3).split("/")[0]));
  else location.replace(p.slice(0, p.lastIndexOf("/") + 1) || "/");
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
        m.setdefault("engine", "solidcraft")
        manifests.append(m)
        dest = models_out / mpath.parent.relative_to(ROOT / "models")
        dest.mkdir(parents=True)
        shutil.copy(mpath, dest / "manifest.json")
        if m["engine"] == "browser":
            shutil.copy(mpath.parent / m["runtime"]["entry"], dest / m["runtime"]["entry"])
    (models_out / "index.json").write_text(json.dumps({"registry": registry, "models": manifests}, separators=(",", ":")))

    if (ROOT / "legacy").exists():
        shutil.copytree(ROOT / "legacy", out / "legacy")
    (out / "404.html").write_text(REDIRECT_404)
    (out / ".nojekyll").write_text("")
    if args.cname:
        (out / "CNAME").write_text(args.cname + "\n")
    size = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    print(f"site built in {out} ({size / 1e6:.1f} MB, {len(manifests)} model versions)")


if __name__ == "__main__":
    main()

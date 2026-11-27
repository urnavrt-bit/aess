#!/usr/bin/env python3
"""Assemble the static site (GitHub Pages) into _site/.

    scripts/build_site.py [--out _site] [--cname aess.billowapp.dev]

web/            -> the app
models/         -> manifests, browser model code and its frozen runtime (no SolidCraft files)
models/index.json  (generated) every manifest + the model registry
404.html        -> sends unknown paths back to the generator
"""
import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHARED = ("_engine", "_lib", "_fonts", "_kit", "_codec")


def stamp_versions(out: Path) -> str:
    """Add ?v=<hash of the app files> to every reference between the app's own files.

    Browsers may cache each file for a while (GitHub Pages: 10 minutes), so right after a
    deploy they could otherwise mix old and new modules. With the stamp, one page load
    always gets one consistent set. Model files need no stamp: published ones never change.
    """
    app_files = sorted(f for f in out.rglob("*") if f.is_file() and f.suffix in (".js", ".css", ".html"))
    h = hashlib.sha256()
    for f in app_files:
        h.update(f.read_bytes())
    v = h.hexdigest()[:10]
    local = r'(\./(?:vendor/three/)?[\w./-]+?\.(?:js|css))'
    for f in app_files:
        text = f.read_text()
        text = re.sub(r'(from\s+")' + local + '"', rf'\1\2?v={v}"', text)          # static imports
        text = re.sub(r'(new URL\(")' + local + '"', rf'\1\2?v={v}"', text)        # worker URL
        text = re.sub(r'((?:src|href)=")((?:app|files)\.(?:js|css)|app\.css)"', rf'\1\2?v={v}"', text)
        text = text.replace('"./vendor/three/three.module.js"', f'"./vendor/three/three.module.js?v={v}"')
        f.write_text(text)
    return v

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
    version = stamp_versions(out)

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
    print(f"site built in {out} ({size / 1e6:.1f} MB, {len(manifests)} model versions, app version {version})")


if __name__ == "__main__":
    main()

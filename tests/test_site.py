"""The built site must load one consistent set of app files.

Browsers cache files for a while (GitHub Pages: 10 minutes); without version stamps a
visitor could mix old and new modules right after a deploy and the 3D engine would hang.
"""
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class SiteBuild(unittest.TestCase):
    def test_every_app_module_reference_is_version_stamped(self):
        with tempfile.TemporaryDirectory() as d:
            subprocess.run([sys.executable, str(ROOT / "scripts" / "build_site.py"), "--out", d], check=True,
                           capture_output=True)
            out = Path(d)
            stamps = set()
            for f in [*out.glob("*.js"), out / "index.html"]:
                text = f.read_text()
                refs = re.findall(r'from\s+"(\./[^"]+)"', text) + re.findall(r'new URL\("(\./[^"]+)"', text) \
                    + re.findall(r'<script type="module" src="([^"]+)"', text) + re.findall(r'rel="stylesheet" href="(app[^"]+)"', text)
                for ref in refs:
                    m = re.search(r"\?v=([0-9a-f]{10})$", ref)
                    self.assertTrue(m, f"{f.name}: {ref} is not version-stamped")
                    stamps.add(m.group(1))
            self.assertEqual(len(stamps), 1, f"all references must carry the same stamp, got {stamps}")
            self.assertIn("models/index.json", (out / "app.js").read_text())
            self.assertIn('cache: "no-cache"', (out / "app.js").read_text())


if __name__ == "__main__":
    unittest.main()

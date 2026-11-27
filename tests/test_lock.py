"""Published model versions and their frozen dependencies must never change.

    python3 -m unittest discover -s tests
"""
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class Lock(unittest.TestCase):
    def test_published_files_unchanged(self):
        r = subprocess.run([sys.executable, str(ROOT / "scripts" / "lock_models.py")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_browser_versions_and_their_dependencies_are_locked(self):
        import json
        lock = json.loads((ROOT / "models" / "LOCK.json").read_text())
        for mpath in (ROOT / "models").glob("*/v*/manifest.json"):
            m = json.loads(mpath.read_text())
            if m.get("engine") != "browser":
                continue
            key = f"{mpath.parent.parent.name}/{mpath.parent.name}"
            self.assertIn(key, lock, f"{key} is published by the site but not locked (scripts/lock_models.py --add)")
            for dep in ("manifold", "opentype", "font", "kit", "codec"):
                folder = str(Path(m["runtime"][dep]).parent)
                self.assertIn(folder, lock, f"{key} depends on {folder}, which isn't locked")


if __name__ == "__main__":
    unittest.main()

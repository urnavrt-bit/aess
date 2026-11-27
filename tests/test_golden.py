"""Golden-geometry tests: real config codes must keep building the exact same part.

Builds each design in tests/golden.json with solidcraft-cli and compares volume,
size and triangle count. Skipped when solidcraft-cli isn't installed (e.g. on CI).
When you publish a new model version, add a few of its designs here.
"""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))

import app  # noqa: E402

CLI = shutil.which("solidcraft-cli") or app.CLI


@unittest.skipUnless(Path(CLI).exists(), "solidcraft-cli not installed")
class GoldenGeometry(unittest.TestCase):
    def test_golden_designs_rebuild_identically(self):
        reg = app.Registry(app.MODELS_DIR)
        for g in json.loads((ROOT / "tests" / "golden.json").read_text()):
            with self.subTest(code=g["code"]), tempfile.TemporaryDirectory() as d:
                m = reg.get(g["model"], g["version"])
                params = app.normalize_params(m, g["params"])
                self.assertEqual(app.make_code(app.canonical(g["model"], g["version"], params)), g["code"])
                script = Path(d) / "s.json"
                script.write_text(json.dumps(app.build_script(m, params, g["code"])))
                out = Path(d) / "m.stl"
                subprocess.run([CLI, "run", str(script), "--in", str(m["_dir"] / "model.sc"), "--quiet",
                                "--out", str(out)], check=True, timeout=600)
                st = app.stl_stats(out)
                self.assertAlmostEqual(st["volume_mm3"], g["volume_mm3"], delta=0.2)
                self.assertEqual(st["size_mm"], g["size_mm"])
                self.assertEqual(st["triangles"], g["triangles"])


if __name__ == "__main__":
    unittest.main()

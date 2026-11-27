"""Unit tests for the generator backend (no SolidCraft needed).

    python3 -m unittest discover -s tests
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))

import app  # noqa: E402


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reg = app.Registry(app.MODELS_DIR)

    def test_every_model_has_defaults_that_validate(self):
        for name, versions in self.reg.models.items():
            for v, m in versions.items():
                with self.subTest(model=name, version=v):
                    params = app.normalize_params(m, {})
                    self.assertEqual(set(params), set(m["_params"]))

    def test_presets_validate(self):
        for name, versions in self.reg.models.items():
            for m in versions.values():
                for preset in m.get("presets", []):
                    with self.subTest(model=name, preset=preset["name"]):
                        app.normalize_params(m, preset["values"])

    def test_code_is_deterministic_and_canonical(self):
        m = self.reg.get("bin", 1)
        a = app.normalize_params(m, {"gx": 2, "wall": 1.6})
        b = app.normalize_params(m, {"wall": "1.60", "gx": 2.0})
        ca = app.make_code(app.canonical("bin", 1, a))
        cb = app.make_code(app.canonical("bin", 1, b))
        self.assertEqual(ca, cb)
        self.assertRegex(ca, r"^AE-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$")
        self.assertNotEqual(ca, app.make_code(app.canonical("bin", 2, a)))

    def test_code_normalisation(self):
        self.assertEqual(app.normalize_code(" ae-wcfjs-5zcvn "), "AE-WCFJS-5ZCVN")
        self.assertEqual(app.normalize_code("wcfjs5zcvn"), "AE-WCFJS-5ZCVN")
        self.assertEqual(app.normalize_code("AE-WCFJS-5ZCVO"), "AE-WCFJS-5ZCV0")
        with self.assertRaises(app.ApiError):
            app.normalize_code("hello")

    def test_rejects_bad_values(self):
        m = self.reg.get("bin", 1)
        for bad in ({"gx": 0}, {"gx": 1.5}, {"wall": "nan"}, {"nope": 1}, {"magnets": "yes"},
                    {"gx": 2, "ndx": 9}):
            with self.subTest(bad=bad), self.assertRaises(app.ApiError):
                app.normalize_params(m, bad)

    def test_check_expressions_are_sandboxed(self):
        with self.assertRaises(ValueError):
            app.safe_eval("__import__('os')", {})
        with self.assertRaises(ValueError):
            app.safe_eval("gx.__class__", {"gx": 1})

    def test_build_script_sets_everything_explicitly(self):
        m = self.reg.get("bin", 1)
        params = app.normalize_params(m, {"ndx": 0, "magnets": True, "lip": False})
        script = app.build_script(m, params, "AE-WCFJS-5ZCVN")["commands"]
        param_steps = [c for c in script if c["command"] == "parameters.change"]
        self.assertEqual(len(param_steps), 1, "all parameters must be set in one step (one rebuild)")
        self.assertEqual(script[-1]["command"], "parameters.change")
        changes = param_steps[0]["params"]["changes"]
        self.assertEqual(changes["code1"], "'AE-WCFJS'")
        self.assertEqual(changes["code2"], "'5ZCVN'")
        self.assertEqual(changes["ndx"], "1")          # pattern count kept valid
        self.assertEqual(changes["has_lip"], "0")
        self.assertEqual(changes["wall"], "1.6 mm")
        supp = {}
        for c in script:
            if c["command"] == "timeline.suppress":
                for f in c["params"]["features"]:
                    supp[f] = c["params"]["suppressed"]
        self.assertTrue(supp["DividerX"])
        self.assertFalse(supp["MagnetHoles"])
        self.assertTrue(supp["LipChamferTop"])

    def test_store_roundtrip(self):
        with tempfile.TemporaryDirectory() as d:
            store = app.Store(Path(d) / "codes.sqlite")
            m = self.reg.get("baseplate", 1)
            params = app.normalize_params(m, {"gx": 3})
            c1 = store.put("baseplate", 1, params, "0.50.0")
            c2 = store.put("baseplate", 1, dict(params), "0.50.0")
            self.assertEqual(c1, c2)
            self.assertEqual(store.get(c1)["params"], params)
            self.assertEqual(store.count(), 1)

    def test_published_models_unchanged(self):
        r = subprocess.run([sys.executable, str(ROOT / "scripts" / "lock_models.py")],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)


if __name__ == "__main__":
    unittest.main()

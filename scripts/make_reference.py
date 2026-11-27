#!/usr/bin/env python3
"""Build reference geometry with SolidCraft for the browser models to be checked against.

Development tool (needs solidcraft-cli). For each browser model version whose manifest
names a SolidCraft reference, build a spread of designs with the reference model (code
engraving off: the fonts differ) and record volume and size in
tests/reference/<model>-v<N>.json. CI compares the browser models against these.
    scripts/make_reference.py
"""
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLI = shutil.which("solidcraft-cli") or str(Path.home() / ".local/bin/solidcraft-cli")
SOLIDCRAFT_FEATURES = {
    "bin": {
        "lip": {"on": {"has_lip": "1"}, "off": {"has_lip": "0"},
                "suppress_off": ["LipChamferTop", "LipVertical", "LipChamferLow", "LipSupport"]},
        "label": {"suppress_off": ["LabelTabBlock", "LabelTabChamfer", "LabelTab"]},
        "scoop": {"suppress_off": ["Scoop"]},
        "magnets": {"suppress_off": ["MagnetHoles", "MagnetGrid"]},
        "screws": {"suppress_off": ["ScrewHoles", "ScrewGrid"]},
        "ndx": {"zero": ["DividerX", "DividersX"]},
        "ndy": {"zero": ["DividerY", "DividersY"]},
    },
    "baseplate": {
        "magnets": {"suppress_off": ["BpMagnetHoles", "BpMagnetGrid"]},
        "screws": {"suppress_off": ["BpCountersink", "BpScrewHole", "BpScrewGrid"]},
    },
}
CASES = {
    "bin": [
        {}, {"gx": 1, "gy": 1, "gz": 3},
        {"gx": 3, "gy": 2, "gz": 6, "wall": 2.2, "ndx": 2, "ndy": 1, "scoop": True, "magnets": True},
        {"gx": 2, "gy": 2, "gz": 4, "lip": False, "label": False, "screws": True, "floor_z": 9},
        {"gx": 4, "gy": 1, "gz": 2, "ndx": 3, "label": False, "wall": 1.2, "lip_flat": 0.8},
        {"gx": 1, "gy": 3, "gz": 8, "ndy": 2, "scoop": True, "scoop_r": 20, "div_drop": 10, "label_w": 16},
    ],
    "baseplate": [
        {}, {"gx": 4, "gy": 3, "pad_x": 0, "pad_y": 0},
        {"gx": 3, "gy": 2, "floor_t": 5, "magnets": True, "screws": True},
        {"gx": 1, "gy": 1, "floor_t": 3.5, "magnets": True, "pad_x": 6, "pad_y": 0.5},
    ],
}


def stl_volume_size(path):
    import struct
    data = path.read_bytes()
    n = struct.unpack_from("<I", data, 80)[0]
    vol, lo, hi = 0.0, [1e9] * 3, [-1e9] * 3
    for k in range(n):
        v = struct.unpack_from("<12f", data, 84 + 50 * k)
        a, b, c = v[3:6], v[6:9], v[9:12]
        vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
        for p in (a, b, c):
            for i in range(3):
                lo[i], hi[i] = min(lo[i], p[i]), max(hi[i], p[i])
    return round(abs(vol), 2), [round(hi[i] - lo[i], 3) for i in range(3)]


def script_for(model, manifest, values):
    feats = SOLIDCRAFT_FEATURES[model]
    changes, on, off = {}, set(), {"CodeEngrave"}
    for p in manifest["params"]:
        v = values.get(p["id"], p["default"])
        f = feats.get(p["id"], {})
        if p["type"] == "bool":
            changes.update(f.get("on" if v else "off", {}))
            (on if v else off).update(f.get("suppress_off", []))
            continue
        if "zero" in f:
            (off if v == 0 else on).update(f["zero"])
            v = max(v, 1)
        changes[p["id"]] = f"{v}" if p["type"] == "int" or p.get("unit") in ("", "units") else f"{v} mm"
    cmds = []
    if on:
        cmds.append({"command": "timeline.suppress", "params": {"features": sorted(on), "suppressed": False}})
    cmds.append({"command": "timeline.suppress", "params": {"features": sorted(off), "suppressed": True}})
    cmds.append({"command": "parameters.change", "params": {"changes": changes}})
    return {"commands": cmds}


for model, cases in CASES.items():
    for mpath in sorted(ROOT.glob(f"models/{model}/v*/manifest.json")):
        m = json.loads(mpath.read_text())
        if m.get("engine") != "browser":
            continue
        ref = m["reference"]["solidcraft"]
        out = []
        for values in cases:
            with tempfile.TemporaryDirectory() as d:
                s, stl = Path(d) / "s.json", Path(d) / "m.stl"
                s.write_text(json.dumps(script_for(model, m, values)))
                subprocess.run([CLI, "run", str(s), "--in", str(ROOT / "models" / ref / "model.sc"), "--quiet",
                                "--quality", "finest", "--out", str(stl)], check=True)
                vol, size = stl_volume_size(stl)
            out.append({"values": values, "volume_mm3": vol, "size_mm": size})
            print(model, m["version"], values, vol, size, flush=True)
        dest = ROOT / "tests" / "reference" / f"{model}-v{m['version']}.json"
        dest.write_text(json.dumps({"reference": ref, "cases": out}, indent=1) + "\n")

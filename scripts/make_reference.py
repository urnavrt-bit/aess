#!/usr/bin/env python3
"""Build reference geometry with SolidCraft for the browser models to be checked against.

Development tool (needs solidcraft-cli). For each browser model version whose manifest
names a SolidCraft reference, build a spread of designs with the reference model (code
engraving off: the fonts differ) and record volume and size in
tests/reference/<model>-v<N>.json. CI compares the browser models against these.
    scripts/make_reference.py [model ...]
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLI = shutil.which("solidcraft-cli") or str(Path.home() / ".local/bin/solidcraft-cli")
# Per SolidCraft reference model (the manifest's `reference.solidcraft`): how each manifest
# parameter maps onto it, which features depend on more than one parameter, and the designs
# to build.
#   on/off: parameter changes for a bool; suppress_off: features off while a bool is off;
#   zero: features off while an int is 0; rules(values) -> {feature: active} for the rest.
_bin = {
    "lip": {"on": {"has_lip": "1"}, "off": {"has_lip": "0"},
            "suppress_off": ["LipChamferTop", "LipVertical", "LipChamferLow", "LipSupport"]},
    "label": {"suppress_off": ["LabelTabBlock", "LabelTabChamfer", "LabelTab"]},
    "scoop": {"suppress_off": ["Scoop"]},
    "magnets": {"suppress_off": ["MagnetHoles", "MagnetGrid"]},
    "screws": {"suppress_off": ["ScrewHoles", "ScrewGrid"]},
    "ndx": {"zero": ["DividerX", "DividersX"]},
    "ndy": {"zero": ["DividerY", "DividersY"]},
}
_bp = {
    "magnets": {"suppress_off": ["BpMagnetHoles", "BpMagnetGrid"]},
    "screws": {"suppress_off": ["BpCountersink", "BpScrewHole", "BpScrewGrid"]},
}
_join = lambda side, feats: {"on": {f"join_{side}": "1"}, "off": {f"join_{side}": "0"}, "suppress_off": feats}
_win = [f"Win{n}{g}" for n in ("YIn", "YL", "YR", "XIn", "XF", "XB") for g in ("", "Grid")]


def _bp3_rules(v):
    on = {}
    # a corner stays square (filled) when either edge beside it is joined
    for name, a, b in (("FillFL", "join_l", "join_f"), ("FillFR", "join_r", "join_f"),
                       ("FillBR", "join_r", "join_b"), ("FillBL", "join_l", "join_b")):
        on[name] = bool(v[a] or v[b])
    # inner grid lines exist only with 2 or more squares
    on["WinYIn"] = on["WinYInGrid"] = bool(v["light"]) and v["gx"] > 1
    on["WinXIn"] = on["WinXInGrid"] = bool(v["light"]) and v["gy"] > 1
    return on


def _bp4_rules(v):
    on = _bp3_rules(v)
    sockets = (v["gy"] - 1) * (v["join_l"] + v["join_r"]) + (v["gx"] - 1) * (v["join_f"] + v["join_b"])
    on["Key"] = on["KeyGrid"] = bool(v["keys"]) and v["floor_t"] == 0 and sockets > 0
    return on


_feet = ["Foot1", "Foot2", "Foot3", "FootGrid"]
_top = ["TopChamferTop", "TopVertical", "TopChamferLow", "TopGrid"]
_open_back = lambda v: {"BackWindow": not v["back"]}


REFERENCES = {
    "bin/v1": {"features": _bin, "engraved": True, "cases": [
        {}, {"gx": 1, "gy": 1, "gz": 3},
        {"gx": 3, "gy": 2, "gz": 6, "wall": 2.2, "ndx": 2, "ndy": 1, "scoop": True, "magnets": True},
        {"gx": 2, "gy": 2, "gz": 4, "lip": False, "label": False, "screws": True, "floor_z": 9},
        {"gx": 4, "gy": 1, "gz": 2, "ndx": 3, "label": False, "wall": 1.2, "lip_flat": 0.8},
        {"gx": 1, "gy": 3, "gz": 8, "ndy": 2, "scoop": True, "scoop_r": 20, "div_drop": 10, "label_w": 16},
    ]},
    # v3: LabelTabClip trims the label shelf at the floor (it reached into the feet in short bins)
    "bin/v3": {"features": {**_bin, "label": {"suppress_off": ["LabelTabBlock", "LabelTabChamfer", "LabelTabClip", "LabelTab"]}},
               "engraved": True, "cases": [
        {}, {"gx": 1, "gy": 1, "gz": 3},
        {"gx": 3, "gy": 2, "gz": 6, "wall": 2.2, "ndx": 2, "ndy": 1, "scoop": True, "magnets": True},
        {"gx": 2, "gy": 2, "gz": 4, "lip": False, "label": False, "screws": True, "floor_z": 9},
        {"gx": 4, "gy": 1, "gz": 2, "ndx": 3, "label": False, "wall": 1.2, "lip_flat": 0.8},
        {"gx": 1, "gy": 3, "gz": 8, "ndy": 2, "scoop": True, "scoop_r": 20, "div_drop": 10, "label_w": 16},
        {"gx": 2, "gy": 1, "gz": 2},
        {"gx": 1, "gy": 1, "gz": 2, "label_w": 20, "wall": 1.2, "ndx": 1},
        {"gx": 3, "gy": 1, "gz": 3, "label_w": 20, "lip": False, "magnets": True},
    ]},
    "baseplate/v1": {"features": _bp, "engraved": True, "cases": [
        {}, {"gx": 4, "gy": 3, "pad_x": 0, "pad_y": 0},
        {"gx": 3, "gy": 2, "floor_t": 5, "magnets": True, "screws": True},
        {"gx": 1, "gy": 1, "floor_t": 3.5, "magnets": True, "pad_x": 6, "pad_y": 0.5},
    ]},
    "baseplate/v3": {"features": {
        **_bp, "light": {"suppress_off": _win},
        "join_l": _join("l", ["SockL", "SockLGrid"]), "join_r": _join("r", ["TabR", "TabRGrid"]),
        "join_f": _join("f", ["SockF", "SockFGrid"]), "join_b": _join("b", ["TabB", "TabBGrid"]),
    }, "rules": _bp3_rules, "engraved": True, "cases": [
        {}, {"gx": 4, "gy": 3, "pad_x": 0, "pad_y": 0, "light": False},
        {"gx": 3, "gy": 2, "floor_t": 5, "magnets": True, "screws": True},
        {"gx": 1, "gy": 1, "floor_t": 3.5, "magnets": True, "pad_x": 6, "pad_y": 0.5},
        {"gx": 3, "gy": 3, "join_l": True, "join_r": True, "join_f": True, "join_b": True, "fit": 0.25},
        {"gx": 2, "gy": 4, "join_r": True, "join_b": True, "pad_x": 5, "pad_y": 2, "light": False},
        {"gx": 4, "gy": 2, "join_l": True, "join_f": True, "floor_t": 3, "magnets": True, "pad_x": 0},
        {"gx": 1, "gy": 3, "join_l": True, "join_r": True, "pad_y": 0},
    ]},
    "baseplate/v4": {"features": {
        **_bp, "light": {"suppress_off": _win}, "keys": {},
        "join_l": _join("l", ["SockL", "SockLGrid"]), "join_r": _join("r", ["SockR", "SockRGrid"]),
        "join_f": _join("f", ["SockF", "SockFGrid"]), "join_b": _join("b", ["SockB", "SockBGrid"]),
    }, "rules": _bp4_rules, "engraved": True, "cases": [
        {}, {"gx": 4, "gy": 3, "pad_x": 0, "pad_y": 0, "light": False},
        {"gx": 3, "gy": 2, "floor_t": 5, "magnets": True, "screws": True},
        {"gx": 1, "gy": 1, "floor_t": 3.5, "magnets": True, "pad_x": 6, "pad_y": 0.5},
        {"gx": 3, "gy": 3, "join_l": True, "join_r": True, "join_f": True, "join_b": True, "fit": 0.25},
        {"gx": 2, "gy": 4, "join_r": True, "join_b": True, "pad_x": 5, "pad_y": 2, "light": False},
        {"gx": 4, "gy": 2, "join_l": True, "join_f": True, "floor_t": 3, "magnets": True, "pad_x": 0, "keys": False},
        {"gx": 1, "gy": 3, "join_l": True, "join_r": True, "pad_y": 0},
        {"gx": 5, "gy": 5, "join_l": True, "join_r": True, "join_f": True, "join_b": True},
    ]},
    "crate/v1": {"features": {
        "feet": {"on": {"has_feet": "1"}, "off": {"has_feet": "0"}, "suppress_off": _feet},
        "stack": {"on": {"has_stack": "1"}, "off": {"has_stack": "0"}, "suppress_off": _top},
    }, "rules": _open_back, "engraved": False, "cases": [
        {}, {"gx": 1, "gy": 1, "gz": 2, "headroom": 5},
        {"gx": 3, "gy": 2, "gz": 4, "back": False, "wall": 1.6},
        {"gx": 2, "gy": 3, "feet": False, "stack": False, "floor_t": 2, "top_t": 2.5},
        {"gx": 4, "gy": 1, "gz": 9, "headroom": 12, "wall": 3},
    ]},
    "cabinet/v1": {"features": {
        "feet": {"on": {"has_feet": "1"}, "off": {"has_feet": "0"}, "suppress_off": _feet},
        "stack": {"on": {"has_stack": "1"}, "off": {"has_stack": "0"}, "suppress_off": _top},
    }, "rules": _open_back, "engraved": False, "cases": [
        {}, {"gx": 1, "gy": 1, "gz": 2, "drawers": 5},
        {"gx": 3, "gy": 2, "gz": 4, "drawers": 2, "back": False},
        {"gx": 2, "gy": 3, "feet": False, "stack": False, "wall": 3, "floor_t": 2},
        {"gx": 4, "gy": 3, "gz": 3, "drawers": 3},
    ]},
    "drawer/v1": {"features": {"pull": {"suppress_off": ["Pull"]}}, "engraved": False, "cases": [
        {}, {"gx": 1, "gy": 1, "gz": 2, "pull_w": 20},
        {"gx": 4, "gy": 3, "gz": 5, "pull": False},
        {"gx": 3, "gy": 2, "floor_t": 2.5, "pull_w": 126},
    ]},
    "lid/v1": {"features": {
        "stack": {"on": {"has_stack": "1"}, "off": {"has_stack": "0"},
                  "suppress_off": ["CellChamferTop", "CellVertical", "CellChamferLow", "CellGrid"]},
        "magnets": {"suppress_off": ["LidMagnetHoles", "LidMagnetGrid"]},
        "grip": {"suppress_off": ["Grip"]},
    }, "engraved": False, "cases": [
        {}, {"gx": 1, "gy": 1, "grip_w": 30},
        {"gx": 3, "gy": 2, "top_t": 2.5, "magnets": True, "mag_d": 6.2, "mag_h": 3},
        {"gx": 2, "gy": 3, "stack": False, "top_t": 2.8, "grip_w": 40},
        {"gx": 4, "gy": 1, "stack": False, "grip": False, "top_t": 0.6},
        {"gx": 1, "gy": 2, "grip": False, "top_t": 6, "magnets": True},
    ]},
    "lid/v2": {"features": {
        "stack": {"on": {"has_stack": "1"}, "off": {"has_stack": "0"},
                  "suppress_off": ["CellChamferTop", "CellVertical", "CellChamferLow", "CellGrid"]},
        "magnets": {"suppress_off": ["LidMagnetHoles", "LidMagnetGrid"]},
        "grip": {"suppress_off": ["Grip"]},
        "snap": {"suppress_off": ["HookB", "SlotB", "SlitB1", "SlitB2", "ClipGridB",
                                  "HookS", "SlotS", "SlitS1", "SlitS2", "ClipGridS", "SlitGridS"]},
    }, "engraved": False, "cases": [
        {}, {"gx": 1, "gy": 1, "grip_w": 30},
        {"gx": 3, "gy": 2, "top_t": 2.5, "magnets": True, "mag_d": 6.2, "mag_h": 3},
        {"gx": 2, "gy": 3, "stack": False, "top_t": 2.8, "grip_w": 40},
        {"gx": 4, "gy": 1, "stack": False, "grip": False, "top_t": 0.6},
        {"gx": 1, "gy": 2, "grip": False, "top_t": 6, "magnets": True},
        {"gx": 3, "gy": 3, "snap_d": 0.1}, {"gx": 2, "gy": 2, "snap": False},
        {"gx": 1, "gy": 1, "stack": False, "top_t": 0.6, "grip": False, "snap_d": 0.3},
    ]},
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


def script_for(ref, manifest, values):
    feats = ref["features"]
    changes, on, off = {}, set(), ({"CodeEngrave"} if ref["engraved"] else set())
    value = lambda p: values.get(p["id"], p["default"])
    for p in manifest["params"]:
        v = value(p)
        if p["type"] == "bool" and p.get("requires"):  # a switch under a switch that's off does nothing
            v = v and value(next(q for q in manifest["params"] if q["id"] == p["requires"]))
        f = feats.get(p["id"], {})
        if p["type"] == "bool":
            changes.update(f.get("on" if v else "off", {}))
            (on if v else off).update(f.get("suppress_off", []))
            continue
        if "zero" in f:
            (off if v == 0 else on).update(f["zero"])
            v = max(v, 1)
        changes[p["id"]] = f"{v}" if p["type"] == "int" or p.get("unit") in ("", "units") else f"{v} mm"
    if ref.get("rules"):
        for name, active in ref["rules"]({p["id"]: value(p) for p in manifest["params"]}).items():
            (on if active else off).add(name)
    on -= off
    cmds = []
    if on:
        cmds.append({"command": "timeline.suppress", "params": {"features": sorted(on), "suppressed": False}})
    if off:
        cmds.append({"command": "timeline.suppress", "params": {"features": sorted(off), "suppressed": True}})
    cmds.append({"command": "parameters.change", "params": {"changes": changes}})
    return {"commands": cmds}


models = sys.argv[1:]
for mpath in sorted(ROOT.glob("models/*/v*/manifest.json")):
    m = json.loads(mpath.read_text())
    if m.get("engine") != "browser" or (models and m["model"] not in models):
        continue
    name = m["reference"]["solidcraft"]
    ref = REFERENCES[name]
    out = []
    for values in ref["cases"]:
        with tempfile.TemporaryDirectory() as d:
            s, stl = Path(d) / "s.json", Path(d) / "m.stl"
            s.write_text(json.dumps(script_for(ref, m, values)))
            subprocess.run([CLI, "run", str(s), "--in", str(ROOT / "models" / name / "model.sc"), "--quiet",
                            "--quality", "finest", "--out", str(stl)], check=True)
            vol, size = stl_volume_size(stl)
        out.append({"values": values, "volume_mm3": vol, "size_mm": size})
        print(m["model"], m["version"], values, vol, size, flush=True)
    dest = ROOT / "tests" / "reference" / f"{m['model']}-v{m['version']}.json"
    dest.write_text(json.dumps({"reference": name, "cases": out}, indent=1) + "\n")

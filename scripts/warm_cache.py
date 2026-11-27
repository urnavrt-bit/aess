#!/usr/bin/env python3
"""Pre-build every preset of the latest model versions so they download instantly.

    scripts/warm_cache.py [http://127.0.0.1:8000]
"""
import json
import sys
import time
import urllib.request

URL = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000").rstrip("/")


def call(path, body=None):
    req = urllib.request.Request(URL + path, method="POST" if body is not None else "GET",
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


codes = []
for m in call("/api/models")["models"]:
    if not m["latest"]:
        continue
    for preset in m.get("presets", []):
        cfg = call("/api/configs", {"model": m["model"], "version": m["version"], "params": preset["values"]})
        call(f"/api/build/{cfg['code']}", {})
        codes.append((m["model"], preset["name"], cfg["code"]))

pending = {c for _, _, c in codes}
deadline = time.time() + 900
while pending and time.time() < deadline:
    for code in list(pending):
        if call(f"/api/build/{code}")["state"] in ("done", "error"):
            pending.discard(code)
    time.sleep(2)
for model, name, code in codes:
    print(f"{call(f'/api/build/{code}')['state']:6} {model:10} {name:18} {code}")

#!/usr/bin/env python3
"""AESS generator server: serves the web UI and the build API on one port.

Standard library only. Builds run `solidcraft-cli` against the immutable,
versioned model files in models/<model>/v<N>/ (see CLAUDE.md).
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import logging
import mimetypes
import os
import queue
import re
import shutil
import sqlite3
import struct
import subprocess
import tempfile
import threading
import time
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

GENERATOR_VERSION = "1.0.0"
ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = ROOT / "models"
STATIC_DIR = Path(__file__).resolve().parent / "static"
DATA_DIR = Path(os.environ.get("AESS_DATA", ROOT / "data"))
BUILD_DIR = DATA_DIR / "builds"
DB_PATH = DATA_DIR / "codes.sqlite"
CLI = os.environ.get("AESS_SOLIDCRAFT_CLI") or shutil.which("solidcraft-cli") or str(
    Path.home() / ".local/bin/solidcraft-cli")
BUILD_TIMEOUT = int(os.environ.get("AESS_BUILD_TIMEOUT", "600"))
WORKERS = int(os.environ.get("AESS_WORKERS", "2"))
MAX_QUEUE = int(os.environ.get("AESS_MAX_QUEUE", "40"))
RATE_LIMIT = int(os.environ.get("AESS_BUILDS_PER_HOUR", "60"))
FORMATS = ("stl", "3mf", "step")
CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"  # Crockford base32

log = logging.getLogger("aess")


# --------------------------------------------------------------------------- models

class Registry:
    """All model versions on disk. Published versions are never edited."""

    def __init__(self, root: Path):
        self.models: dict[str, dict[int, dict]] = {}
        for manifest_path in sorted(root.glob("*/v*/manifest.json")):
            m = json.loads(manifest_path.read_text())
            m["_dir"] = manifest_path.parent
            m["_params"] = {p["id"]: p for p in m["params"]}
            self.models.setdefault(m["model"], {})[int(m["version"])] = m
        if not self.models:
            raise SystemExit(f"no models found under {root}")

    def get(self, model: str, version: int | None = None) -> dict:
        versions = self.models.get(model)
        if not versions:
            raise ApiError(404, f"unknown model '{model}'")
        if version is None:
            version = max(versions)
        if version not in versions:
            raise ApiError(404, f"model '{model}' has no version {version}")
        return versions[version]

    def latest(self, model: str) -> int:
        return max(self.models[model])

    def public(self) -> list[dict]:
        out = []
        for name, versions in sorted(self.models.items(), key=lambda kv: kv[0] != "bin"):
            for v, m in sorted(versions.items()):
                pub = {k: val for k, val in m.items() if not k.startswith("_")}
                pub["latest"] = v == max(versions)
                out.append(pub)
        return out


class ApiError(Exception):
    def __init__(self, status: int, message: str, details: list | None = None):
        super().__init__(message)
        self.status, self.message, self.details = status, message, details or []


# --------------------------------------------------------------------------- validation

_ALLOWED_NODES = (ast.Expression, ast.BoolOp, ast.BinOp, ast.UnaryOp, ast.Compare, ast.Name,
                  ast.Load, ast.Constant, ast.And, ast.Or, ast.Not, ast.Add, ast.Sub, ast.Mult,
                  ast.Div, ast.USub, ast.UAdd, ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.Eq, ast.NotEq)


def safe_eval(expr: str, names: dict) -> bool:
    tree = ast.parse(expr, mode="eval")
    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED_NODES):
            raise ValueError(f"disallowed expression element {type(node).__name__} in {expr!r}")
        if isinstance(node, ast.Name) and node.id not in names:
            raise ValueError(f"unknown name {node.id!r} in {expr!r}")
    return bool(eval(compile(tree, "<check>", "eval"), {"__builtins__": {}}, dict(names)))


def normalize_params(manifest: dict, raw: dict) -> dict:
    """Return the full, canonical parameter set (every parameter, defaults filled in)."""
    if not isinstance(raw, dict):
        raise ApiError(400, "params must be an object")
    unknown = sorted(set(raw) - set(manifest["_params"]))
    if unknown:
        raise ApiError(400, f"unknown parameter(s): {', '.join(unknown)}")
    out, errors = {}, []
    for p in manifest["params"]:
        v = raw.get(p["id"], p["default"])
        try:
            if p["type"] == "bool":
                if not isinstance(v, bool):
                    raise ValueError("must be true or false")
            else:
                if isinstance(v, bool) or not isinstance(v, (int, float)):
                    v = float(str(v).strip())
                if v != v or v in (float("inf"), float("-inf")):
                    raise ValueError("must be a number")
                if v < p["min"] - 1e-9 or v > p["max"] + 1e-9:
                    raise ValueError(f"must be between {p['min']} and {p['max']}")
                if p["type"] == "int":
                    if abs(v - round(v)) > 1e-9:
                        raise ValueError("must be a whole number")
                    v = int(round(v))
                else:
                    step = p.get("step", 0.01)
                    v = round(round((v - p["min"]) / step) * step + p["min"], 4)
                    v = min(max(v, p["min"]), p["max"])
        except ValueError as e:
            errors.append({"param": p["id"], "message": f"{p['label']}: {e}"})
            continue
        out[p["id"]] = v
    if errors:
        raise ApiError(422, "some values are out of range", errors)
    names = {k: (1 if v is True else 0 if v is False else v) for k, v in out.items()}
    for chk in manifest.get("checks", []):
        if not safe_eval(chk["expr"], names):
            errors.append({"param": None, "message": chk["message"]})
    if errors:
        raise ApiError(422, "this combination doesn't work", errors)
    return out


def canonical(model: str, version: int, params: dict) -> str:
    return json.dumps({"m": model, "v": version, "p": params}, sort_keys=True, separators=(",", ":"))


def make_code(canon: str, length: int = 10) -> str:
    n = int.from_bytes(hashlib.sha256(canon.encode()).digest(), "big")
    chars = []
    for _ in range(length):
        n, r = divmod(n, 32)
        chars.append(CODE_ALPHABET[r])
    s = "".join(chars)
    return f"AE-{s[:5]}-{s[5:]}"


def normalize_code(text: str) -> str:
    s = re.sub(r"[\s\-_]", "", text.upper())
    if s.startswith("AE"):
        s = s[2:]
    s = s.translate(str.maketrans({"O": "0", "I": "1", "L": "1", "U": "V"}))
    if not re.fullmatch(f"[{CODE_ALPHABET}]{{10,16}}", s):
        raise ApiError(400, "that doesn't look like a config code (expected something like AE-7K3P0-Q9XDM)")
    return f"AE-{s[:5]}-{s[5:]}"


# --------------------------------------------------------------------------- storage

class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.lock = threading.Lock()
        with self._conn() as c:
            c.execute("""CREATE TABLE IF NOT EXISTS codes(
                code TEXT PRIMARY KEY, model TEXT NOT NULL, version INTEGER NOT NULL,
                params TEXT NOT NULL, canonical TEXT NOT NULL UNIQUE, generator TEXT NOT NULL,
                solidcraft TEXT NOT NULL, created TEXT NOT NULL, lookups INTEGER NOT NULL DEFAULT 0)""")

    def _conn(self):
        c = sqlite3.connect(self.path, timeout=30)
        c.row_factory = sqlite3.Row
        return c

    def put(self, model: str, version: int, params: dict, solidcraft: str) -> str:
        canon = canonical(model, version, params)
        with self.lock, self._conn() as c:
            row = c.execute("SELECT code FROM codes WHERE canonical=?", (canon,)).fetchone()
            if row:
                return row["code"]
            length = 10
            while True:
                code = make_code(canon, length)
                if not c.execute("SELECT 1 FROM codes WHERE code=?", (code,)).fetchone():
                    break
                length += 2  # astronomically unlikely collision: lengthen, never overwrite
            c.execute("INSERT INTO codes(code,model,version,params,canonical,generator,solidcraft,created)"
                      " VALUES(?,?,?,?,?,?,?,?)",
                      (code, model, version, json.dumps(params, sort_keys=True), canon,
                       GENERATOR_VERSION, solidcraft, datetime.now(timezone.utc).isoformat(timespec="seconds")))
            return code

    def get(self, code: str, count: bool = False) -> dict | None:
        with self._conn() as c:
            row = c.execute("SELECT * FROM codes WHERE code=?", (code,)).fetchone()
            if row and count:
                c.execute("UPDATE codes SET lookups=lookups+1 WHERE code=?", (code,))
        if not row:
            return None
        return {"code": row["code"], "model": row["model"], "version": row["version"],
                "params": json.loads(row["params"]), "generator": row["generator"],
                "solidcraft": row["solidcraft"], "created": row["created"]}

    def count(self) -> int:
        with self._conn() as c:
            return c.execute("SELECT COUNT(*) FROM codes").fetchone()[0]


# --------------------------------------------------------------------------- builds

def code_text(code: str, part: str) -> str:
    """Pieces of a config code for engraving: full, head ('AE-XXXXX') or tail (the rest)."""
    if not re.fullmatch(r"AE-[0-9A-Z]+-[0-9A-Z]+", code):
        raise ValueError(f"bad code {code!r}")
    head, tail = code.rsplit("-", 1)
    return {"full": code, "head": head, "tail": tail}[part]


def build_script(manifest: dict, params: dict, code: str) -> dict:
    """Turn a validated parameter set into a SolidCraft command script.

    Every toggle is set explicitly (suppressed true/false) so the result never
    depends on the state the model file was saved in. The config code is
    engraved into the part through the text parameters the manifest names.
    """
    changes: list[tuple[str, str]] = [
        (name, f"'{code_text(code, part)}'") for name, part in manifest.get("engrave_code", {}).items()]
    suppress: dict[str, bool] = {}
    for p in manifest["params"]:
        v = params[p["id"]]
        if p["type"] == "bool":
            for state in ("on", "off"):
                for feat in p.get(state, {}).get("suppress", []):
                    suppress.setdefault(feat, False)
            branch = p.get("on" if v else "off", {})
            for feat in branch.get("suppress", []):
                suppress[feat] = True
            for name, expr in branch.get("set", {}).items():
                changes.append((name, expr))
        else:
            target = p["set"]
            zs = p.get("zero_suppress")
            if zs:
                for feat in zs:
                    suppress[feat] = (v == 0)
                if v == 0:
                    v = 1  # pattern counts must be >= 1; the features are suppressed anyway
            unit = "" if p["type"] == "int" or p.get("unit") in ("", "units") else " mm"
            changes.append((target, f"{v}{unit}"))
    cmds = [{"command": "parameters.change", "params": {"name": n, "expression": e}} for n, e in changes]
    on = sorted(f for f, s in suppress.items() if not s)
    off = sorted(f for f, s in suppress.items() if s)
    if on:
        cmds.append({"command": "timeline.suppress", "params": {"features": on, "suppressed": False}})
    if off:
        cmds.append({"command": "timeline.suppress", "params": {"features": off, "suppressed": True}})
    return {"commands": cmds}


def stl_stats(path: Path) -> dict:
    data = path.read_bytes()
    n = struct.unpack_from("<I", data, 80)[0]
    vol = 0.0
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    off = 84
    for _ in range(n):
        v = struct.unpack_from("<12f", data, off)
        off += 50
        a, b, c = v[3:6], v[6:9], v[9:12]
        vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0])
                + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6.0
        for p in (a, b, c):
            for i in range(3):
                if p[i] < lo[i]:
                    lo[i] = p[i]
                if p[i] > hi[i]:
                    hi[i] = p[i]
    size = [round(hi[i] - lo[i], 2) for i in range(3)]
    return {"volume_mm3": round(abs(vol), 1), "size_mm": size, "triangles": n}


class Builder:
    def __init__(self, registry: Registry, store: Store):
        self.registry, self.store = registry, store
        self.q: queue.Queue[str] = queue.Queue()
        self.jobs: dict[str, dict] = {}
        self.order: list[str] = []
        self.lock = threading.Lock()
        for i in range(WORKERS):
            threading.Thread(target=self._worker, name=f"build-{i}", daemon=True).start()

    def out_dir(self, code: str) -> Path:
        return BUILD_DIR / code

    def cached(self, code: str) -> dict | None:
        meta = self.out_dir(code) / "meta.json"
        if meta.exists():
            return json.loads(meta.read_text())
        return None

    def status(self, code: str) -> dict:
        meta = self.cached(code)
        if meta:
            return {"state": "done", **meta}
        with self.lock:
            job = self.jobs.get(code)
            if not job:
                return {"state": "none"}
            st = dict(job)
            if st["state"] == "queued":
                st["position"] = self.order.index(code) + 1 if code in self.order else 1
            return st

    def submit(self, code: str) -> dict:
        if self.cached(code):
            return self.status(code)
        with self.lock:
            job = self.jobs.get(code)
            if job and job["state"] in ("queued", "running"):
                pass
            else:
                if len(self.order) >= MAX_QUEUE:
                    raise ApiError(503, "the build queue is full right now, please try again in a minute")
                self.jobs[code] = {"state": "queued", "queued_at": time.time()}
                self.order.append(code)
                self.q.put(code)
        return self.status(code)

    def _worker(self):
        while True:
            code = self.q.get()
            with self.lock:
                if code in self.order:
                    self.order.remove(code)
                self.jobs[code] = {"state": "running", "started_at": time.time()}
            try:
                meta = self._build(code)
                with self.lock:
                    self.jobs[code] = {"state": "done", **meta}
            except Exception as e:  # noqa: BLE001 - report any failure to the client
                log.exception("build %s failed", code)
                with self.lock:
                    self.jobs[code] = {"state": "error", "error": str(e)[:500]}
            finally:
                self.q.task_done()

    def _build(self, code: str) -> dict:
        cfg = self.store.get(code)
        if not cfg:
            raise RuntimeError("unknown code")
        manifest = self.registry.get(cfg["model"], cfg["version"])
        model_file = manifest["_dir"] / "model.sc"
        final = self.out_dir(code)
        BUILD_DIR.mkdir(parents=True, exist_ok=True)
        tmp = Path(tempfile.mkdtemp(prefix=f".{code}-", dir=BUILD_DIR))
        try:
            script = tmp / "script.json"
            script.write_text(json.dumps(build_script(manifest, cfg["params"], code), indent=1))
            outs = {fmt: tmp / f"model.{fmt}" for fmt in FORMATS}
            cmd = [CLI, "run", str(script), "--in", str(model_file), "--quiet"]
            for p in outs.values():
                cmd += ["--out", str(p)]
            t0 = time.time()
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=BUILD_TIMEOUT,
                                  cwd=tmp, stdin=subprocess.DEVNULL)
            if proc.returncode != 0 or not all(p.exists() for p in outs.values()):
                raise RuntimeError("the model could not be built with these values: "
                                   + (proc.stderr or proc.stdout or "no output").strip()[-400:])
            stats = stl_stats(outs["stl"])
            meta = {"code": code, "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "build_seconds": round(time.time() - t0, 1),
                    "files": {fmt: p.stat().st_size for fmt, p in outs.items()},
                    "stats": stats}
            (tmp / "meta.json").write_text(json.dumps(meta))
            script.unlink()
            if final.exists():
                shutil.rmtree(final)
            tmp.rename(final)
            return meta
        finally:
            if tmp.exists():
                shutil.rmtree(tmp, ignore_errors=True)


# --------------------------------------------------------------------------- http

class RateLimiter:
    def __init__(self, per_hour: int):
        self.per_hour, self.hits, self.lock = per_hour, {}, threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.time()
        with self.lock:
            hits = [t for t in self.hits.get(key, []) if now - t < 3600]
            if len(hits) >= self.per_hour:
                self.hits[key] = hits
                return False
            hits.append(now)
            self.hits[key] = hits
            return True


def file_label(cfg: dict) -> str:
    p = cfg["params"]
    if cfg["model"] == "bin":
        dims = f"{p['gx']}x{p['gy']}x{p['gz']}"
    else:
        dims = f"{p['gx']}x{p['gy']}"
    return f"aess-{cfg['model']}-{dims}-v{cfg['version']}-{cfg['code']}"


class Handler(BaseHTTPRequestHandler):
    server_version = "aess/" + GENERATOR_VERSION
    app: "App"

    def log_message(self, fmt, *args):
        log.info("%s %s", self.client_ip(), fmt % args)

    def client_ip(self) -> str:
        fwd = self.headers.get("X-Forwarded-For") or self.headers.get("CF-Connecting-IP")
        return (fwd.split(",")[0].strip() if fwd else self.client_address[0])

    # -- helpers
    def send_json(self, obj, status=200, headers=None):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_file(self, path: Path, ctype: str | None = None, download: str | None = None,
                  cache: str = "public, max-age=300"):
        if not path.is_file():
            return self.send_json({"error": "not found"}, 404)
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype or mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        if download:
            self.send_header("Content-Disposition", f'attachment; filename="{download}"')
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def read_json(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if n > 64_000:
            raise ApiError(413, "request too large")
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except json.JSONDecodeError:
            raise ApiError(400, "invalid JSON")

    # -- routing
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def _dispatch(self, method: str):
        url = urlparse(self.path)
        path = url.path
        try:
            if path.startswith("/api/"):
                return self._api(method, path, parse_qs(url.query))
            if path.startswith("/files/") and method == "GET":
                return self._files(path)
            if method != "GET":
                raise ApiError(405, "method not allowed")
            return self._static(path)
        except ApiError as e:
            self.send_json({"error": e.message, "details": e.details}, e.status)
        except Exception:  # noqa: BLE001
            log.exception("error handling %s", self.path)
            self.send_json({"error": "internal error"}, 500)

    def _static(self, path: str):
        if path in ("/", "") or re.fullmatch(r"/c/[A-Za-z0-9\-]+", path):
            return self.send_file(STATIC_DIR / "index.html", "text/html; charset=utf-8", cache="no-cache")
        target = (STATIC_DIR / path.lstrip("/")).resolve()
        if not str(target).startswith(str(STATIC_DIR.resolve()) + os.sep):
            raise ApiError(404, "not found")
        ctype = None
        if target.suffix == ".js":
            ctype = "text/javascript; charset=utf-8"
        cache = "public, max-age=86400" if "/vendor/" in path else "no-cache"
        return self.send_file(target, ctype, cache=cache)

    def _files(self, path: str):
        m = re.fullmatch(r"/files/(AE-[0-9A-Z]+-[0-9A-Z]+)/model\.(stl|3mf|step)", path)
        if not m:
            raise ApiError(404, "not found")
        code, fmt = m.groups()
        cfg = self.app.store.get(code)
        if not cfg:
            raise ApiError(404, "unknown code")
        f = self.app.builder.out_dir(code) / f"model.{fmt}"
        q = parse_qs(urlparse(self.path).query)
        download = f"{file_label(cfg)}.{fmt}" if "download" in q else None
        ctype = {"stl": "model/stl", "3mf": "model/3mf", "step": "model/step"}[fmt]
        return self.send_file(f, ctype, download, cache="public, max-age=31536000, immutable")

    def _api(self, method: str, path: str, query: dict):
        app = self.app
        if path == "/api/health":
            return self.send_json({"ok": True, "generator": GENERATOR_VERSION, "codes": app.store.count()})
        if path == "/api/models" and method == "GET":
            return self.send_json({"generator": GENERATOR_VERSION, "models": app.registry.public()})
        if path == "/api/configs" and method == "POST":
            body = self.read_json()
            model = body.get("model")
            version = body.get("version")
            manifest = app.registry.get(str(model), int(version) if version is not None else None)
            params = normalize_params(manifest, body.get("params", {}))
            code = app.store.put(manifest["model"], manifest["version"], params, manifest["solidcraft_version"])
            return self.send_json(self._config_view(code))
        m = re.fullmatch(r"/api/configs/([^/]+)", path)
        if m and method == "GET":
            code = normalize_code(m.group(1))
            if not app.store.get(code):
                raise ApiError(404, f"no design found for {code}")
            return self.send_json(self._config_view(code, count=True))
        m = re.fullmatch(r"/api/configs/([^/]+)/upgrade", path)
        if m and method == "GET":
            code = normalize_code(m.group(1))
            cfg = app.store.get(code)
            if not cfg:
                raise ApiError(404, f"no design found for {code}")
            latest = app.registry.get(cfg["model"])
            carried = {k: v for k, v in cfg["params"].items() if k in latest["_params"]}
            dropped = sorted(set(cfg["params"]) - set(latest["_params"]))
            return self.send_json({"model": cfg["model"], "version": latest["version"],
                                   "params": carried, "dropped": dropped})
        m = re.fullmatch(r"/api/build/([^/]+)", path)
        if m:
            code = normalize_code(m.group(1))
            if not app.store.get(code):
                raise ApiError(404, f"no design found for {code}")
            if method == "POST":
                if not app.builder.cached(code) and not app.limiter.allow(self.client_ip()):
                    raise ApiError(429, "you've generated a lot of designs this hour, please wait a bit")
                return self.send_json(app.builder.submit(code))
            return self.send_json(app.builder.status(code))
        raise ApiError(404, "not found")

    def _config_view(self, code: str, count: bool = False) -> dict:
        cfg = self.app.store.get(code, count=count)
        latest = self.app.registry.latest(cfg["model"])
        cfg["latest_version"] = latest
        cfg["build"] = self.app.builder.status(code)
        cfg["label"] = file_label(cfg)
        return cfg


class App:
    def __init__(self):
        self.registry = Registry(MODELS_DIR)
        self.store = Store(DB_PATH)
        self.builder = Builder(self.registry, self.store)
        self.limiter = RateLimiter(RATE_LIMIT)


def main():
    ap = argparse.ArgumentParser(description="AESS generator server")
    ap.add_argument("--host", default=os.environ.get("AESS_HOST", "0.0.0.0"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("AESS_PORT", "8000")))
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if not Path(CLI).exists():
        raise SystemExit(f"solidcraft-cli not found at {CLI} (set AESS_SOLIDCRAFT_CLI)")
    Handler.app = App()
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    srv.daemon_threads = True
    log.info("AESS generator %s on http://%s:%d (models: %s)", GENERATOR_VERSION, args.host, args.port,
             ", ".join(f"{k} v{max(v)}" for k, v in Handler.app.registry.models.items()))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

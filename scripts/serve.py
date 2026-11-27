#!/usr/bin/env python3
"""Serve the built site (_site/) like GitHub Pages does: static files, 404.html for
unknown paths (which forwards old /c/<code> links). For local previews or a
self-hosted mirror.
    scripts/serve.py [--dir _site] [--port 8000] [--host 127.0.0.1]
"""
import argparse
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".wasm": "application/wasm",
                      ".js": "text/javascript", ".mjs": "text/javascript", ".3mf": "model/3mf",
                      ".stl": "model/stl", ".step": "model/step"}

    def send_error(self, code, message=None, explain=None):
        page = Path(self.directory) / "404.html"
        if code == 404 and page.exists():
            body = page.read_bytes()
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
            return
        super().send_error(code, message, explain)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=str(ROOT / "_site"))
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args()
    srv = ThreadingHTTPServer((a.host, a.port), functools.partial(Handler, directory=a.dir))
    print(f"serving {a.dir} on http://{a.host}:{a.port}")
    srv.serve_forever()


if __name__ == "__main__":
    main()

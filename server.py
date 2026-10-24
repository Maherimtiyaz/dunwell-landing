"""Dunwell landing server: static files + waitlist API.

Standard library only. Run from this directory:

    python server.py --port 8905

Endpoints
---------
GET  /                    -> index.html
GET  /styles.css          -> styles.css (and other static files)
GET  /api/waitlist/count  -> {"ok": true, "count": N}   (no emails exposed)
POST /api/waitlist        -> {"email": ..., "source": ...}
                             -> {"ok": true, "count": N}
                             -> {"ok": false, "error": {"message", "code"}}

Signups append to data/waitlist.csv (email, source, ts) with in-memory
dedupe + a small per-IP rate limit. The CSV is the export.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
WAITLIST_CSV = DATA_DIR / "waitlist.csv"

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
MAX_BODY = 16 * 1024
RATE_WINDOW = 60.0
RATE_MAX = 10  # requests per IP per window

STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
}

_lock = threading.Lock()
_hits: dict[str, list[float]] = {}


def _rate_limited(ip: str) -> bool:
    now = time.monotonic()
    with _lock:
        stamps = [t for t in _hits.get(ip, []) if now - t < RATE_WINDOW]
        if len(stamps) >= RATE_MAX:
            _hits[ip] = stamps
            return True
        stamps.append(now)
        _hits[ip] = stamps
    return False


def _load_emails() -> set[str]:
    if not WAITLIST_CSV.exists():
        return set()
    # utf-8-sig tolerates a BOM if the CSV was created by an external editor
    # (PowerShell's Set-Content, Excel) and would otherwise hide the header.
    with open(WAITLIST_CSV, newline="", encoding="utf-8-sig") as f:
        return {row["email"].strip().lower() for row in csv.DictReader(f) if row.get("email")}


def _append_signup(email: str, source: str) -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    is_new = not WAITLIST_CSV.exists() or WAITLIST_CSV.stat().st_size == 0
    # An editor (VS Code, Excel) may save the CSV without a trailing newline.
    # Appending straight onto the last line would glue the new row to the
    # header, corrupting every later read. Seed a separator when needed.
    needs_leading_newline = False
    if not is_new:
        with open(WAITLIST_CSV, "rb") as probe:
            probe.seek(-1, 2)  # 2 == SEEK_END
            needs_leading_newline = probe.read(1) not in (b"\n", b"\r")
    with open(WAITLIST_CSV, "a", newline="", encoding="utf-8") as f:
        if needs_leading_newline:
            f.write("\n")
        writer = csv.writer(f)
        if is_new:
            writer.writerow(["email", "source", "ts"])
        writer.writerow([email, source, datetime.now(timezone.utc).isoformat(timespec="seconds")])
    return len(_load_emails())


class Handler(BaseHTTPRequestHandler):
    server_version = "DunwellLanding/1.0"
    protocol_version = "HTTP/1.1"

    # ----- plumbing -------------------------------------------------

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status: int, message: str, code: str) -> None:
        """The Dunwell service's error shape: error is an object.

        Keeping both servers on one contract means this page works
        unchanged whether it is served here or by the Dunwell service.
        """
        self._json(status, {"ok": False, "error": {"message": message, "code": code}})

    def _bytes(self, status: int, body: bytes, ctype: str, cache: bool = False) -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        if not cache:
            self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:  # quiet by default
        if getattr(self.server, "verbose", False):
            super().log_message(fmt, *args)

    # ----- GET ------------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802
        path = unquote(urlparse(self.path).path)

        if path == "/api/waitlist/count":
            with _lock:
                count = len(_load_emails())
            self._json(200, {"ok": True, "count": count})
            return

        if path.startswith("/api/"):
            self._error(404, "Not found", "not_found")
            return

        if path in ("/", ""):
            target = ROOT / "index.html"
        else:
            target = (ROOT / path.lstrip("/")).resolve()

        # Never serve outside this directory.
        if not target.is_relative_to(ROOT):
            self._bytes(403, b"Forbidden", "text/plain; charset=utf-8")
            return
        if target.is_dir():
            target = target / "index.html"

        # Allowlist: only real static assets. This keeps server.py and,
        # critically, data/waitlist.csv (customer emails) out of public reach.
        if not target.is_file() or target.suffix.lower() not in STATIC_TYPES:
            self._bytes(404, b"Not found", "text/plain; charset=utf-8")
            return

        ctype = STATIC_TYPES[target.suffix.lower()]
        # Preview server: never cache, so an edit shows on the next refresh
        # instead of serving a stale stylesheet against fresh HTML.
        self._bytes(200, target.read_bytes(), ctype)

    # ----- POST -----------------------------------------------------

    def _read_body(self) -> bytes | None:
        """Consume the request body so HTTP/1.1 keep-alive stays in sync.

        An unread body would otherwise corrupt the next request on a reused
        connection (surfacing as a spurious 501). Returns None when the body is
        absent or over the cap.
        """
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return None
        if length > MAX_BODY:
            self.close_connection = True
            try:  # drain what we can, then drop the connection
                self.rfile.read(MAX_BODY)
            except OSError:
                pass
            return None
        return self.rfile.read(length)

    def do_POST(self) -> None:  # noqa: N802
        path = unquote(urlparse(self.path).path)
        raw = self._read_body()

        if path != "/api/waitlist":
            self._error(404, "Not found", "not_found")
            return

        if raw is None:
            self._error(400, "Bad request", "bad_request")
            return

        ip = self.client_address[0]
        if _rate_limited(ip):
            self._error(
                429, "Too many attempts. Please try again in a minute.", "rate_limited"
            )
            return

        try:
            data = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._error(400, "Bad request", "bad_request")
            return

        email = str(data.get("email", "")).strip().lower()
        source = str(data.get("source", "landing")).strip()[:64] or "landing"

        if not EMAIL_RE.match(email) or len(email) > 254:
            self._error(422, "Please enter a valid email address.", "invalid_email")
            return

        with _lock:
            if email in _load_emails():
                self._json(200, {"ok": True, "count": len(_load_emails()), "already": True})
                return
            count = _append_signup(email, source)

        self._json(200, {"ok": True, "count": count})


class Server(ThreadingHTTPServer):
    """Threaded server that stays quiet when clients hang up mid-request."""

    daemon_threads = True

    def handle_error(self, request, client_address) -> None:
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


def main() -> int:
    parser = argparse.ArgumentParser(description="Dunwell landing + waitlist server")
    parser.add_argument("--port", type=int, default=8905)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--verbose", action="store_true", help="log every request")
    args = parser.parse_args()

    server = Server((args.host, args.port), Handler)
    server.verbose = args.verbose
    print(f"Dunwell landing  ->  http://{args.host}:{args.port}")
    print(f"Waitlist store   ->  {WAITLIST_CSV}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

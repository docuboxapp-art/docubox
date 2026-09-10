"""Authenticated product endpoint for Docubox native PDF protection."""

from __future__ import annotations

import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from pdf_security import protect_and_sign


PORT = int(os.environ.get("PDF_SECURITY_PORT", "8002"))
TOKEN = os.environ.get("DOCUBOX_PDF_SECURITY_TOKEN", "")
MAX_REQUEST_BYTES = int(os.environ.get("PDF_SECURITY_MAX_REQUEST_BYTES", 40 * 1024 * 1024))


def _write_json(handler: BaseHTTPRequestHandler, status: int, value: dict) -> None:
    body = json.dumps(value, separators=(",", ":")).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


def _authorized(handler: BaseHTTPRequestHandler) -> bool:
    supplied = handler.headers.get("Authorization", "")
    expected = f"Bearer {TOKEN}"
    return bool(TOKEN) and hmac.compare_digest(supplied, expected)


class PdfSecurityHandler(BaseHTTPRequestHandler):
    def log_message(self, _format: str, *_args) -> None:
        # Request bodies and provider details must never enter access logs.
        return

    def do_GET(self) -> None:
        if urlparse(self.path).path != "/health":
            _write_json(self, 404, {"ok": False, "code": "NOT_FOUND"})
            return
        _write_json(self, 200, {"ok": True, "service": "pdf-security"})

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/pdf-security":
            _write_json(self, 404, {"ok": False, "code": "NOT_FOUND"})
            return
        if not _authorized(self):
            _write_json(self, 401, {"ok": False, "code": "PDF_SECURITY_UNAUTHORIZED"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_REQUEST_BYTES:
            _write_json(
                self, 413, {"ok": False, "code": "PDF_SECURITY_REQUEST_TOO_LARGE"}
            )
            return
        try:
            request = json.loads(self.rfile.read(length))
            if request.get("operation") == "health":
                response = {"ok": True, "runtime": "pyhanko"}
            elif request.get("operation") == "protect_and_sign":
                response = protect_and_sign(request)
            else:
                raise ValueError("PDF_SECURITY_OPERATION_INVALID")
            _write_json(self, 200, response)
        except Exception as error:
            code = str(error) if str(error).isupper() else "PDF_SECURITY_RUNTIME_FAILED"
            _write_json(self, 500, {"ok": False, "code": code})


def main() -> None:
    if not TOKEN:
        raise SystemExit("DOCUBOX_PDF_SECURITY_TOKEN_MISSING")
    server = ThreadingHTTPServer(("0.0.0.0", PORT), PdfSecurityHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()

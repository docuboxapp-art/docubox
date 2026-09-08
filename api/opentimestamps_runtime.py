import json
import os
from http.server import BaseHTTPRequestHandler

from ots_worker_runtime.core import OtsRuntimeError, execute, json_bytes


class handler(BaseHTTPRequestHandler):
    def _respond(self, status: int, payload: dict):
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "private, no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        secret = os.environ.get("OTS_WORKER_SECRET") or os.environ.get("CRON_SECRET")
        if not secret or self.headers.get("Authorization") != f"Bearer {secret}":
            self._respond(404, {"error": "Not found."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 12 * 1024 * 1024:
                raise OtsRuntimeError("OTS_RUNTIME_UNSUPPORTED", "Invalid request size.", 400)
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise OtsRuntimeError("OTS_RUNTIME_UNSUPPORTED", "Invalid request.", 400)
            self._respond(200, execute(payload))
        except OtsRuntimeError as error:
            self._respond(error.status, {"error": str(error), "code": error.code})
        except Exception:
            self._respond(500, {"error": "OpenTimestamps runtime failed.", "code": "OTS_RUNTIME_UNSUPPORTED"})

    def log_message(self, _format, *_args):
        return

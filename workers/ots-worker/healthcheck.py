import json
import os
import urllib.request

secret = os.environ.get("OTS_WORKER_SECRET") or os.environ.get("CRON_SECRET")
request = urllib.request.Request(
    "http://127.0.0.1:8080",
    data=b'{"action":"health"}',
    headers={"Authorization": f"Bearer {secret}", "Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(request, timeout=10) as response:
    payload = json.load(response)
if not payload.get("health", {}).get("available"):
    raise SystemExit(1)

import os
import threading
import time
import urllib.request
from http.server import ThreadingHTTPServer

from api.opentimestamps_runtime import handler


def trigger(path: str):
    base_url = os.environ.get("DOCUBOX_APP_URL", "").rstrip("/")
    secret = os.environ.get("OTS_WORKER_SECRET") or os.environ.get("CRON_SECRET")
    if not base_url or not secret:
        return
    request = urllib.request.Request(
        f"{base_url}{path}", headers={"Authorization": f"Bearer {secret}"}, method="GET"
    )
    try:
        urllib.request.urlopen(request, timeout=300).close()
    except Exception:
        pass


def scheduler():
    stamp_interval = max(int(os.environ.get("OTS_STAMP_INTERVAL_SECONDS", "300")), 60)
    upgrade_interval = max(int(os.environ.get("OTS_UPGRADE_INTERVAL_SECONDS", "3600")), 1800)
    next_stamp = 0.0
    next_upgrade = 0.0
    while True:
        now = time.monotonic()
        if now >= next_stamp:
            trigger("/api/internal/jobs/opentimestamps/stamp")
            next_stamp = now + stamp_interval
        if now >= next_upgrade:
            trigger("/api/internal/jobs/opentimestamps/upgrade")
            next_upgrade = now + upgrade_interval
        time.sleep(15)


if __name__ == "__main__":
    os.environ.setdefault("OTS_EXECUTION_MODE", "WORKER")
    threading.Thread(target=scheduler, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), handler).serve_forever()

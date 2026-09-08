FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    OTS_EXECUTION_MODE=WORKER

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --create-home --uid 10001 otsworker

COPY api ./api
COPY ots_worker_runtime ./ots_worker_runtime
COPY workers/ots-worker/server.py workers/ots-worker/healthcheck.py ./

USER otsworker
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=15s --start-period=20s --retries=3 \
  CMD ["python", "healthcheck.py"]
CMD ["python", "server.py"]

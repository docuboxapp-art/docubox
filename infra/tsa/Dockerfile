FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssl bash \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/docubox-tsa
COPY infra/tsa/ ./
RUN chmod +x bootstrap-development-tsa.sh

EXPOSE 8080
CMD ["bash", "-lc", "./bootstrap-development-tsa.sh && node server.mjs"]

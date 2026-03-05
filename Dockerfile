FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies for native modules (node-libcurl-ja3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- Final image ---
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install Node.js 22, RethinkDB, supervisor, and runtime libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    supervisor \
    libcurl4 \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && curl -fsSL https://download.rethinkdb.com/repository/raw/pubkey.gpg \
       | gpg --dearmor -o /usr/share/keyrings/rethinkdb-archive-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/rethinkdb-archive-keyring.gpg] https://download.rethinkdb.com/repository/ubuntu-jammy jammy main" \
       > /etc/apt/sources.list.d/rethinkdb.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends rethinkdb \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY package.json ./
COPY server.js db-setup.js setup-db.js recalc-stats.js team-watcher.js ./
COPY config/ ./config/
COPY public/ ./public/

# Copy container config
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Create RethinkDB data directory
RUN mkdir -p /data/rethinkdb

# OTLP receiver + Dashboard
EXPOSE 4318 3000

VOLUME /data/rethinkdb

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]

# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    LEKHAN_WAL_DIR=/var/lib/lekhan/wal

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force \
    && install -d -m 0700 -o node -g node /var/lib/lekhan/wal

COPY lib/ ./lib/
COPY server/sync/ ./server/sync/

USER node
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>{if(!r.ok)process.exitCode=1}).catch(()=>{process.exitCode=1})"]
CMD ["node", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "server/sync/main.ts"]

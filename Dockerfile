# Public board-games image — code only. No inventory, no covers, no users baked.
# Data at runtime: inventory via git-sync sidecar, covers via cover-sync cache
# (PVC), users/secrets via mounted Secret. Build context = this directory.
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN bun install --production

FROM oven/bun:1-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
# Non-secret default role config (overridable by a ConfigMap mount).
COPY whitelist-config.yaml ./whitelist-config.yaml
# Defaults point at the volumes the chart mounts.
ENV PORT=8080 \
    INVENTORY_DIR=/data/inventory \
    COVERS_DIR=/cache/covers \
    WHITELIST_CONFIG_PATH=/app/whitelist-config.yaml \
    WHITELIST_USERS_PATH=/secrets/users \
    TMP_USERS_PATH=/cache/tmp-users.jsonl
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD bun -e "fetch('http://localhost:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "run", "src/index.ts"]

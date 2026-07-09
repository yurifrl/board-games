# Runtime image — code only. No data baked in.
# All state lives on a single volume (DATA_DIR): catalog.json, users.json,
# covers/, tmp-users.jsonl. The worker sidecar populates catalog + users from
# the Obsidian Local REST API; the app reads from the volume only.
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
ENV PORT=8080 \
    DATA_DIR=/data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD bun -e "fetch('http://localhost:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "run", "src/index.ts"]

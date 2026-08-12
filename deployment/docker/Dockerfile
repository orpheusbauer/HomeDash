# syntax=docker/dockerfile:1.7
FROM node:26-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --no-audit --no-fund

COPY tsconfig.base.json eslint.config.js vitest.config.ts VERSION ./
COPY apps/server apps/server
COPY apps/web apps/web
COPY packages/contracts packages/contracts
RUN npm run build
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:26-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN groupadd --system --gid 10001 homedash \
  && useradd --system --uid 10001 --gid homedash --home-dir /app --shell /usr/sbin/nologin homedash \
  && mkdir -p /data /run/homedash-updater \
  && chown -R homedash:homedash /app /data /run/homedash-updater

COPY --from=build --chown=homedash:homedash /app/node_modules ./node_modules
COPY --from=build --chown=homedash:homedash /app/apps/server/dist ./apps/server/dist
COPY --from=build --chown=homedash:homedash /app/apps/server/package.json ./apps/server/package.json
COPY --from=build --chown=homedash:homedash /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=homedash:homedash /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build --chown=homedash:homedash /app/apps/web/dist ./public
COPY --from=build --chown=homedash:homedash /app/VERSION ./VERSION

USER homedash
EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:4100/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/server/dist/index.js"]

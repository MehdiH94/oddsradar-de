# OddsBlitzer in a container: one image for both processes, the API (which
# also serves the built dashboard, web/dist) and the scraping worker. The
# compose file picks the command. Used by the sandbox environment
# (docker-compose.sandbox.yml); production still runs on systemd (deploy/).
#
# Node 24: the code uses node:sqlite (package.json "engines": >=23.4).

# --- Build: backend (tsc -> dist/) and dashboard (vite -> web/dist/) ---------
FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/package.json web/package-lock.json web/
RUN npm ci --prefix web --no-audit --no-fund

COPY tsconfig.json ./
COPY src src
RUN npm run build

COPY web web
RUN npm run build --prefix web

# --- Runtime: production dependencies, the build output, nothing else -------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist dist
COPY --from=build /app/web/dist web/dist

# data/ holds both SQLite databases and the odds API cache (relative paths in
# the code: ./data/...). It is a volume, owned by the unprivileged user.
RUN mkdir -p data && chown node:node data
USER node
VOLUME ["/app/data"]

EXPOSE 3000
# The API answers /api/health; the worker serves nothing, its service in the
# compose file turns this check off.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "dist/api/index.js"]

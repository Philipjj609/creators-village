# INSTALL-PI2 v1; build from repository root. No private environment files copied.
FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS build
WORKDIR /build
RUN npm install --global pnpm@11.6.0 --ignore-scripts
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts
# Existing immutable PNGs are inputs; never rerender legacy assets on Linux.
RUN pnpm -r build && node scripts/build-release.mjs
RUN node scripts/package-runtime.mjs /release

FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=10000
WORKDIR /app
COPY --from=build --chown=node:node /release /app
USER node
EXPOSE 10000
HEALTHCHECK --interval=15s --timeout=7s --start-period=30s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/readyz',{signal:AbortSignal.timeout(5500)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
STOPSIGNAL SIGTERM
CMD ["node", "scripts/production.mjs", "serve"]

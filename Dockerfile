# EP-10 · Private Pilot Runtime image.
#
# PRIVATE PILOT ONLY — this image and the docker-compose.yml beside it are for a single,
# supervised pilot deployment. The image runs as a non-root user and carries a health check, but it is NOT
# by itself a public deployment: production mode requires verified OIDC/JWKS identity (see
# server/auth/verifiedIdentity.ts), a TLS-terminating proxy (NH_TLS_TERMINATION=proxy) and verified
# PostgreSQL TLS, all of which the process enforces at start-up — see
# docs/SECURITY_DEPLOYMENT_CONTRACT_V1.md. docker-compose.yml's database credentials are fixed,
# local-only placeholders that the process refuses outside that private-network case.
#
# Multi-stage: the build stage compiles the React SPA (vite build -> dist/) and the Fastify
# server (tsc -> dist-server/, CommonJS — no TypeScript dev runner in the runtime image);
# the runtime stage installs only production dependencies and copies just those two build
# artifacts plus the Prisma schema/migrations `prisma migrate deploy` needs.
#
# No `COPY . .` anywhere in this file, in either stage: only the specific files and
# directories each stage actually needs are copied, so nothing outside that explicit list
# — most importantly a local `.env` — can ever end up inside the image regardless of
# .dockerignore.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY tsconfig.json tsconfig.server.json vite.config.ts postcss.config.js tailwind.config.js index.html ./
COPY scripts ./scripts
COPY src ./src
COPY server ./server
RUN npm run build && npm run build:server

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# NON-ROOT RUNTIME. /app is created by WORKDIR as root, so hand it to the unprivileged `node` user (uid 1000,
# shipped in the base image) BEFORE anything is installed: every file below is then owned by `node` without a
# recursive chown layer, and a compromised process cannot rewrite the code it is running from as root could.
RUN chown node:node /app
USER node
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node prisma ./prisma
RUN npm ci --omit=dev
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/dist-server ./dist-server

EXPOSE 4000
# Liveness only: `/health` is the unauthenticated probe and is exempt from the HTTPS-forwarding rule. Uses the
# runtime's own fetch so no curl/wget is added to the image.
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist-server/server/productionServer.js"]

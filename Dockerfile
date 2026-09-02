# EP-10 · Private Pilot Runtime image.
#
# PRIVATE PILOT ONLY — this image and the docker-compose.yml beside it are for a single,
# supervised pilot deployment. They are NOT hardened for public exposure or multi-tenant
# production: there is no authentication in front of the app (see
# server/auth/actorContext.ts), and docker-compose.yml's database credentials are fixed,
# local-only placeholders. See the README "Private pilot runtime" section before deploying
# this anywhere reachable by untrusted users.
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
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server

EXPOSE 4000
CMD ["node", "dist-server/server/productionServer.js"]

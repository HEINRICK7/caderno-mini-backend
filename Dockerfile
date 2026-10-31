FROM node:24-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install --no-install-recommends -y python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build && npm prune --omit=dev --no-audit

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/apps/api/src/infrastructure/database/migrations ./apps/api/src/infrastructure/database/migrations

RUN apt-get update \
  && apt-get install --no-install-recommends -y fontconfig fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app/data \
  && chmod 700 /app/data \
  && chown -R node:node /app/data
USER node

EXPOSE 3000
CMD ["node", "dist/server.js"]

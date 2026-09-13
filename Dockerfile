FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine
# No secret is baked into the image: SESSION_SECRET comes from the environment
# at runtime, and when it is absent the app generates one and persists it under
# DB_PATH's directory (see src/config.js), so a demo boots with no configuration.
ENV NODE_ENV=production PORT=4100 HOST=0.0.0.0 DB_PATH=/data/fieldpoint.db SEED_DEMO=true
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
USER node
EXPOSE 4100
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4100/api/health || exit 1
CMD ["node", "src/server.js"]

# QMS full-stack app (Fly.io): builds the React client, then runs the single
# Node server which serves both the API and the static frontend.
# Persistent data lives on a Fly volume mounted at /app/server/data.

# ---- client build ----
FROM node:20-slim AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- server ----
FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server/ ./server/
COPY --from=client-build /app/client/dist ./client/dist
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/index.js"]

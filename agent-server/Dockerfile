# The pi-durable agent server: one long-running Node process that owns
# agent.sqlite and talks to the LLM gateway.
#
# Build context is the repo root: tools.ts imports the shared search library
# from ../app, and that library resolves pg/openai from /repo/node_modules.
FROM node:22-alpine
WORKDIR /repo

COPY agent-server/docker-root-package.json ./package.json
COPY app/src/lib ./app/src/lib
COPY agent-server/package.json agent-server/package-lock.json agent-server/tsconfig.json ./agent-server/
COPY agent-server/src ./agent-server/src

RUN npm install --no-audit --no-fund \
 && cd agent-server && npm ci --no-audit --no-fund

WORKDIR /repo/agent-server
ENV NODE_ENV=production
EXPOSE 3101
CMD ["npx", "tsx", "src/index.ts"]
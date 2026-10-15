# Multi-stage build: the final image runs Next.js standalone output.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine
WORKDIR /app
# Listen on every network: Docker sets HOSTNAME to the container id, which
# binds only one interface when the container joins several networks.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0
# ffmpeg encodes the read-aloud audio (see src/lib/tts.ts).
RUN apk add --no-cache ffmpeg
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
# STAGE 1: Build Stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package manifests
COPY package.json package-lock.json ./

# Install dependencies (including devDependencies required for Vite build)
RUN npm ci

# Copy application source files
COPY . .

# Build production frontend assets into dist/
RUN npm run build

# STAGE 2: Production Runtime Stage
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install curl for healthcheck probing
RUN apk add --no-cache curl

# Copy installed dependencies and built artifacts from builder stage
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src ./src

# Create and set permissions for non-root user execution
RUN chown -R node:node /app
USER node

EXPOSE 3000

# Container healthcheck probing ContentX HTTP provider status
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/api/provider-status || exit 1

CMD ["npm", "start"]

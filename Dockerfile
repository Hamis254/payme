# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev for build)
RUN npm ci

# Copy source code
COPY . .

# Run migrations preparation
RUN npm run db:generate || true

# Final stage
FROM node:18-alpine

WORKDIR /app

# Install dumb-init for proper signal handling and runtime dependencies
RUN apk add --no-cache dumb-init postgresql-client

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/drizzle.config.js ./
COPY --from=builder /app/.env.* ./

# Create logs directory with proper permissions
RUN mkdir -p logs && \
    chown -R node:node /app && \
    chmod -R 755 /app

# Switch to non-root user for security
USER node

# Expose port
EXPOSE 3000

# Health check - ensures container is healthy
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

# Use dumb-init to handle signals properly (PID 1)
ENTRYPOINT ["dumb-init", "--"]

# Start application
CMD ["npm", "start"]

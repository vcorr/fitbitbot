FROM node:22-slim

WORKDIR /app

# Install curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser appuser

COPY package*.json ./
RUN npm ci --only=production

COPY src ./src
COPY tsconfig.json ./

# Install tsx with pinned version
RUN npm install -g tsx@4.19.0

# Change ownership and switch to non-root user
RUN chown -R appuser:appuser /app
USER appuser

ENV PORT=8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:${PORT}/health || exit 1

CMD ["tsx", "src/server.ts"]

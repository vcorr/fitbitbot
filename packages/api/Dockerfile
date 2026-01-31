FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src ./src
COPY tsconfig.json ./

RUN npm install -g tsx

ENV PORT=8080

CMD ["tsx", "src/server.ts"]

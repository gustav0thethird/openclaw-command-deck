FROM node:20-alpine

# System deps — cached layer, only reruns if this line changes
RUN apk add --no-cache python3 make g++ git

WORKDIR /app

# Install deps — cached layer, only reruns when package.json/lock changes
COPY app/package.json app/package-lock.json ./
RUN npm ci

# Source is bind-mounted at runtime; this layer just ensures node_modules exists
# Build happens at startup via the entrypoint script (incremental after first run)
EXPOSE 4000

FROM node:20-alpine

RUN npm install -g pnpm

WORKDIR /app

# Copy workspace config
COPY pnpm-workspace.yaml ./
COPY package.json ./

# Copy all packages
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend

# Install dependencies
RUN pnpm install

# Build shared first, then backend
RUN pnpm --filter shared build || true
RUN pnpm --filter backend run build

EXPOSE 3001

CMD ["node", "packages/backend/dist/index.js"]

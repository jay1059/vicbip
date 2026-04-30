FROM node:20-alpine
RUN npm install -g pnpm
WORKDIR /app
COPY pnpm-workspace.yaml .
COPY package.json .
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/
RUN pnpm install
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend
RUN cd packages/shared && pnpm run build || echo "no shared build"
RUN cd packages/backend && pnpm run build
RUN ls -la packages/backend/dist/
EXPOSE 3001
CMD ["node", "packages/backend/dist/index.js"]

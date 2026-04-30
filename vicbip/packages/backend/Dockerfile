FROM node:20-alpine
RUN apk add --no-cache python3 py3-pip
RUN pip3 install pandas requests beautifulsoup4 psycopg2-binary rapidfuzz --break-system-packages
RUN npm install -g pnpm
WORKDIR /app
COPY pnpm-workspace.yaml .
COPY package.json .
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
RUN pnpm install
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend
COPY packages/frontend ./packages/frontend
RUN cd packages/shared && pnpm run build || echo "no shared build"
RUN cd packages/backend && pnpm run build
ARG VITE_MAPBOX_TOKEN
ENV VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN
RUN cd packages/frontend && pnpm run build
RUN ls -la packages/backend/dist/
EXPOSE 3001
CMD ["node", "packages/backend/dist/index.js"]

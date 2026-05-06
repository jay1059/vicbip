FROM node:20-alpine

# Build-date arg near the top — setting this in Railway Variables tab
# forces Docker to invalidate all layers from this point onwards
ARG BUILD_DATE
RUN echo "Build date: $BUILD_DATE"

RUN apk add --no-cache python3 py3-pip chromium chromium-chromedriver nss freetype harfbuzz ca-certificates
RUN pip3 install pandas requests beautifulsoup4 psycopg2-binary rapidfuzz playwright python-dotenv --break-system-packages
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/bin
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
RUN npm install -g pnpm
WORKDIR /app
COPY pnpm-workspace.yaml .
COPY package.json .
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
RUN pnpm install
COPY packages/shared ./packages/shared

# Cache-bust arg immediately before copying backend source.
# Set CACHE_BUST=<new value> in Railway Variables tab to force
# Docker to re-run all layers from this point onwards.
ARG CACHE_BUST=1
RUN echo "Cache bust: $CACHE_BUST"

COPY packages/backend ./packages/backend
COPY packages/frontend ./packages/frontend
RUN cd packages/shared && pnpm run build || echo "no shared build"
RUN cd packages/backend && pnpm run build
ARG VITE_MAPBOX_TOKEN
ENV VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN
RUN cd packages/frontend && pnpm run build
RUN ls -la packages/backend/dist/
EXPOSE 3001
CMD ["sh", "-c", "echo 'Starting VicBIP backend v2.2' && node packages/backend/dist/index.js"]

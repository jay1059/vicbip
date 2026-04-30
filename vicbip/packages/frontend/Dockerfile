FROM node:20-alpine

WORKDIR /app

RUN npm install -g pnpm

COPY package.json ./
COPY tsconfig.json ./
COPY tsconfig.node.json ./
COPY vite.config.ts ./
COPY postcss.config.js ./
COPY tailwind.config.js ./
COPY index.html ./

RUN pnpm install

COPY src ./src

EXPOSE 5173

CMD ["pnpm", "run", "dev", "--host", "0.0.0.0"]

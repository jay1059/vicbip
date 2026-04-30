FROM node:20-alpine

WORKDIR /app

RUN npm install -g pnpm

COPY package.json ./
COPY tsconfig.json ./

RUN pnpm install

COPY src ./src

RUN pnpm run build

EXPOSE 3001

CMD ["node", "dist/index.js"]

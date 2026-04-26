# Stage 1: Build frontend
FROM node:22-alpine AS frontend-builder

WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci

COPY src ./src
COPY public ./public
COPY index.html tsconfig.json vite.config.ts postcss.config.js tailwind.config.js ./

RUN npm run build

# Stage 2: Runtime with Node.js backend + frontend
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server/ ./
COPY --from=frontend-builder /build/dist ./public

RUN mkdir -p /data/images

EXPOSE 80

CMD ["node", "server.js"]

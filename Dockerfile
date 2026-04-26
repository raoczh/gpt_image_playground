# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# 使用占位符构建，运行时替换
ENV VITE_DEFAULT_API_URL=__API_URL_PLACEHOLDER__
ENV VITE_DEFAULT_API_KEY=__API_KEY_PLACEHOLDER__

RUN npm run build

# Stage 2: Runtime
FROM nginx:alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /build/dist /usr/share/nginx/html
COPY deploy/docker-entrypoint.sh /docker-entrypoint.d/40-env-subst.sh

RUN chmod +x /docker-entrypoint.d/40-env-subst.sh

EXPOSE 80

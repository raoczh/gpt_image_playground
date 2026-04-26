# 宝塔面板部署配置指南

## 前置准备

### 1. 创建 GitHub OAuth App

访问 https://github.com/settings/developers → **New OAuth App**

填写信息：
```text
Application name: GPT Image Playground
Homepage URL: https://你的页面域名
Authorization callback URL: https://你的API域名/api/auth/github/callback
```

创建后记录：
- **Client ID**
- **Client Secret**

### 2. 创建 MySQL 数据库

在宝塔面板 → 数据库 → 添加数据库：
- 数据库名：`gpt-image`
- 用户名：`gpt-image`
- 密码：自动生成或自定义
- 访问权限：所有人

数据库表会在容器启动时自动创建，无需手动导入 SQL 文件。

### 3. 生成 Session Secret

在终端执行：
```bash
openssl rand -base64 32
```

生成一个 32 位以上的随机字符串，填到 `SESSION_SECRET`。

## 宝塔面板配置

### 1. 容器编排配置

在宝塔面板 → Docker → 容器编排 → 添加编排。

**编排名称**：`gpt-image`

**docker-compose.yml**：
```yaml
services:
  gpt-image:
    image: your-registry/gpt-image:latest  # 替换为你的镜像地址
    container_name: gpt-image
    restart: always
    environment:
      DB_HOST: ${DB_HOST:-172.18.0.1}
      DB_PORT: ${DB_PORT:-3306}
      DB_USER: ${DB_USER:-gpt-image}
      DB_PASSWORD: ${DB_PASSWORD}
      DB_NAME: ${DB_NAME:-gpt-image}
      REDIS_HOST: redis
      REDIS_PORT: 6379
      GITHUB_CLIENT_ID: ${GITHUB_CLIENT_ID}
      GITHUB_CLIENT_SECRET: ${GITHUB_CLIENT_SECRET}
      GITHUB_CALLBACK_URL: ${GITHUB_CALLBACK_URL}
      SESSION_SECRET: ${SESSION_SECRET}
      SESSION_COOKIE_NAME: ${SESSION_COOKIE_NAME:-gpt_image_sid_v2}
      SESSION_COOKIE_DOMAIN: ${SESSION_COOKIE_DOMAIN}
      CORS_ORIGIN: ${CORS_ORIGIN}
      APP_ORIGIN: ${APP_ORIGIN}
      IMAGE_BASE_URL: ${IMAGE_BASE_URL}
      IMAGE_UPLOAD_DIR: /data/images
      DEFAULT_API_URL: ${DEFAULT_API_URL:-}
      DEFAULT_API_KEY: ${DEFAULT_API_KEY:-}
      DEFAULT_MODEL: ${DEFAULT_MODEL:-gpt-5.3-codex}
      DEFAULT_TIMEOUT: ${DEFAULT_TIMEOUT:-300}
      DEFAULT_API_FORMAT: ${DEFAULT_API_FORMAT:-responses}
      TZ: Asia/Shanghai
      NODE_ENV: production
    volumes:
      - /www/wwwroot/gpt-image/images:/data/images
    ports:
      - "127.0.0.1:3003:80"
    depends_on:
      - redis
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost/health || exit 1"]
      interval: 30s
      timeout: 10s
      start_period: 15s
      retries: 3
    labels:
      createdBy: "bt_apps"
    networks:
      - baota_net

  redis:
    image: redis:7-alpine
    container_name: gpt-image-redis
    restart: always
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - /www/wwwroot/gpt-image/redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 30s
      timeout: 10s
      retries: 3
    labels:
      createdBy: "bt_apps"
    networks:
      - baota_net

networks:
  baota_net:
    external: true
```

### 2. 环境变量配置 (.env)

在编排配置页面，点击“环境变量”，填写：

```bash
DB_HOST=172.18.0.1
DB_PORT=3306
DB_USER=gpt-image
DB_PASSWORD=你的数据库密码
DB_NAME=gpt-image

GITHUB_CLIENT_ID=你的_GitHub_Client_ID
GITHUB_CLIENT_SECRET=你的_GitHub_Client_Secret
GITHUB_CALLBACK_URL=https://api.你的页面域名/api/auth/github/callback

SESSION_SECRET=你生成的32位随机字符串
SESSION_COOKIE_DOMAIN=.你的根域名

CORS_ORIGIN=https://你的页面域名
APP_ORIGIN=https://你的页面域名

VITE_API_BASE_URL=https://api.你的页面域名

DEFAULT_API_URL=https://api.openai.com/v1
DEFAULT_API_KEY=你的默认API密钥
DEFAULT_MODEL=gpt-5.3-codex
DEFAULT_TIMEOUT=300
DEFAULT_API_FORMAT=responses
```

**关键说明**：
- `SESSION_COOKIE_DOMAIN=.你的根域名` 用于让页面域名和 API 子域名共享登录态。
- `CORS_ORIGIN` 必须是页面域名 `https://你的页面域名`。
- `GITHUB_CALLBACK_URL` 必须是 API 子域名，否则 GitHub 登录回调会走错域名。
- `VITE_API_BASE_URL` 是前端构建时写入静态资源的接口地址，改完后必须重新构建镜像。

### 3. 创建必要的目录

在宝塔面板 → 文件 → 创建目录：
```text
/www/wwwroot/gpt-image/images
/www/wwwroot/gpt-image/redis-data
```

设置权限：
```bash
chmod 755 /www/wwwroot/gpt-image/images
chmod 755 /www/wwwroot/gpt-image/redis-data
```

## Cloudflare DNS 配置

### 1. 页面域名
保留主站：
- **类型**：A
- **名称**：`gpt-image`
- **内容**：你的服务器 IP
- **代理状态**：☁️ 已代理（橙云）

### 2. API 域名
新增 API 子域名：
- **类型**：A
- **名称**：`api.你的页面子域名`，按 Cloudflare 面板中的实际主机名格式填写
- **内容**：你的服务器 IP
- **代理状态**：**DNS only（灰云）**

这是绕过 Cloudflare 长请求超时的关键步骤。

### 3. 图片域名（可选）

图片默认通过 API 域名提供（`https://你的API域名/images/`），无需额外配置。

如果需要独立图片域名（如 CDN 加速），可额外配置一个静态站点，并修改 `IMAGE_BASE_URL`。

## 宝塔站点配置

### 1. 主站 `你的页面域名`

在宝塔面板 → 网站 → `你的页面域名` → 反向代理。

**目标 URL**：`http://127.0.0.1:3003`

**配置内容**：
```nginx
location / {
    proxy_pass http://127.0.0.1:3003;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_connect_timeout 60s;
    proxy_send_timeout 300s;
    proxy_read_timeout 300s;
    send_timeout 300s;
}
```

### 2. API 站点 `api.你的页面域名`

在宝塔面板 → 网站 → 添加站点：
- **域名**：`api.你的页面域名`
- **PHP 版本**：纯静态

添加完成后，为该站点配置反向代理：
- **目标 URL**：`http://127.0.0.1:3003`

**配置内容**：
```nginx
location / {
    proxy_pass http://127.0.0.1:3003;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_connect_timeout 60s;
    proxy_send_timeout 300s;
    proxy_read_timeout 300s;
    send_timeout 300s;
}
```

图片通过 API 域名提供，无需额外站点配置。

## SSL 证书

分别为以下域名申请证书：
- `你的页面域名`
- `你的API域名`

在宝塔面板 → 网站 → 对应站点 → SSL：
- 选择 **Let's Encrypt**
- 勾选域名
- 点击 **申请**

## 部署流程

### 首次部署

1. 完成上述所有配置。
2. 在本地构建镜像：
   ```bash
   docker buildx build --platform linux/amd64 --build-arg VITE_API_BASE_URL=https://你的API域名 -t 你的镜像名:标签 --load .
   ```
3. 推送镜像到仓库。
4. 在宝塔面板 → Docker → 容器编排 → `gpt-image`。
5. 更新镜像版本号。
6. 点击 **更新编排**。
7. 点击 **拉取镜像**。
8. 点击 **启动**。
9. 查看日志确认启动成功：
   ```text
   ✅ Database connected successfully
   🔄 Initializing database tables...
   ✅ Database tables initialized successfully
   ✅ Redis connected
   🚀 Server running on port 80
   ```

### 更新部署

当有新版本镜像时：
1. 重新构建镜像，并确认 `VITE_API_BASE_URL` 仍指向你的 API 域名。
2. 推送镜像。
3. 修改 `docker-compose.yml` 中的镜像版本号。
4. 点击 **更新编排**。
5. 点击 **拉取镜像**。
6. 点击 **重启**。

## 验证部署

### 1. 检查容器状态
```bash
docker ps | grep gpt-image
```
应该看到两个容器：`gpt-image` 和 `gpt-image-redis`。

### 2. 检查 API 健康检查
浏览器访问：
- `https://api.你的页面域名/health`

应返回 200 或 `ok`。

### 3. 测试 GitHub 登录
访问主站，点击 GitHub 登录按钮，完成授权后应能正常返回主站并保持登录状态。

### 4. 检查前端请求目标
打开浏览器开发者工具 → Network，确认 `/api/*` 请求的主机是：
- `https://api.你的页面域名`

### 5. 测试长时间生图请求
触发一次耗时较长的生图请求，确认不再出现 Cloudflare 524。

## 常见问题

### GitHub 登录失败
- 检查 GitHub OAuth App 的回调 URL 是否为 `https://api.你的页面域名/api/auth/github/callback`
- 检查 `SESSION_COOKIE_DOMAIN=.你的根域名` 是否已配置
- 检查 `CORS_ORIGIN=https://你的页面域名` 是否正确
- 查看容器日志：`docker logs gpt-image`

### 登录成功但接口 401
- 确认前端请求地址是 `api.你的页面域名`
- 确认浏览器里 session cookie 的 domain 是 `.你的根域名` 或可被 API 子域访问
- 确认 API 子域使用 HTTPS

### 生图仍然超时
- 确认 `api.你的页面域名` 在 Cloudflare 中是 **DNS only（灰云）**
- 确认访问的是 API 子域，不是主站 `/api/*`
- 查看宝塔 API 站点日志和 `docker logs gpt-image`

### 图片无法访问
- 检查图片域名的 Nginx 配置
- 检查 SSL 证书是否正常
- 检查 `/www/wwwroot/gpt-image/images` 目录权限
- 检查 CORS 配置

## 日志查看

### 容器日志
```bash
# 查看主容器日志
docker logs -f gpt-image

# 查看 Redis 日志
docker logs -f gpt-image-redis
```

### Nginx 日志
在宝塔面板中分别查看：
- `你的页面域名` 站点日志
- `api.你的页面域名` 站点日志
- 图片域名站点日志

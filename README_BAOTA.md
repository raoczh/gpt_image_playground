# 宝塔面板部署配置指南

## 前置准备

### 1. 创建 GitHub OAuth App

访问 https://github.com/settings/developers → **New OAuth App**

填写信息：
```
Application name: GPT Image Playground
Homepage URL: https://gpt-image.raoczh.xyz
Authorization callback URL: https://gpt-image.raoczh.xyz/api/auth/github/callback
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

**注意**：数据库表会在容器启动时自动创建，无需手动导入 SQL 文件。

### 3. 生成 Session Secret

在终端执行：
```bash
openssl rand -base64 32
```
或使用在线工具生成一个 32 位以上的随机字符串。

## 宝塔面板配置

### 1. 容器编排配置

在宝塔面板 → Docker → 容器编排 → 添加编排

**编排名称**：`gpt-image`

**docker-compose.yml**：
```yaml
services:
  gpt-image:
    image: raoczh/gpt-image:custom-20260426-05
    container_name: gpt-image
    restart: always
    environment:
      # 数据库配置
      DB_HOST: ${DB_HOST:-172.18.0.1}
      DB_PORT: ${DB_PORT:-3306}
      DB_USER: ${DB_USER:-gpt-image}
      DB_PASSWORD: ${DB_PASSWORD}
      DB_NAME: ${DB_NAME:-gpt-image}
      # Redis 配置
      REDIS_HOST: redis
      REDIS_PORT: 6379
      # GitHub OAuth 配置
      GITHUB_CLIENT_ID: ${GITHUB_CLIENT_ID}
      GITHUB_CLIENT_SECRET: ${GITHUB_CLIENT_SECRET}
      GITHUB_CALLBACK_URL: https://gpt-image.raoczh.xyz/api/auth/github/callback
      # Session 密钥
      SESSION_SECRET: ${SESSION_SECRET}
      # 默认 API 配置（可选）
      DEFAULT_API_URL: ${DEFAULT_API_URL:-}
      DEFAULT_API_KEY: ${DEFAULT_API_KEY:-}
      # 图片配置
      IMAGE_BASE_URL: https://image.raoczh.xyz
      # 其他配置
      TZ: Asia/Shanghai
      NODE_ENV: production
    volumes:
      - /www/wwwroot/gpt-image/images:/data/images
    ports:
      - "127.0.0.1:3003:80"
    depends_on:
      - redis
    healthcheck:
      test: ["CMD-SHELL", "wget -q --spider http://localhost/health || exit 1"]
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

在编排配置页面，点击"环境变量"，填写：

```bash
# 数据库配置
DB_HOST=172.18.0.1
DB_PORT=3306
DB_USER=gpt-image
DB_PASSWORD=你的数据库密码
DB_NAME=gpt-image

# GitHub OAuth 配置
GITHUB_CLIENT_ID=你的_GitHub_Client_ID
GITHUB_CLIENT_SECRET=你的_GitHub_Client_Secret

# Session 密钥（使用前面生成的随机字符串）
SESSION_SECRET=你生成的32位随机字符串

# 默认 API 配置（可选，用户可以选择使用默认配置或自定义）
DEFAULT_API_URL=https://api.openai.com
DEFAULT_API_KEY=你的默认API密钥
```

**重要说明**：
- `DB_HOST=172.18.0.1` 是 Docker 网桥 IP，用于容器访问宿主机的 MySQL
- `DB_PASSWORD` 填写创建数据库时设置的密码
- `GITHUB_CLIENT_ID` 和 `GITHUB_CLIENT_SECRET` 填写 GitHub OAuth App 的凭据
- `SESSION_SECRET` 必须是随机生成的强密码，用于加密用户登录 session，确保安全性
- `DEFAULT_API_URL` 和 `DEFAULT_API_KEY` 是可选的全局默认配置，用户可以在前端选择"使用默认配置"或自定义自己的 API 配置

### 3. 创建必要的目录

在宝塔面板 → 文件 → 创建目录：
```
/www/wwwroot/gpt-image/images
/www/wwwroot/gpt-image/redis-data
```

设置权限：
```bash
chmod 755 /www/wwwroot/gpt-image/images
chmod 755 /www/wwwroot/gpt-image/redis-data
```

### 4. 配置反向代理

在宝塔面板 → 网站 → gpt-image.raoczh.xyz → 反向代理

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
}
```

## 配置图片域名 (image.raoczh.xyz)

### 1. Cloudflare DNS 配置

添加 A 记录：
- **类型**：A
- **名称**：image
- **内容**：你的服务器 IP
- **代理状态**：☁️ 已代理（推荐）或 DNS only

### 2. 宝塔面板创建网站

在宝塔面板 → 网站 → 添加站点：
- **域名**：image.raoczh.xyz
- **根目录**：/www/wwwroot/gpt-image/images
- **PHP 版本**：纯静态

### 3. 配置 Nginx

在网站设置 → 配置文件，修改为：

```nginx
server {
    listen 80;
    listen 443 ssl http2;
    server_name image.raoczh.xyz;
    
    # SSL 证书（宝塔自动配置）
    ssl_certificate /www/server/panel/vhost/cert/image.raoczh.xyz/fullchain.pem;
    ssl_certificate_key /www/server/panel/vhost/cert/image.raoczh.xyz/privkey.pem;
    
    root /www/wwwroot/gpt-image/images;
    index index.html;
    
    # CORS 配置
    add_header Access-Control-Allow-Origin "https://gpt-image.raoczh.xyz" always;
    add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type" always;
    
    if ($request_method = 'OPTIONS') {
        return 204;
    }
    
    # 缓存配置
    location / {
        expires 30d;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }
    
    # 禁止访问隐藏文件
    location ~ /\. {
        deny all;
    }
}
```

### 4. 申请 SSL 证书

在宝塔面板 → 网站 → image.raoczh.xyz → SSL：
- 选择 **Let's Encrypt**
- 勾选域名
- 点击 **申请**

## 部署流程

### 首次部署

1. 完成上述所有配置
2. 在宝塔面板 → Docker → 容器编排 → gpt-image
3. 点击 **拉取镜像**
4. 点击 **启动**
5. 查看日志确认启动成功：
   ```
   ✅ Database connected successfully
   🔄 Initializing database tables...
   ✅ Database tables initialized successfully
   ✅ Redis connected
   🚀 Server running on port 80
   ```

### 更新部署

当有新版本镜像时：
1. 修改 docker-compose.yml 中的镜像版本号
2. 点击 **更新编排**
3. 点击 **拉取镜像**
4. 点击 **重启**

## 验证部署

### 1. 检查容器状态
```bash
docker ps | grep gpt-image
```
应该看到两个容器：`gpt-image` 和 `gpt-image-redis`

### 2. 检查数据库表
在宝塔面板 → 数据库 → gpt-image → 管理，应该看到 4 个表：
- `users`
- `tasks`
- `images`
- `user_settings`

### 3. 测试 GitHub 登录
访问主站，点击 GitHub 登录按钮，应该跳转到 GitHub 授权页面。

### 4. 配置 API 设置
登录后，在用户设置中可以选择：
- **使用默认配置**：勾选后使用服务器配置的 `DEFAULT_API_URL` 和 `DEFAULT_API_KEY`
- **自定义配置**：不勾选时，可以配置自己的 API URL 和 API Key

每个用户的配置会保存在数据库中。

## 常见问题

### 数据库连接失败
- 检查 `DB_HOST` 是否为 `172.18.0.1`
- 检查 MySQL 是否允许远程连接
- 检查数据库密码是否正确
- 在宝塔面板 → 数据库 → 权限，确保允许 `172.18.%` 访问

### GitHub 登录失败
- 检查 GitHub OAuth App 的回调 URL 是否正确
- 检查 `GITHUB_CLIENT_ID` 和 `GITHUB_CLIENT_SECRET` 是否正确
- 查看容器日志：`docker logs gpt-image`

### 图片无法访问
- 检查 image.raoczh.xyz 的 Nginx 配置
- 检查 SSL 证书是否正常
- 检查 `/www/wwwroot/gpt-image/images` 目录权限
- 检查 CORS 配置

### Redis 连接失败
- 检查 redis 容器是否正常运行：`docker ps | grep redis`
- 查看 redis 日志：`docker logs gpt-image-redis`
- Redis 连接失败不影响基本功能，会降级使用内存 session

### 容器启动失败
- 查看容器日志：`docker logs gpt-image`
- 检查环境变量是否配置完整
- 检查端口 3003 是否被占用
- 检查 baota_net 网络是否存在：`docker network ls`

## 日志查看

### 容器日志
```bash
# 查看主容器日志
docker logs -f gpt-image

# 查看 Redis 日志
docker logs -f gpt-image-redis
```

### Nginx 日志
在宝塔面板 → 网站 → gpt-image.raoczh.xyz → 日志

## 备份建议

### 数据库备份
在宝塔面板 → 数据库 → gpt-image → 备份

### 图片备份
定期备份 `/www/wwwroot/gpt-image/images` 目录

### Redis 数据备份
定期备份 `/www/wwwroot/gpt-image/redis-data` 目录

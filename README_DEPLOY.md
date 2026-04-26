# GPT Image Playground - 改造说明

## 改造内容

将原本纯前端的项目改造为：
- GitHub OAuth 登录
- MySQL 数据库存储（用户、任务、图片链接）
- 图片自动上传到服务器
- 独立图片域名访问
- 页面与 API 分域部署，规避 Cloudflare 长请求超时

## 核心文件

### 后端代码
- `server/server.js` - Express 服务器（GitHub OAuth + API）
- `server/db.js` - MySQL 数据库连接
- `server/db.sql` - 数据库表结构
- `server/package.json` - 后端依赖

### 前端适配
- `src/lib/api.ts` - 生图请求客户端
- `src/lib/backendApi.ts` - 登录态、任务、图片相关接口客户端

### 部署配置
- `deploy/docker-compose.yml` - Docker 编排（包含 Redis）
- `deploy/.env.example` - 环境变量示例
- `build-docker.sh` - 镜像构建脚本（支持注入 `VITE_API_BASE_URL`）

## 推荐域名架构

```text
你的页面域名              -> 页面站点（Cloudflare 橙云）
api.你的页面域名          -> API 站点（Cloudflare 灰云 / DNS only）
你的图片域名              -> 图片静态资源站点
```

其中 `api.你的页面域名` 需要绕过 Cloudflare 代理，这样 `/api/generate` 这类长请求不会触发 524。

## 配置步骤

### 1. 创建 GitHub OAuth App

访问 https://github.com/settings/developers → New OAuth App

```text
Application name: GPT Image Playground
Homepage URL: https://你的页面域名
Callback URL: https://你的API域名/api/auth/github/callback
```

记录 Client ID 和 Client Secret。

### 2. 导入数据库表结构

```bash
mysql -u gpt-image -p gpt-image < server/db.sql
```

或在宝塔面板：数据库 → 管理 → 导入 → 上传 `server/db.sql`。

### 3. 配置环境变量

在宝塔面板的容器编排中，配置 `.env`：

```bash
DB_HOST=172.18.0.1
DB_PASSWORD=你的数据库密码
GITHUB_CLIENT_ID=你的Client_ID
GITHUB_CLIENT_SECRET=你的Client_Secret
GITHUB_CALLBACK_URL=https://你的API域名/api/auth/github/callback
SESSION_SECRET=随机生成的32位字符串
SESSION_COOKIE_DOMAIN=.你的根域名
CORS_ORIGIN=https://你的页面域名
APP_ORIGIN=https://你的页面域名
IMAGE_BASE_URL=https://你的图片域名/images
VITE_API_BASE_URL=https://你的API域名
DEFAULT_API_URL=https://api.openai.com/v1
DEFAULT_API_KEY=你的默认Key
DEFAULT_MODEL=gpt-5.3-codex
DEFAULT_TIMEOUT=300
DEFAULT_API_FORMAT=responses
```

关键点：
- `SESSION_COOKIE_DOMAIN=.你的根域名` 允许主站和 API 子域共享登录态
- `VITE_API_BASE_URL` 决定前端静态资源里写入的接口地址，改完后需要重建镜像
- `CORS_ORIGIN` 必须是主站页面域名，而不是 API 域名

### 4. 配置 Cloudflare DNS

#### 4.1 页面域名
- 类型：A
- 名称：`gpt-image`
- 内容：你的服务器IP
- 代理状态：☁️ 已代理

#### 4.2 API 域名
- 类型：A
- 名称：`api.gpt-image` 或 `api`
- 内容：你的服务器IP
- 代理状态：**DNS only（灰云）**

#### 4.3 图片域名
- 类型：A
- 名称：`image`
- 内容：你的服务器IP
- 代理状态：☁️ 已代理

### 5. 配置宝塔站点

#### 5.1 主站 `你的页面域名`
反向代理到：`http://127.0.0.1:3003`

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

#### 5.2 API 站点 `你的API域名`
新建站点后，同样反向代理到：`http://127.0.0.1:3003`

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

#### 5.3 图片站点 `你的图片域名`
静态根目录：`/www/wwwroot/gpt-image/images`

### 6. 构建并部署镜像

在本地或服务器执行：

```bash
VITE_API_BASE_URL=https://你的API域名 ./build-docker.sh
```

然后推送镜像，更新宝塔容器编排中的镜像版本并重启。

## 架构

```text
你的页面域名
  └── 页面入口（反向代理到 127.0.0.1:3003）

你的API域名
  └── API 入口（反向代理到 127.0.0.1:3003，Cloudflare 灰云）

容器内应用
  ├── Express + Session + GitHub OAuth
  ├── MySQL (172.18.0.1:3306)
  ├── Redis
  └── 图片存储 (/www/wwwroot/gpt-image/images)

你的图片域名
  └── Nginx 静态文件服务
```

## 验证

1. 打开 `https://你的API域名/health`，确认返回 200
2. 打开主站并登录 GitHub
3. 在浏览器 Network 中确认 `/api/*` 请求发往 `https://你的API域名`
4. 发起一次长时间生图请求，确认不再出现 Cloudflare 524

## 常见问题

### GitHub 登录失败
检查回调 URL 是否为 `https://你的API域名/api/auth/github/callback`。

### 登录后接口仍未带上 session
检查 `SESSION_COOKIE_DOMAIN=.你的根域名` 是否已配置，并确认 API 子域名使用 HTTPS。

### 生图仍然 524
检查 `你的API域名` 是否确实为灰云；如果仍走橙云，Cloudflare 仍会中断长请求。

### 页面请求还是打到旧域名
说明前端静态资源还是旧构建产物，需要重新执行带 `VITE_API_BASE_URL` 的镜像构建并重新部署。

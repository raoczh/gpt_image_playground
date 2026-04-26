# GPT Image Playground - 改造说明

## 改造内容

将原本纯前端的项目改造为：
- GitHub OAuth 登录
- MySQL 数据库存储（用户、任务、图片链接）
- 图片自动上传到服务器
- 独立图片域名访问

## 核心文件

### 后端代码
- `server/server.js` - Express 服务器（GitHub OAuth + API）
- `server/db.js` - MySQL 数据库连接
- `server/db.sql` - 数据库表结构
- `server/package.json` - 后端依赖

### 前端适配
- `src/lib/backendApi.ts` - 后端 API 客户端

### 部署配置
- `deploy/docker-compose.yml` - Docker 编排（包含 Redis）
- `deploy/.env.example` - 环境变量示例

## 配置步骤

### 1. 创建 GitHub OAuth App

访问 https://github.com/settings/developers → New OAuth App

```
Application name: GPT Image Playground
Homepage URL: https://gpt-image.raoczh.xyz
Callback URL: https://gpt-image.raoczh.xyz/api/auth/github/callback
```

记录 Client ID 和 Client Secret

### 2. 导入数据库表结构

```bash
mysql -u gpt-image -p gpt-image < server/db.sql
```

或在宝塔面板：数据库 → 管理 → 导入 → 上传 `server/db.sql`

### 3. 配置环境变量

在宝塔面板的容器编排中，配置 `.env`：

```bash
DB_HOST=172.18.0.1
DB_PASSWORD=你的数据库密码
GITHUB_CLIENT_ID=你的Client_ID
GITHUB_CLIENT_SECRET=你的Client_Secret
SESSION_SECRET=随机生成的32位字符串
CORS_ORIGIN=https://gpt-image.raoczh.xyz
APP_ORIGIN=https://gpt-image.raoczh.xyz
IMAGE_BASE_URL=https://image.raoczh.xyz/images
DEFAULT_API_URL=https://anyrouter.top
DEFAULT_API_KEY=你的默认Key
DEFAULT_MODEL=gpt-5.3-codex
DEFAULT_TIMEOUT=300
DEFAULT_API_FORMAT=responses
```

### 4. 配置 image.raoczh.xyz 图片域名

#### 4.1 Cloudflare DNS
添加 A 记录：
- 类型：A
- 名称：image
- 内容：你的服务器IP
- 代理状态：☁️ 已代理

#### 4.2 宝塔面板 Nginx
创建网站 `image.raoczh.xyz`，配置：

```nginx
server {
    listen 80;
    listen 443 ssl http2;
    server_name image.raoczh.xyz;
    
    # SSL 证书（宝塔自动配置）
    
    root /www/wwwroot/gpt-image/images;
    
    location / {
        # CORS 配置
        add_header Access-Control-Allow-Origin "https://gpt-image.raoczh.xyz" always;
        add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
        
        if ($request_method = 'OPTIONS') {
            return 204;
        }
        
        # 缓存配置
        expires 30d;
        add_header Cache-Control "public, immutable";
        
        try_files $uri =404;
    }
}
```

#### 4.3 申请 SSL 证书
在宝塔面板：网站 → image.raoczh.xyz → SSL → Let's Encrypt → 申请

### 5. 更新镜像并部署

在宝塔面板的容器编排中：
1. 更新镜像版本号
2. 点击"更新"拉取新镜像
3. 重启容器

## 数据库表结构

- `users` - 用户表（GitHub 用户信息）
- `tasks` - 任务表（生图记录和提示词）
- `images` - 图片表（图片链接和元数据）
- `user_settings` - 用户设置表（API Key 等）

## 架构

```
gpt-image.raoczh.xyz
  └── Docker 容器（前端 + 后端 + Redis）
      ├── MySQL (172.18.0.1:3306)
      └── 图片存储 (/www/wwwroot/gpt-image/images)

image.raoczh.xyz
  └── Nginx 静态文件服务
      └── /www/wwwroot/gpt-image/images
```

## 常见问题

### 数据库连接失败
检查 DB_HOST 是否为 `172.18.0.1`（Docker 网桥 IP）

### GitHub 登录失败
检查 OAuth 应用的回调 URL 是否正确

### 图片无法访问
检查 image.raoczh.xyz 的 Nginx 配置和 SSL 证书

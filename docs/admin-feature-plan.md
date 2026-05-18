# 管理员功能实施计划

> **创建日期**：2026-05-17
> **目标**：在现有 Backend-First 架构（Node + MySQL + GitHub OAuth + Express Session）之上，叠加一套完整的管理员后台，覆盖用户管理、注册控制、仪表盘、内容查看、配额、审计、系统配置七个模块。
> **范围**：必做 + 建议做 + 推荐做 + 可选做 全部纳入。

---

## 一、现状梳理

| 维度 | 现状 |
|---|---|
| 用户表 | `users(id, github_id, username, avatar_url, email, access_token, created_at, updated_at)` —— **无 role / status 字段** |
| 认证 | Express Session + Redis（降级内存），`req.session.userId` 识别身份，`requireAuth` 中间件 |
| 路由组织 | 全部集中在 [server/server.js](../server/server.js)（~1850 行），统一前缀 `/api/` |
| 前端路由 | React Router v6，仅 `/login` + `*`（AuthGuard 保护） |
| 软删除 | `tasks` / `images` 表已有 `deleted_at` |
| 审计 | 无 |
| 注册控制 | 无（任何 GitHub 账号都能登录） |
| 配额 | 无 |
| 系统配置 | 无 |

**核心痛点**：所有已认证用户权限相同，无法区分管理员；个人/小团队部署没有注册门槛，存在被陌生人占用资源的风险。

---

## 二、初始化策略

**不做管理员初始化页面**，简化方案：

1. 数据库 `users.role` 默认值 `'user'`，所有新注册用户都是普通用户
2. 部署后由运维直接 `UPDATE users SET role='admin' WHERE github_id=xxx;` 提升管理员
3. 不引入 `ADMIN_GITHUB_USERNAMES` 环境变量、不做"首次登录自动 admin"逻辑
4. 前端 admin 入口完全靠 `user.role === 'admin'` 判断显示

**优势**：零额外配置，部署体验和现在一致；权限提升路径明确、可审计（运维操作 SQL）。

---

## 三、权限模型

### 3.1 字段设计

```sql
ALTER TABLE users
  ADD COLUMN role         VARCHAR(16) NOT NULL DEFAULT 'user',
  ADD COLUMN status       VARCHAR(16) NOT NULL DEFAULT 'active',
  ADD COLUMN last_login_at DATETIME NULL,
  ADD INDEX idx_role (role),
  ADD INDEX idx_status (status);
```

- `role`：`'user'` / `'admin'`，仅两级
- `status`：`'active'` / `'disabled'` / `'pending'`
  - `active`：正常使用
  - `disabled`：被管理员禁用，登录时被拦截，已有 session 强制下线
  - `pending`：审核制下的待审核状态（仅当系统配置开启审核模式时使用）
- `last_login_at`：每次 OAuth 回调成功时更新，仪表盘和用户列表展示用

### 3.2 后端中间件

新增 [server/server.js](../server/server.js) 中间件：

```js
async function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'unauthorized' });
  const [rows] = await db.query('SELECT role, status FROM users WHERE id=?', [req.session.userId]);
  if (!rows[0] || rows[0].role !== 'admin' || rows[0].status !== 'active') {
    return res.status(403).json({ error: 'forbidden' });
  }
  req.adminUser = rows[0];
  next();
}
```

挂载在 `/api/admin/*` 全部路由之前。

### 3.3 status 拦截（多层防御）

`status` 不是 `active` 的用户不能访问任何业务接口。**只在前端做提示页是不够的**——前端可以被绕过、可以伪造请求，所以**接口层面是第一道也是最关键的一道防线**。

#### 3.3.1 后端拦截（核心，必须做）

**改造 `requireAuth` 中间件**，在现有 `req.session.userId` 检查后增加 status 校验：

```js
async function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'unauthorized' });

  // 每次请求查一次（轻量，单行 SELECT，可加 30s 内存缓存优化）
  const [rows] = await db.query(
    'SELECT id, role, status FROM users WHERE id=? AND deleted_at IS NULL',
    [req.session.userId]
  );
  const user = rows[0];

  if (!user) {
    // 用户已被软删
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'unauthorized', reason: 'deleted' });
  }

  if (user.status === 'disabled') {
    req.session.destroy(() => {});
    return res.status(403).json({ error: 'forbidden', reason: 'disabled' });
  }

  if (user.status === 'pending') {
    // 不销毁 session（pending 用户要能看到提示页 + 登出）
    return res.status(403).json({ error: 'forbidden', reason: 'pending' });
  }

  req.user = user;
  next();
}
```

**白名单豁免**：以下路由**绕过 status 校验**，否则 pending / disabled 用户会卡死：

- `POST /api/auth/logout` —— 必须能登出
- `GET /api/auth/me` —— 前端需要拿 status 来决定渲染哪个页面
- `GET /api/auth/github`、`GET /api/auth/github/callback` —— 登录入口

实现：把这些路由放在 `app.use(requireAuth)` 之前注册，或者单独走 `requireSession`（仅检查 session 不检查 status）的中间件。

#### 3.3.2 前端拦截（用户体验层）

`/api/auth/me` 返回 `role` 和 `status`，前端 `<AuthGuard>` 根据 status 路由：

| status | 前端表现 |
|---|---|
| `active` | 进入主应用 / `/admin` |
| `pending` | 强制重定向到 `/pending` 提示页（"账号待审核"） |
| `disabled` | 弹 toast → 跳回 `/login?error=disabled` |

`PendingPage.tsx` 仅提供：账号信息展示、申请说明文字（从 `system_config.review_message` 读，可配置）、登出按钮。**不渲染 InputBar / TaskGrid 等任何业务组件**。

#### 3.3.3 关键业务接口的二次保险

即使 `requireAuth` 已经拦截，对**会消耗资源 / 会写入用户数据**的核心接口，再加一道显式 status 检查（防御性编程，避免未来某次重构漏掉中间件）：

- `POST /api/generate` —— 生成图片
- `POST /api/images/upload`、`POST /api/images/save` —— 图片上传/保存
- `POST /api/tasks` —— 创建任务
- `PATCH /api/tasks/:id`、`DELETE /api/tasks/:id` —— 任务修改
- `POST /api/profiles`、`PATCH /api/profiles/:id` —— Profile 写操作
- `POST /api/custom-providers` —— 自定义 Provider 写

具体形式：在路由 handler 第一行 `if (req.user.status !== 'active') return res.status(403)...`。

#### 3.3.4 性能考量

`requireAuth` 现在每次都要查一次 `users` 表，可能比原来多一次 IO。优化方案：

- 内存缓存：`Map<userId, { role, status, expireAt }>`，TTL 30s
- 写操作（admin 改 role / status / 删用户 / 强制下线）时主动 invalidate 对应 userId 的缓存
- 30s 是用户体验和性能的折中：admin 改完最多 30s 后生效

### 3.4 前端守卫

- `store.ts` 的 `User` 类型增加 `role: 'user' | 'admin'`、`status: 'active' | 'pending' | 'disabled'`
- 新增 [src/components/AdminGuard.tsx](../src/components/AdminGuard.tsx)：`role !== 'admin'` 时重定向到 `/`
- 新增 [src/components/StatusGuard.tsx](../src/components/StatusGuard.tsx)：根据 `user.status` 分流到 `/pending` / `/login` / 主应用
- [src/components/Header.tsx](../src/components/Header.tsx) 右上角，admin 用户多一个"管理"入口（齿轮图标旁）

---

## 四、模块详情

### A. 用户管理（必做）

**列表页字段**：

| 列 | 来源 |
|---|---|
| 用户名 / 头像 | `users.username` / `avatar_url` |
| GitHub ID | `users.github_id` |
| 邮箱 | `users.email` |
| 角色 | `users.role` |
| 状态 | `users.status` |
| 注册时间 | `users.created_at` |
| 最后登录 | `users.last_login_at` |
| 任务数 | `COUNT(tasks WHERE user_id=? AND deleted_at IS NULL)` |
| 图片数 / 占用空间 | `COUNT/SUM(images WHERE user_id=? AND deleted_at IS NULL)` |

**操作**：

| 操作 | 说明 | 副作用 |
|---|---|---|
| 启用 / 禁用 | `status` 切换 `active` / `disabled` | 禁用时调用 `req.sessionStore.destroy` 清除该用户所有 session |
| 审核通过 | `status` 从 `pending` 切到 `active`（B 模块审核制下使用） | 用户下次刷新即可使用 |
| 提升 / 降级 admin | `role` 切换 | 不允许把自己降级（避免锁死） |
| 软删除用户 | `users` 加 `deleted_at`（需新增字段）+ 级联软删任务/图片 | 已有 session 强制下线 |
| 强制下线 | 仅清 session，不改用户状态 | 排查异常时单点踢下线 |
| 配额覆写 | 修改 `quota_overrides` JSON | E 模块依赖 |

**用户详情抽屉（UserDetailDrawer）—— admin 直接管控用户的 API Profile 和自定义 Provider**：

- 嵌入 admin 版本的 SettingsModal（复用现有 `SettingsModal` 组件，传入 `targetUserId` prop 切换数据源）
- 可手动新建 / 编辑 / 删除该用户的 `user_api_profiles` 全部字段（name / provider / base_url / api_key / model / timeout / api_format / extra_settings / is_default）
- 可手动新建 / 编辑 / 删除该用户的 `user_custom_providers` 全部字段（name / template / submit_config / edit_submit_config / poll_config）
- 可修改该用户的 `user_settings`（api_url / api_key / settings JSON）
- 表单使用"手动保存"按钮，不自动同步——admin 改完确认无误再点保存
- 所有写操作都进 `admin_audit_log`（M8 实装后），并附带修改前后值

**用途**：用户报问题时 admin 能直接帮看 / 改 Profile；新用户 onboarding；统一配置默认参数。

**搜索 / 筛选**：用户名模糊匹配、状态筛选（含 pending）、角色筛选、注册时间范围。

**分页**：游标分页或 page/pageSize（沿用现有 tasks 列表的方案）。

### B. 注册控制（建议做）

**三种模式**，由系统配置（G 模块）`registration_mode` 决定：

- `open`（默认）：任何 GitHub 账号都能登录注册
- `allowlist`：只有 `registration_allowlist` 表里的 username 能注册（已注册用户不受影响）
- `review`：新注册用户 `status='pending'`，无法使用核心功能；admin 在用户管理页审核通过后转为 `active`

**白名单表**：

```sql
CREATE TABLE registration_allowlist (
  id INT PRIMARY KEY AUTO_INCREMENT,
  github_username VARCHAR(64) NOT NULL UNIQUE,
  added_by INT NOT NULL,
  note VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_username (github_username)
);
```

**OAuth 回调流程改造**（[server/server.js](../server/server.js) `/api/auth/github/callback`）：

```
拿到 GitHub user → 看 users 表
  ├ 已存在 → 走原流程（更新 access_token / last_login_at）
  └ 不存在 → 看 registration_mode
      ├ open      → 创建 active 用户
      ├ allowlist → 在 registration_allowlist 找 username
      │              ├ 命中 → 创建 active 用户
      │              └ 不命中 → 重定向到 /login?error=not_allowed
      └ review    → 创建 pending 用户，登录后前端展示"待审核"提示页
```

**前端审核提示**：`status === 'pending'` 时，主应用区显示一个静态页（"账号待审核，请联系管理员"），不允许进入 TaskGrid。

### C. 系统仪表盘（推荐做）

**指标**：

- 用户：总数、近 7 日新增、近 30 日活跃（按 `last_login_at`）
- 任务：总数、近 7 日生成趋势（按天分组的折线）、按状态分布（pending / running / completed / failed）
- 图片：总数、磁盘占用总量、按用户 Top 10
- 异常：近 7 日失败任务数、最近 10 条失败任务（带错误信息）
- 最近活动：最近 10 个注册用户

**接口设计**：

```
GET /api/admin/stats/overview        总览卡片数据
GET /api/admin/stats/tasks-trend     折线图数据（?days=7|30）
GET /api/admin/stats/storage-top     存储 Top 10
GET /api/admin/stats/recent-failures 最近失败任务
```

**前端**：`recharts` 画折线 / 饼图，卡片式布局。

### D. 内容管理（建议做）

**Admin 对所有用户内容拥有完整操作权限**——查看、删除、收藏、修改都可以，不是只读。

**复用现有 TaskGrid + DetailModal**：

- 现有 `GET /api/tasks` 改造为接受可选 `?userId=N`（仅 admin 可传），不传时取自己的任务
- 新增 [src/pages/admin/UserTasksPage.tsx](../src/pages/admin/UserTasksPage.tsx)，URL `/admin/users/:id/tasks`
- 内嵌 TaskGrid，传入 `userId` 和 `adminMode` prop——保留所有原有按钮（删除、收藏、再生成、详情查看、批量操作）
- 用户列表的"任务数"列点击跳转过去

**后端权限放开**：现有 `/api/tasks/:id`、`/api/tasks/:id/favorite`、`/api/tasks/batch-delete` 等接口的 `WHERE user_id = ?` 校验改造为：

```js
// 当前
WHERE id = ? AND user_id = ?
// 改造后
const isAdmin = await checkAdmin(req.session.userId);
const sql = isAdmin
  ? 'WHERE id = ?'
  : 'WHERE id = ? AND user_id = ?';
```

封装一个 `assertTaskAccess(taskId, currentUserId)` helper：admin 直接放行；普通用户校验所有权。

**图片同理**：`/api/images/:id` 的 GET / DELETE 也走 admin 直通逻辑。

**审计追踪**：admin 对其他用户内容的写操作（删除、收藏、再生成）全部记入 `admin_audit_log`（M8 实装后），target_type=`task` / `image`，避免事后扯皮。

**用途**：内容合规巡查、帮用户清理垃圾任务、紧急下线违规内容。

### E. 配额限制（可选做）

**两个维度**：

| 配额 | 字段 | 校验时机 |
|---|---|---|
| 单用户每日生成次数 | `system_config.daily_generation_limit` | `/api/generate` 入口，按 `tasks WHERE user_id=? AND created_at >= today` 计数 |
| 单用户图片存储空间（MB） | `system_config.user_storage_limit_mb` | `/api/images/upload` + 生成产生新图片时，按 `SUM(images.size_bytes)` 校验 |

**用户级覆写**：`users` 表加 `quota_overrides JSON NULL`，admin 可在用户管理页针对单个用户调整（VIP 用户、内部测试号）。

**超限响应**：返回 429 + 友好错误码（`QUOTA_DAILY_EXCEEDED` / `QUOTA_STORAGE_EXCEEDED`），前端 toast 中文提示。

**配额展示**：用户设置页增加"我的额度"卡片，展示当日已用 / 剩余。

### F. 操作审计（建议做）

**表设计**：

```sql
CREATE TABLE admin_audit_log (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  actor_id INT NOT NULL,
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(32),
  target_id VARCHAR(64),
  before_value JSON,
  after_value JSON,
  ip VARCHAR(64),
  ua VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_actor (actor_id),
  INDEX idx_target (target_type, target_id),
  INDEX idx_action (action),
  INDEX idx_created (created_at)
);
```

**记录方式**：

- 在 `requireAdmin` 后增加一个轻量包装 `auditAction(actionName)`，挂在每条写操作路由上
- 自动捕获 `req.body` 作为 `after_value`、`req.query` 作为辅助、修改前的记录作为 `before_value`
- IP 和 UA 从 req 里提取

**记录的动作**：

| action | target_type | 触发路由 |
|---|---|---|
| `user.update_role` | `user` | `PATCH /api/admin/users/:id` |
| `user.update_status` | `user` | `PATCH /api/admin/users/:id` |
| `user.approve` | `user` | `POST /api/admin/users/:id/approve` |
| `user.delete` | `user` | `DELETE /api/admin/users/:id` |
| `user.force_logout` | `user` | `POST /api/admin/users/:id/logout` |
| `quota.override` | `user` | `PATCH /api/admin/users/:id/quota` |
| `user_settings.update` | `user_settings` | `PATCH /api/admin/users/:id/settings` |
| `profile.create` | `api_profile` | `POST /api/admin/users/:id/profiles` |
| `profile.update` | `api_profile` | `PATCH /api/admin/users/:id/profiles/:pid` |
| `profile.delete` | `api_profile` | `DELETE /api/admin/users/:id/profiles/:pid` |
| `custom_provider.create` | `custom_provider` | `POST /api/admin/users/:id/custom-providers` |
| `custom_provider.update` | `custom_provider` | `PATCH /api/admin/users/:id/custom-providers/:cpid` |
| `custom_provider.delete` | `custom_provider` | `DELETE /api/admin/users/:id/custom-providers/:cpid` |
| `task.delete_other_user` | `task` | `DELETE /api/tasks/:id`（仅当 admin 删别人的任务时记录） |
| `task.update_other_user` | `task` | `PATCH /api/tasks/:id`（同上） |
| `task.batch_delete_other_user` | `task` | `POST /api/tasks/batch-delete`（含别人任务时记录） |
| `image.delete_other_user` | `image` | `DELETE /api/images/:id`（同上） |
| `allowlist.add` | `allowlist` | `POST /api/admin/allowlist` |
| `allowlist.remove` | `allowlist` | `DELETE /api/admin/allowlist/:id` |
| `config.update` | `config` | `PATCH /api/admin/config` |

**`*_other_user` 命名约定**：admin 操作自己的内容不记录（和普通用户一样），只在跨用户操作时记录，避免日志噪音。

**查询页**：表格展示，支持按 actor / action / target / 时间筛选；点击单行展开看 before/after JSON diff。

### G. 系统配置（可选做）

**配置表**：

```sql
CREATE TABLE system_config (
  config_key VARCHAR(64) PRIMARY KEY,
  config_value JSON NOT NULL,
  updated_by INT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

**初始配置项**：

| key | 类型 | 说明 |
|---|---|---|
| `registration_mode` | `'open'` / `'allowlist'` / `'review'` | B 模块依赖 |
| `daily_generation_limit` | int / null | E 模块，null 表示不限制 |
| `user_storage_limit_mb` | int / null | E 模块 |
| `maintenance_mode` | bool | 维护模式总开关 |
| `maintenance_message` | string | 维护页提示语 |
| `announcement` | `{ enabled, level, content, expires_at }` | 全局公告横幅 |
| `default_api_profile` | object / null | 新用户注册时自动创建的默认 Profile（可空） |

**维护模式实现**：在 Express 全局中间件最前面（`requireAuth` 之前）加一段：

```js
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api/admin')) return next();        // admin 永远可访问
  if (req.path.startsWith('/api/auth')) return next();         // 登录路由保留
  const cfg = await getSystemConfig('maintenance_mode');
  if (cfg === true) return res.status(503).json({ error: 'maintenance' });
  next();
});
```

前端收到 503 时显示维护页（用 `maintenance_message`）。

**公告横幅**：在 Header 上方渲染，可关闭（关闭状态存 localStorage，按 `announcement.id` 区分；过期自动消失）。

**新用户默认 Profile**：注册成功后，如果 `default_api_profile` 非空，自动 INSERT 到 `user_api_profiles`。

---

## 五、API 总表

全部新增路由前缀 `/api/admin/`，全部使用 `requireAdmin` + `auditAction`（写操作）：

```
# 用户管理
GET    /api/admin/users                         列表（搜索、筛选、分页）
GET    /api/admin/users/:id                     单用户详情（含统计：任务数 / 图片数 / 占用空间）
PATCH  /api/admin/users/:id                     修改 role / status / quota_overrides
DELETE /api/admin/users/:id                     软删用户（级联软删任务/图片）
POST   /api/admin/users/:id/logout              强制下线
POST   /api/admin/users/:id/approve             审核通过（pending → active，B 模块）
PATCH  /api/admin/users/:id/quota               单独覆写配额

# 用户的 API 配置（admin 直接管控用户的 Profile / Provider / Settings）
GET    /api/admin/users/:id/settings            查看用户 settings
PATCH  /api/admin/users/:id/settings            修改 user_settings（手动保存）
GET    /api/admin/users/:id/profiles            列出用户全部 API Profile
POST   /api/admin/users/:id/profiles            为用户新建 Profile
PATCH  /api/admin/users/:id/profiles/:pid       修改用户 Profile
DELETE /api/admin/users/:id/profiles/:pid       删除用户 Profile
GET    /api/admin/users/:id/custom-providers    列出用户自定义 Provider
POST   /api/admin/users/:id/custom-providers    为用户新建 Custom Provider
PATCH  /api/admin/users/:id/custom-providers/:cpid   修改
DELETE /api/admin/users/:id/custom-providers/:cpid   删除

# 用户的内容（admin 完整 CRUD，不是只读）
GET    /api/admin/users/:id/tasks               查看用户任务（带分页/筛选）
GET    /api/admin/users/:id/images              查看用户图片
# 注：对单个 task / image 的修改/删除复用 /api/tasks/:id /api/images/:id，
#    后端通过 assertTaskAccess() 让 admin 直通；前端用同一套组件传 adminMode 即可

# 注册白名单
GET    /api/admin/allowlist                     白名单列表
POST   /api/admin/allowlist                     添加白名单
DELETE /api/admin/allowlist/:id                 删除白名单

# 仪表盘
GET    /api/admin/stats/overview                总览卡片
GET    /api/admin/stats/tasks-trend             任务趋势（?days=7|30）
GET    /api/admin/stats/storage-top             存储 Top 10
GET    /api/admin/stats/recent-failures         最近失败任务

# 审计日志
GET    /api/admin/audit-log                     列表（按 actor / action / target / 时间筛选）
GET    /api/admin/audit-log/:id                 单条详情

# 系统配置
GET    /api/admin/config                        所有配置
PATCH  /api/admin/config                        批量更新（key-value 对象）
GET    /api/admin/config/:key                   单项
```

**对现有接口的改造**：

```
GET    /api/auth/me                             响应增加 role / status 字段
GET    /api/tasks                               增加可选 ?userId=（仅 admin 可传）
DELETE /api/tasks/:id                           assertTaskAccess() 让 admin 直通
PATCH  /api/tasks/:id                           assertTaskAccess() 让 admin 直通
PATCH  /api/tasks/:id/favorite                  assertTaskAccess() 让 admin 直通
POST   /api/tasks/batch-delete                  对每个 task 调 assertTaskAccess()
GET    /api/images/:id / DELETE                 assertImageAccess() 让 admin 直通
POST   /api/generate                            入口加 status==='active' 二次保险 + 配额校验
POST   /api/images/upload                       配额校验（存储空间）
```

---

## 六、前端结构

```
src/
├── pages/
│   ├── LoginPage.tsx                          （已有）
│   ├── PendingPage.tsx                        （新）status=pending 提示页
│   ├── MaintenancePage.tsx                    （新）维护模式页
│   └── admin/
│       ├── AdminLayout.tsx                    侧边栏 + Outlet（仪表盘/用户/白名单/审计/配置）
│       ├── StatsPage.tsx                      仪表盘
│       ├── UsersPage.tsx                      用户列表
│       ├── UserDetailDrawer.tsx               用户详情侧边抽屉（含配额覆写 + Profile/Provider 管理）
│       ├── UserProfilesTab.tsx                admin 编辑用户 API Profile（嵌入 Drawer）
│       ├── UserProvidersTab.tsx               admin 编辑用户 Custom Provider（嵌入 Drawer）
│       ├── UserSettingsTab.tsx                admin 编辑用户 Settings（嵌入 Drawer）
│       ├── UserTasksPage.tsx                  用户任务（admin 完整操作权限）
│       ├── AllowlistPage.tsx                  白名单管理
│       ├── AuditLogPage.tsx                   审计日志
│       ├── ConfigPage.tsx                     系统配置（含维护模式、注册模式、配额、公告）
│       └── components/
│           ├── StatsCards.tsx
│           ├── TasksTrendChart.tsx
│           ├── UserTable.tsx
│           ├── AuditLogTable.tsx
│           └── AuditDiffViewer.tsx
├── lib/
│   └── adminApi.ts                            admin 专用 API 封装
└── components/
    ├── AdminGuard.tsx                         （新）role 守卫
    ├── StatusGuard.tsx                        （新）status 分流（active/pending/disabled）
    └── AnnouncementBanner.tsx                 （新）全局公告横幅
```

**路由扩展**（[src/App.tsx](../src/App.tsx) 或主路由文件）：

```tsx
<Route element={<StatusGuard />}>
  <Route element={<AuthGuard />}>
    <Route path="/" element={<MainApp />} />
    <Route element={<AdminGuard />}>
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="stats" />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="users/:id/tasks" element={<UserTasksPage />} />
        <Route path="allowlist" element={<AllowlistPage />} />
        <Route path="audit" element={<AuditLogPage />} />
        <Route path="config" element={<ConfigPage />} />
      </Route>
    </Route>
  </Route>
</Route>
<Route path="/pending" element={<PendingPage />} />
<Route path="/maintenance" element={<MaintenancePage />} />
<Route path="/login" element={<LoginPage />} />
```

**StatusGuard 逻辑**：

```
user.status === 'active'   → 渲染 <Outlet />
user.status === 'pending'  → <Navigate to="/pending" />
user.status === 'disabled' → 清 store → <Navigate to="/login?error=disabled" />
```

---

## 七、数据库 Migration（沿用现有自动迁移机制）

**部署方式不变**：直接在 [server/db.js](../server/db.js) 的 `initDatabase()` 函数里追加新建表 + 字段检查逻辑，**应用启动时自动执行**，运维不需要手动跑任何 SQL 脚本。

**机制说明**（参考 [server/db.js](../server/db.js) 现有写法）：

- 新表用 `CREATE TABLE IF NOT EXISTS` 直接创建，幂等
- 新字段用 `INFORMATION_SCHEMA.COLUMNS` 查询是否已存在，不存在再 `ALTER TABLE ADD COLUMN`
- 默认数据用 `INSERT IGNORE` 或先 SELECT 判空再插入，幂等
- 全部追加到 `initDatabase()` 末尾，按依赖顺序排列；保留原有迁移代码不动

**新增/变更项清单**：

| 项 | 类型 | 内容 |
|---|---|---|
| `users.role` | 字段 | `VARCHAR(16) NOT NULL DEFAULT 'user'` + `INDEX idx_role` |
| `users.status` | 字段 | `VARCHAR(16) NOT NULL DEFAULT 'active'` + `INDEX idx_status` |
| `users.last_login_at` | 字段 | `DATETIME NULL` |
| `users.deleted_at` | 字段 | `TIMESTAMP NULL` + `INDEX idx_deleted_at`（用户软删用） |
| `users.quota_overrides` | 字段 | `JSON NULL`（E 模块） |
| `registration_allowlist` | 新表 | github_username 唯一索引 |
| `admin_audit_log` | 新表 | actor_id / target / action / created 索引 |
| `system_config` | 新表 | config_key 主键 |
| 默认 system_config 行 | 数据 | `INSERT IGNORE` 7 个默认配置 |

**初始默认 system_config 数据**：

```sql
INSERT IGNORE INTO system_config (config_key, config_value) VALUES
  ('registration_mode',       '"open"'),
  ('daily_generation_limit',  'null'),
  ('user_storage_limit_mb',   'null'),
  ('maintenance_mode',        'false'),
  ('maintenance_message',     '"系统维护中，请稍后再试"'),
  ('announcement',            'null'),
  ('default_api_profile',     'null');
```

**[server/migrations/](../server/migrations/) 目录的处理**：

- 现有目录里 `001_add_deleted_at.sql` ~ `005_add_param_tracking.sql` 是历史文档参考，不参与运行时迁移
- 本次新增可选地补充几个 `.sql` 给 DBA 手工核对用：`006_admin_user_fields.sql` / `007_admin_aux_tables.sql`，**但运行时迁移不依赖这些文件**，db.js 是单一事实来源
- 可选，不强制。重点是 db.js 改完即可上线

**部署流程（与现状完全一致）**：

```
git pull → docker-compose up -d --build
  ↓
应用启动 → db.js.initDatabase() 自动执行
  ↓
新字段、新表、默认配置全部就位，无需手动操作
```

---

## 八、实施切片

按"最小可用 → 增强"的顺序，每片独立提交、独立可上线：

| 切片 | 内容 | 提交前缀 | 估时 |
|---|---|---|---|
| **M1 权限地基** | users 加 role/status/last_login_at/deleted_at 字段（db.js 自动迁移）+ requireAuth 增加 status 拦截 + 30s 用户缓存 + requireAdmin + AdminGuard + StatusGuard + PendingPage + Header 管理入口 + /api/auth/me 扩展 | `feat(admin): M1` | 0.7d |
| **M2 用户管理 + Profile 管控** | 用户列表 + 用户基础 CRUD（启用/禁用/审核/改角色/软删/强制下线）+ UserDetailDrawer + admin 编辑用户 settings/profiles/custom-providers（手动保存）+ 搜索筛选分页 | `feat(admin): M2` | 1.5d |
| **M3 内容全权限** | GET /api/tasks?userId= + GET /api/admin/users/:id/images + assertTaskAccess/assertImageAccess helper + UserTasksPage（admin 完整 CRUD）+ 现有 task/image 接口让 admin 直通 | `feat(admin): M3` | 0.5d |
| **M4 系统配置 + 维护模式** | system_config 表（db.js 自动迁移）+ getSystemConfig 缓存 + ConfigPage + 维护模式中间件 + MaintenancePage + 公告横幅 + AnnouncementBanner | `feat(admin): M4` | 0.7d |
| **M5 注册控制** | registration_allowlist 表 + OAuth 回调按 registration_mode 分流 + 审核制 pending 流程联调 + AllowlistPage + 新用户默认 Profile 注入 | `feat(admin): M5` | 0.8d |
| **M6 仪表盘** | stats 接口 4 个 + recharts 图表 + StatsPage | `feat(admin): M6` | 1d |
| **M7 配额** | users.quota_overrides 字段 + /api/generate 和 /api/images/upload 配额校验 + UserDetailDrawer 配额覆写 tab + 用户设置页"我的额度"卡片 | `feat(admin): M7` | 0.8d |
| **M8 审计日志** | admin_audit_log 表 + auditAction 包装中间件 + 跨用户 task/image 操作的审计触发 + AuditLogPage + AuditDiffViewer | `feat(admin): M8` | 0.8d |

**总计 ~6.8 个工作日**。

**关键依赖**：

- M2 依赖 M1（要有 role/status 字段和守卫）
- M3 依赖 M2（要从用户列表跳转 + 复用 UserDetailDrawer 风格）
- M5 依赖 M4（registration_mode 存在 system_config 里）+ M2（审核操作在用户管理页）
- M7 依赖 M2（配额覆写在 UserDetailDrawer 里）
- M6 / M8 相对独立，可在 M1 完成后随时并行

**推荐顺序**：M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8

---

## 九、验收标准

每个切片完成后必须满足：

- [ ] 数据库自动迁移：在干净库（首次部署）+ 现有库（已有数据）上启动 server 都能正常初始化字段/表
- [ ] 后端新接口在 [server/server.js](../server/server.js) 注册，且全部走 `requireAdmin`
- [ ] `requireAuth` 拦截 `disabled` / `pending` 用户（M1 完成后）
- [ ] 关键业务接口（generate / upload / tasks 写入）有 status==='active' 二次保险
- [ ] 关键写操作触发 `admin_audit_log` 写入（M8 完成后）
- [ ] 前端 admin 入口仅对 `role==='admin'` 可见，普通用户访问 `/admin` 重定向回 `/`
- [ ] 普通用户调用 `/api/admin/*` 返回 403
- [ ] pending 用户访问主应用任何页面强制跳 `/pending`，且无法触发任何 generate/upload 接口（前后端双重）
- [ ] 文档：[README.md](../README.md) 增加"管理员功能"小节，说明如何把用户提升为 admin（SQL 示例：`UPDATE users SET role='admin' WHERE github_id=...`）

---

## 十、风险与注意事项

1. **不能锁死自己**：admin 改自己 role / 删自己 / 禁用自己 时后端必须拦截，返回友好错误
2. **session 强制下线**：connect-redis 不一定支持按 userId 批量销毁。退路：每次 `requireAuth` 都 SELECT 一次 `users.status`（30s 缓存），发现 disabled 立即销毁当前 session——**已采用此方案**（见 §3.3.1）
3. **status 校验绕过风险**：仅靠前端 StatusGuard 不够，所有业务接口必须走 `requireAuth` 后端拦截。**严禁**只在前端隐藏功能而后端放行
4. **status 缓存延迟**：30s TTL 意味着 admin 禁用用户后最多 30s 才生效。可接受。如果要立即生效，可以在 PATCH /api/admin/users/:id 写入后主动 invalidate 缓存 + 销毁该用户 session
5. **审计日志爆炸**：高频操作不要审计（如读接口、generate）；只审计 admin 写操作 + admin 跨用户操作普通接口
6. **配置缓存**：`system_config` 读取频繁（维护模式中间件每次请求都查），加内存缓存（30s TTL），更新时主动 invalidate
7. **白名单大小写**：GitHub username 大小写不敏感，存储和比对都用 `LOWER()`
8. **审核制下的边界**：pending 用户必须能调用 `/api/auth/logout` 和 `/api/auth/me`，否则会卡死无法登出；这两个路由放在 status 拦截白名单
9. **维护模式自救**：admin 永远能进 `/api/admin/*` 和 `/admin` 页面（前端路由也要绕过维护态判断），否则一旦开启就锁死
10. **admin 删别人内容的风险**：删完无法恢复（软删可恢复 30 天，硬删不行）。前端确认弹窗要明确显示"正在删除用户 X 的内容"；M8 审计日志为事后追溯保底
11. **admin 改别人 Profile 的 api_key 风险**：admin 能看到也能改用户的 api_key，存在内部泄露隐患。建议 GET 接口返回 api_key 时做掩码处理（如 `sk-...abc1`），仅在 admin 主动点击"显示"按钮时调单独接口拉明文（该接口必进审计）。**这条建议放在 M2 实施时再决定要不要做**
12. **db.js 文件膨胀**：现有 db.js 已有大量 INFORMATION_SCHEMA 检查代码，本次再加一批字段会更长。可以考虑把 admin 相关迁移抽到 `server/dbAdminInit.js` 单独文件，由 db.js 调用——纯组织优化，不影响功能

---

## 十一、未来可扩展（不在本次范围）

- 多角色细分（reviewer / billing / support）
- 操作审批流（敏感操作需要二次确认）
- 邮件通知（审核结果、配额预警）
- 导出审计日志为 CSV
- API Key 管理（让 admin 能直接颁发服务端 API token，不依赖 GitHub OAuth）
- 用户分组 / 标签

这些等核心 8 个切片落地、稳定运行一段时间后再评估。

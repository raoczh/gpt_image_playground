# 优化计划

> 本文档汇总了对 GPT Image Playground 项目的全局评估与执行结果。  
> Phase 3（细节打磨）和 Phase 4（安全加固）已主动剔除，不再跟进。

---

## 一、阶段总览

| 阶段 | 内容性质 | 风险 | 状态 |
|---|---|---|---|
| **Phase 1** | 小而美的 bug 修复 + 体验改进 | 低 | ✅ 完成 |
| **Phase 2** | 涉及前后端协议改动的中型重构 | 中 | ✅ 已完成 P2-1/2/4/5/6/7；⏸️ P2-3 留单独立项 |

---

## 二、Phase 1：本轮要做的（小快好省）

> **状态：✅ 全部完成** —— `npx tsc --noEmit` 通过

### ✅ P1-1 Bug：`images/edits` 路径不传 `n` 参数

- **位置**：[server/server.js:260-282](server/server.js#L260)
- **现象**：用户在 UI 选了 n=4，走"参考图编辑"路径时实际只产出 1 张
- **根因**：FormData 没 append `n`
- **方案**：`if (params.n > 1) formData.append('n', String(params.n))`
- **工作量**：~5 分钟
- **改动**：[server/server.js](server/server.js) `callUpstreamImageApi` edits 分支增加 `n` 字段；日志里也带上 `n=...`

### ✅ P1-2 Bug：客户端超时硬编码 600s，与服务端用户配置不一致

- **位置**：[src/lib/api.ts:17](src/lib/api.ts#L17) 和 [server/server.js:169](server/server.js#L169)
- **现象**：用户把超时改到 60s，客户端依旧傻等 600s；或者反过来服务端先断，客户端误以为"还在跑"
- **方案**：客户端读 `settings.timeout`，并比服务端多 10s（避免比服务端先断），通过 `useStore.getState().settings.timeout`
- **工作量**：~10 分钟
- **改动**：
  - `callImageApi` 增加 `timeoutSec` 入参，内部计算 `timeoutSec * 1000 + 10s buffer`
  - `executeTask` 调用时传入 `useStore.getState().settings.timeout`

### ✅ P1-3 UX：`prompt` 持久化到 localStorage

- **位置**：[src/store.ts:117](src/store.ts#L117)
- **现象**：意外刷新或导航后，输入框文字全没
- **方案**：用 zustand `persist` middleware，只持久化 `prompt`（不要持久化 inputImages，因为 dataUrl 太大）
- **注意**：[App.tsx:100](src/App.tsx#L100) 登录成功后会 `localStorage.clear()`，需要调整为只清非应用 key
- **工作量**：~20 分钟
- **改动**：
  - `useStore` 用 `persist` 包装，`name: 'gpt-image-playground-prefs'`，`partialize` 只挑 `prompt` 和 `params`
  - [App.tsx](src/App.tsx) 改为白名单清理 localStorage，保留 `gpt-image-playground-prefs`

### ✅ P1-4 UX：`params` 持久化

- 同 P1-3。size/quality/format/n 这些用户更想保留
- **工作量**：和 P1-3 一起做，~5 分钟
- **改动**：与 P1-3 同一处 `partialize` 已包含 `params`

### ✅ P1-5 UX：Toast 队列化

- **位置**：[src/store.ts:161-167](src/store.ts#L161)，[src/components/Toast.tsx](src/components/Toast.tsx)
- **现象**：单例 toast，连续报错只看到最后一条；上一轮"图片上传失败"的提示会被后续淹没
- **方案**：toast state 改成数组，每条单独计时；UI 改成顶部堆叠
- **工作量**：~30 分钟
- **改动**：
  - 新增 `ToastItem` 类型 + `ToastType`
  - store 字段 `toast` 改为 `toasts: ToastItem[]`，每条独立 `setTimeout` 3s
  - 新增 `dismissToast(id)` 让用户点击关闭
  - `Toast.tsx` 渲染数组，垂直堆叠，点击关闭

### ✅ P1-6 UX：粘贴混合内容（图+文本）时不误吞文本

- **位置**：[src/components/InputBar.tsx:154-172](src/components/InputBar.tsx#L154)
- **现象**：从 Office/网页粘贴时 clipboardData 同时带图和文本，当前只要见到图就 `preventDefault`，导致文本无法粘贴
- **方案**：仅当 textarea 不在 focus 且有图时阻止；或图和文本分别处理
- **工作量**：~15 分钟
- **改动**：handlePaste 检测 `kind === 'string'` 的 text 项；目标是 textarea/input 且同时有文本时，**不**阻止默认行为（让浏览器把文本插入），同时把图片单独加进 inputImages

**Phase 1 合计**：~1.5 小时，全部低风险，已完成

---

## 三、Phase 2：中型重构（后续单独迭代）

### ✅ P2-1 ⭐ `/api/generate` 改用 image IDs 替代 dataUrl

- **位置**：[src/lib/api.ts:7-14](src/lib/api.ts#L7)、[server/server.js:816-840](server/server.js#L816)、`callUpstreamImageApi` 整段
- **问题**：前端把已经在服务端磁盘上的图，再次 base64 上传一遍。50MB JSON body 限制 ([server.js:381](server/server.js#L381)) 容易爆；浏览器请求体大也慢
- **方案**：客户端只发 `inputImageIds: string[]`，服务端按 ID 读盘 → 构造 dataUrl/Blob → 拼上游请求
- **影响面**：api.ts、store.ts(executeTask)、server.js(/api/generate + callUpstreamImageApi)
- **工作量**：~半天，需要测试 responses / generations / edits 三条路径
- **改动**：
  - 入参：`callImageApi` 请求体字段由 `inputImageDataUrls` 改为 `inputImageIds`；服务端新增 `loadInputImageDataUrls(userId, ids)`，按 `id IN (?)` + `user_id` + `deleted_at IS NULL` 批量查 `images` 表，缺图抛 `statusCode=400` 业务错误
  - 出参：`/api/generate` 拿到上游返回的 dataUrl 后直接服务端落盘（抽出 `saveGeneratedImageBytes` helper，`/api/images/save` 也复用此 helper），响应改为 `{ images: [{id, url}, ...] }`；客户端不再调用 `backendApi.saveImage`
  - 协议层省下两次 base64 往返（client→server 入参、server→client 出参→server 持久化）

### ✅ P2-2 ⭐ 服务端生成缩略图

- **问题**：[TaskCard.tsx:139](src/components/TaskCard.tsx#L139) 列表用原图当 thumbnail，1024×1024 PNG 拉满；100 条 = 几十 MB 首屏
- **方案**：保存图片时同步生成 `xxx_thumb.webp`（256px，q=70），DB 加 `thumb_url` 字段；列表用 thumb_url，Lightbox/详情用原图
- **依赖**：服务端需引入 sharp（或 @squoosh/lib）
- **工作量**：~半天
- **改动**：
  - 服务端：[server/server.js](server/server.js) 新增 `generateThumbnailBuffer` / `writeThumbnail` helper（sharp `fit:'inside' 256x256`，webp q=70），`saveGeneratedImageBytes` 与 `/api/images/upload` 落盘原图后并行写 `{imageId}_thumb.webp`；失败时 `thumb_url` 入库为 NULL，前端 fallback 到原图
  - DB：[server/db.js](server/db.js) `images` 表新增 `thumb_path` `thumb_url`（CREATE TABLE + 自动 ALTER 检测）；同步备份 [server/migrations/002_add_thumbnail.sql](server/migrations/002_add_thumbnail.sql) 与 [server/db.sql](server/db.sql)
  - API：`/api/tasks` 响应 JOIN 出 `input_thumb_urls` `output_thumb_urls`；`/api/generate` 透传 `saveGeneratedImageBytes` 返回的 `{id, url, thumb}`
  - Backfill：`app.listen` 回调里异步触发 `backfillThumbnails()`，按 `thumb_url IS NULL` 找历史图，并发 4 批量补；失败单张跳过、不影响启动接受请求
  - 前端：[src/types.ts](src/types.ts) `TaskRecord` 加 `inputThumbnails` / `outputThumbnails`；[src/lib/api.ts](src/lib/api.ts) `GeneratedImage` 加 `thumb`；[src/lib/backendApi.ts](src/lib/backendApi.ts) `Task` 加对应字段；[src/store.ts](src/store.ts) 映射 + `submitTask` 初始化空数组 + `executeTask` 写入 thumb；[src/components/TaskCard.tsx](src/components/TaskCard.tsx) 列表 thumb fallback 原图；[src/components/DetailModal.tsx](src/components/DetailModal.tsx) 输入图小图 fallback，但点击进 Lightbox 仍传原图 URL

### P2-3 ⭐⭐ 任务状态机改为服务端权威

- **问题**：现在前端发起任务、前端等结果、前端写回 `done`。客户端断开 → task 永远停在 `running`
- **方案**：
  - 前端 `POST /api/generate` 立刻返回 taskId（202 Accepted）
  - 服务端开 background job 调上游，结束自己写 DB
  - 前端用轮询（`GET /api/tasks/:id` 每 3s）或 SSE 拿状态
- **影响面**：整套任务流
- **工作量**：1-2 天

### P2-4 任务列表分页/无限滚动

- **位置**：[server/server.js:646](server/server.js#L646) `LIMIT 1000`、[TaskGrid.tsx:64](src/components/TaskGrid.tsx#L64) 全量渲染
- **方案**：`/api/tasks?cursor=&limit=20`，前端 IntersectionObserver 触发下一页；超过 200 条上 react-window
- **工作量**：~半天

### P2-5 搜索/过滤搬到后端

- **位置**：[TaskGrid.tsx:12-25](src/components/TaskGrid.tsx#L12)
- 配合 P2-4 一起做，`/api/tasks?q=&status=`
- **工作量**：~2 小时

### P2-6 物理文件清理

- **位置**：[server/server.js:740-795](server/server.js#L740)
- **问题**：只软删 DB，磁盘文件永远不清
- **方案**：启动时跑一次清理 + 每天定时清理 `deleted_at < NOW() - 30 days` 的物理文件（node-cron）
- **工作量**：~1 小时

### P2-7 错误信息友好化

- **位置**：[server/server.js:135-150](server/server.js#L135) `parseUpstreamError`
- **问题**：rate limit / safety filter / unsupported size 的英文 JSON 直接弹给用户
- **方案**：加 pattern → 中文映射表
- **工作量**：~30 分钟

---

## 四、Phase 2 后续完成情况

### ✅ P2-4 任务列表分页/无限滚动

- **位置**：[server/server.js:739](server/server.js#L739) 原 `LIMIT 1000`、[TaskGrid.tsx](src/components/TaskGrid.tsx) 原全量渲染
- **方案**：`/api/tasks?cursor=&limit=20&q=&status=`，前端 IntersectionObserver 触发下一页
- **改动**：
  - 服务端 cursor = base64(JSON({ts, id}))，排序 `(created_at DESC, id DESC)`，多取 1 条判断 `hasMore`；查询条件用动态 WHERE 列表拼接，prompt LIKE 模糊匹配
  - 响应改为 `{ items, nextCursor }`（带破坏性，前端同步改造）
  - 前端 store 新增 `tasksCursor` / `tasksHasMore` / `tasksLoading` 状态 + `loadTasksFirstPage` / `loadMoreTasks` 两个 action；防 race 用单调递增的 sequence number
  - `loadTasksFirstPage` 合并策略：拉新页前保留所有 `status === 'running'` 的本地任务，避免刚 submit 的任务被刷掉
  - [TaskGrid.tsx](src/components/TaskGrid.tsx) 移除前端 filter，加底部 sentinel + IntersectionObserver；监听 (user, searchQuery, filterStatus) debounce 300ms 触发首页重载

### ✅ P2-5 搜索/过滤搬到后端

- 与 P2-4 同源实现，`/api/tasks` 接受 `q` 和 `status` query；前端不再在内存里 filter
- 搜索框输入 debounce 300ms 后请求；状态过滤变化也走同一 debounce
- 服务端 prompt `LIKE %q%` 模糊匹配；status 限定 enum

### ✅ P2-6 物理文件清理

- **位置**：[server/server.js cleanupSoftDeleted](server/server.js)（startup + setInterval 24h）
- **方案**：扫 `images.deleted_at < NOW() - INTERVAL 30 DAY`，unlink 原图 + 缩略图，DELETE DB 行；tasks 表同样硬删 30 天前的 soft-deleted 行
- 失败单条跳过、记 warn 日志；不引入额外依赖（用 `setInterval`，不依赖 node-cron）

### ✅ P2-7 错误信息友好化

- **位置**：[server/server.js parseUpstreamError / friendlyUpstreamMessage](server/server.js)
- **方案**：`UPSTREAM_ERROR_PATTERNS` 数组按优先级匹配（rate limit / quota / safety / size / auth / timeout / model / network），命中即替换为中文；未命中保留原文
- `/api/generate` catch 里非业务错误（`statusCode` 未设）也走友好化，覆盖 abort/timeout/网络异常

### ⏸️ P2-3 任务状态机改为服务端权威

- **未做**：工作量 1-2 天，涉及任务流范式变化（前端发起 → 服务端权威 + 轮询/SSE）
- **后续**：需独立立项 + 单独 PR

---

## 五、Phase 1 执行结果

**状态**：✅ 全部完成，`npx tsc --noEmit` 通过

| 项 | 状态 | 备注 |
|---|---|---|
| P1-1 edits 补传 n | ✅ | server.js callUpstreamImageApi edits 分支 |
| P1-2 客户端超时一致 | ✅ | api.ts 增加 timeoutSec 参数，executeTask 传入 settings.timeout，+10s buffer |
| P1-3 prompt 持久化 | ✅ | zustand persist + partialize |
| P1-4 params 持久化 | ✅ | 同 P1-3，包含在同一份 partialize 内 |
| P1-5 Toast 队列化 | ✅ | store 字段改 toasts: ToastItem[]，UI 垂直堆叠，点击关闭 |
| P1-6 粘贴混合内容 | ✅ | 检测 text/* item 同存时不 preventDefault，让文本正常插入 |

**附带顺手清理**：
- 删除 store.ts 中未用的 `dbDeleteTask` / `dbClearTasks` import
- 删除 InputBar.tsx 中未用的 `setShowSettings`

**Phase 2 已完成**：

| 项 | 状态 | 备注 |
|---|---|---|
| P2-1 image IDs | ✅ | 客户端只发 ID，服务端按 ID 读盘构造上游请求；`/api/generate` 直接落盘返回 `{id,url}`；省两次 base64 往返 |
| P2-2 服务端缩略图 | ✅ | 引入 sharp，落盘原图同步生成 256px webp 缩略图；DB 加 `thumb_path`/`thumb_url`；`/api/tasks` 同时返回缩略图 URL；启动时 backfill 历史图（并发 4）；前端列表/输入图小图优先用缩略图，Lightbox/详情大图用原图 |
| P2-4 任务列表分页 | ✅ | `/api/tasks?cursor=&limit=20`，cursor 基于 (created_at, id) base64 编码；前端 IntersectionObserver 触发下一页；首页重载保留本地 running 任务 |
| P2-5 搜索过滤后端化 | ✅ | `q` 走 prompt LIKE，`status` 过滤；前端 debounce 300ms 触发；TaskGrid 移除前端 filter |
| P2-6 物理文件清理 | ✅ | 启动 + 每 24h 扫 `deleted_at > 30d` 的 images 与 tasks，硬删并 unlink 原图/缩略图 |
| P2-7 错误信息友好化 | ✅ | parseUpstreamError + `/api/generate` catch 走 `friendlyUpstreamMessage`，覆盖限流/额度/安全/尺寸/鉴权/超时/模型/网络 8 类 |
| P2-3 任务状态机服务端权威 | ⏸️ | 工作量 1-2 天，留单独立项 |

**后续建议下一轮**：

- **P2-3** ⭐⭐ 任务状态机改为服务端权威（剩余唯一中型项，1-2 天，需独立立项）

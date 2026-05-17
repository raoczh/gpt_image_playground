# 上游功能补齐计划

> 不直接合并上游，而是按本分支的 backend-first 架构重新实现上游 v0.2.8 → v0.3.5 的功能性更新。
> 实现完成后再做一次正式上游合并——届时大部分功能已存在，解冲突时可直接 take ours。

---

## 一、背景

- **本分支**：`local-gpt-image`，fork 点 `f524ff0` (v0.2.7)，14 个 commit
- **上游**：`main` 已同步到 v0.3.5，共领先 75 个 commit
- **方向冲突**：本分支走「后端化」（[server/](../server/) + MySQL + GitHub 登录 + 宝塔编排），上游走「前端化」（IndexedDB + 浏览器本地存储 + 多 provider）
- **冲突现状**：直接 `git merge main` 会产生 16 个文件冲突，其中 15 个 content 冲突 + 1 个 modify/delete，几乎所有核心文件（store.ts、types.ts、api.ts、SettingsModal/Header/InputBar/TaskGrid/TaskCard/DetailModal）双方都大改

## 二、策略

**重新实现 > 直接合并**：

1. 在 `local-gpt-image` 分支上按本分支架构实现上游的功能性更新
2. 实现完成后再 `git merge main`：
   - 已实现的功能（store/types/api 等核心文件）→ take ours
   - 未实现的纯新增文件（如 [MaskEditorModal.tsx](../src/components/MaskEditorModal.tsx)）→ take theirs
   - 配置文件 / 部署文件 → 手工合
3. 实现期间每个功能一个独立 commit，方便回滚和未来比对

**优势**：

- 不被上游 IndexedDB 那套限制，可以按后端架构最佳方式落地
- 每个功能小步独立提交，可逐项验证、可回滚
- 解决"功能等价但代码文本不同"的冲突最容易（直接 take ours）

## 三、上游可参考的代码位置

后续实现时，从 `main` 分支查阅上游实现：

| 功能 | 上游关键文件 | 上游关键 commit |
|---|---|---|
| 蒙版编辑器 | `src/components/MaskEditorModal.tsx` `src/lib/mask.ts` `src/lib/maskPreprocess.ts` `src/lib/canvasImage.ts` `src/lib/viewportTransform.ts` | `a58e1ac` `93b3a20` `a1161ff` |
| fal.ai provider | `src/lib/falAiImageApi.ts` | `bc496dc` |
| API Profiles | `src/lib/apiProfiles.ts` `src/lib/openaiCompatibleImageApi.ts` `src/components/SettingsModal.tsx` | `612617a` `9340611` |
| @mention 图片引用 | `src/lib/promptImageMentions.ts` `src/components/InputBar.tsx` | `472c338` `5bc8ddf` `80be14d` `af664db` |
| 缩略图独立存储 | `src/lib/db.ts` `src/components/TaskCard.tsx` | `3699eb8` `b2ca42e` `956539d` |
| 批量/收藏/参数追踪/PWA | `src/store.ts` `src/components/TaskGrid.tsx` `src/components/TaskCard.tsx` | `10ad814` |
| 参考图拖拽排序 | `src/components/InputBar.tsx` | `7666b8f` `7e16aa7` |
| iOS / PWA 修复 | `src/components/Lightbox.tsx` `src/components/Header.tsx` | `fd92d2d` `cf01aa7` `40b07da` |
| Responses API 保护 | `src/lib/api.ts` | `eb1c5f8` |

查上游代码：`git show main:src/components/MaskEditorModal.tsx` 或 `git diff f524ff0..main -- <file>`

## 四、阶段总览

| 阶段 | 内容 | 风险 | 后端依赖 | 状态 |
|---|---|---|---|---|
| **Phase U1** | 纯新增前端功能：蒙版编辑器、fal.ai provider、iOS 修复、通用组件 | 低 | 无 | ⏳ |
| **Phase U2** | 前端大改造但无后端依赖：@mention、API Profiles、Responses API 保护 | 中 | 无 | ⏳ |
| **Phase U3** | 后端配合实现：批量操作、收藏、参数追踪 | 中 | 需扩 schema 和 API | ⏳ |
| **Phase U4** | 性能与体验细节：缩略图相关已做（见 P2-2），剩余的图片缓存控制、详情解码优化 | 低 | 无 | ⏳ |

---

## 五、Phase U1：纯新增前端功能（最低风险，先做）

### U1-1 蒙版编辑器 (Mask Editor)

- **上游**：`a58e1ac` `93b3a20` `a1161ff`，[src/components/MaskEditorModal.tsx](../src/components/MaskEditorModal.tsx) 1033 行
- **配套**：[src/lib/mask.ts](../src/lib/mask.ts) [src/lib/maskPreprocess.ts](../src/lib/maskPreprocess.ts) [src/lib/canvasImage.ts](../src/lib/canvasImage.ts) [src/lib/viewportTransform.ts](../src/lib/viewportTransform.ts)
- **测试**：[src/lib/mask.test.ts](../src/lib/mask.test.ts) [src/lib/maskPreprocess.test.ts](../src/lib/maskPreprocess.test.ts) [src/lib/viewportTransform.test.ts](../src/lib/viewportTransform.test.ts)
- **本分支接入点**：
  - [src/components/InputBar.tsx](../src/components/InputBar.tsx)（添加蒙版编辑入口按钮）
  - [src/components/DetailModal.tsx](../src/components/DetailModal.tsx)（在结果图上启动蒙版编辑）
  - [src/lib/api.ts](../src/lib/api.ts) → `callImageApi` 入参增加 `mask`（base64 mask），透传给 [server/server.js](../server/server.js)
  - [server/server.js](../server/server.js) → `callUpstreamImageApi` 在 edits 路径上把 mask append 到 FormData（上游 OpenAI API 已经支持 `mask` 字段）
- **决策**：mask 不持久化为独立 image 记录，每次 edits 现编现用即可（与本分支"图片即资源"语义一致）
- **预估工作量**：1 天
- **状态**：⏳

### U1-2 fal.ai Provider 支持

- **上游**：`bc496dc`，[src/lib/falAiImageApi.ts](../src/lib/falAiImageApi.ts) 227 行
- **本分支接入点**：
  - 这是「上游」调用的另一种实现，本分支的请求实际由后端 [server/server.js](../server/server.js) `callUpstreamImageApi` 转发，**该函数当前只支持 OpenAI 兼容**
  - 需要在后端识别 provider 类型（OpenAI / fal.ai），分别走不同的请求构造和响应解析
  - 用户配置层：[server/server.js](../server/server.js) `/api/settings` 加 `provider` 字段；前端 [SettingsModal.tsx](../src/components/SettingsModal.tsx) 加 provider 选择
- **依赖**：与 U2-2 (API Profiles) 紧耦合，建议合并一起做
- **预估工作量**：U1-2 + U2-2 一起约 2 天
- **状态**：⏳

### U1-3 通用组件库

- **上游新增**：[src/components/Checkbox.tsx](../src/components/Checkbox.tsx) [src/components/HelpModal.tsx](../src/components/HelpModal.tsx) [src/components/SupportPromptModal.tsx](../src/components/SupportPromptModal.tsx) [src/components/ViewportTooltip.tsx](../src/components/ViewportTooltip.tsx) [src/components/icons.tsx](../src/components/icons.tsx)
- **配套 hook**：[src/hooks/useTooltip.ts](../src/hooks/useTooltip.ts) [src/hooks/usePreventBackgroundScroll.ts](../src/hooks/usePreventBackgroundScroll.ts)
- **配套库**：[src/lib/dropdown.ts](../src/lib/dropdown.ts) [src/lib/domRect.ts](../src/lib/domRect.ts) [src/lib/tooltipDismiss.ts](../src/lib/tooltipDismiss.ts) [src/lib/clipboard.ts](../src/lib/clipboard.ts)
- **策略**：直接 cherry-pick，零冲突
- **预估工作量**：1 小时
- **状态**：⏳

### U1-4 iOS / PWA 修复

- **上游**：`fd92d2d` (头部安全区)、`cf01aa7` (长按图片)、`40b07da` (native callout)
- **本分支接入点**：
  - [src/components/Header.tsx](../src/components/Header.tsx)（safe area inset 适配）
  - [src/components/Lightbox.tsx](../src/components/Lightbox.tsx) [src/components/TaskCard.tsx](../src/components/TaskCard.tsx)（iOS 长按手势保留）
  - [public/manifest.json](../public/manifest.json) 等 PWA 资源
- **预估工作量**：2 小时
- **状态**：⏳

### U1-5 参考图拖拽排序

- **上游**：`7666b8f` `7e16aa7`，主要改 [src/components/InputBar.tsx](../src/components/InputBar.tsx)
- **本分支接入点**：[src/store.ts](../src/store.ts) `inputImages` 已经是 `InputImage[]` 数组，加一个 `reorderInputImages(from, to)` action 即可
- **预估工作量**：3 小时
- **状态**：⏳

---

## 六、Phase U2：前端大改造（无后端依赖）

### U2-1 @mention 图片引用

- **上游**：`472c338` `5bc8ddf` `80be14d` `af664db`，[src/lib/promptImageMentions.ts](../src/lib/promptImageMentions.ts) + [src/components/InputBar.tsx](../src/components/InputBar.tsx) 从 textarea 改为 contentEditable
- **行为**：用户在输入框打 `@`，弹出输入历史里的图片选择器（在本分支是当前 session 的 `inputImages`），选中后插入 `@图1` token；提交前自动把 `@图N` 替换为 API 能理解的 `[image N]`
- **本分支接入点**：
  - InputBar 完全重写为 contentEditable（这是本次最大的前端单点改造）
  - 拿来即用上游的 [promptImageMentions.ts](../src/lib/promptImageMentions.ts) 解析逻辑
  - 注意：本分支 `inputImages` 语义需澄清——是当前任务的输入参考图，还是历史图片库？上游是后者，本分支默认是前者，需要新增「从图片库选图」UI 入口（可走 [src/lib/backendApi.ts](../src/lib/backendApi.ts) 拉历史 image 列表）
- **预估工作量**：2-3 天（InputBar 重写 + 联调 + 测试）
- **状态**：⏳

### U2-2 API Profiles 多 Provider 配置

- **上游**：[src/lib/apiProfiles.ts](../src/lib/apiProfiles.ts) 727 行 + [src/components/SettingsModal.tsx](../src/components/SettingsModal.tsx) 大改
- **上游模型**：一个 profile = `{name, provider, apiUrl, apiKey, format}`，用户可以保存多个 profile 随时切换
- **本分支需要权衡**：
  - 当前 [server/db.sql](../server/db.sql) `user_settings` 是单一 `(api_url, api_key)` 行，要扩成 `user_api_profiles` 表（user_id, name, provider, api_url, api_key, settings, is_default, created_at）
  - `/api/settings` 改为 `/api/profiles` (GET 列表 / POST 创建 / PUT 更新 / DELETE 删除)
  - 任务提交时带 profile_id，[server/server.js](../server/server.js) `callUpstreamImageApi` 按 profile 选择 provider 实现
- **决策**：是否要支持多 profile 切换？还是只要支持 OpenAI / fal.ai 两种 provider 类型即可？前者更灵活但 UI 改造大，后者简单。
- **预估工作量**：3-4 天（含 U1-2 fal.ai 集成）
- **状态**：⏳

### U2-3 Responses API 提示词防护

- **上游**：`eb1c5f8` "always guard Responses API prompts"
- **本分支接入点**：本分支已经支持 Responses API ([server/server.js](../server/server.js) 中有相关代码)，需要检查 prompt 防护逻辑是否完备
- **预估工作量**：1 小时
- **状态**：⏳

---

## 七、Phase U3：后端配合（需要扩 schema 和 API）

### U3-1 任务批量操作（多选删除/导出）

- **上游**：`10ad814` (v0.2.9)
- **本分支需要**：
  - 后端：[server/server.js](../server/server.js) 新增 `POST /api/tasks/batch-delete` 接受 `taskIds[]`，逐个软删除
  - 前端：[src/components/TaskGrid.tsx](../src/components/TaskGrid.tsx) 加多选模式 UI，store 加 `selectedTaskIds: Set<string>` 状态
  - 导出：本分支已有 `exportAllToZip` ([store.ts](../src/store.ts))，加 `exportSelected(ids)` 变体即可
- **预估工作量**：1.5 天
- **状态**：⏳

### U3-2 收藏 (Favorites)

- **上游**：`10ad814`
- **本分支需要**：
  - DB：`tasks` 表加 `is_favorite TINYINT(1) DEFAULT 0`，加 `idx_favorite` 索引；migration `003_add_favorites.sql`
  - 后端：`PUT /api/tasks/:id/favorite` 切换；`/api/tasks` 查询参数加 `favorite=1`；TaskRecord 序列化加 `isFavorite`
  - 前端：[TaskCard.tsx](../src/components/TaskCard.tsx) 加星标按钮；[Header.tsx](../src/components/Header.tsx) 或筛选条加「只看收藏」过滤
- **预估工作量**：1 天
- **状态**：⏳

### U3-3 参数变更链可视化 (Param Tracking)

- **上游**：`10ad814`
- **行为**：用户基于一张结果图发起新任务时，记录"父任务"和"参数变更"，可视化为一条链
- **本分支需要**：
  - DB：`tasks` 表加 `parent_task_id VARCHAR(50) NULL`；index
  - 前端：[InputBar.tsx](../src/components/InputBar.tsx) / [DetailModal.tsx](../src/components/DetailModal.tsx) 在"基于此图继续生成"时带上 parent
  - [DetailModal.tsx](../src/components/DetailModal.tsx) 加「变更链」面板
- **决策**：是否值得做？需要确认这个功能的实际价值
- **预估工作量**：2 天
- **状态**：⏳ (可选)

---

## 八、Phase U4：性能与体验细节

### U4-1 图片缓存内存上限

- **上游**：`956539d` "limit image cache memory usage"
- **本分支接入点**：[src/store.ts](../src/store.ts) `imageCache: Map<string, string>` 当前无上限，需要 LRU 截断（比如保留最近 100 张）
- **预估工作量**：2 小时
- **状态**：⏳

### U4-2 详情预览避免完整图解码

- **上游**：`1144333` "avoid full image decode in detail preview"
- **本分支接入点**：[src/components/DetailModal.tsx](../src/components/DetailModal.tsx) 入口缩略图先显示，点击放大才拉原图（缩略图已有，主要是 UI 显示策略）
- **状态**：⏳

### U4-3 Lightbox 避免过期图加载

- **上游**：`c1b2f86` "avoid stale lightbox image loads"
- **本分支接入点**：[src/components/Lightbox.tsx](../src/components/Lightbox.tsx) 切图时取消上一张未完成的 image load（带 generation token 或 AbortController）
- **状态**：⏳

### U4-4 详情模态背景虚化保留

- **上游**：`013d369` "preserve blurred modal styling"
- **状态**：⏳

---

## 九、明确不做的部分

| 项 | 原因 |
|---|---|
| Vercel Deploy Hooks (`.github/workflows/vercel-tag-deploy.yml`) | 本分支走宝塔/Docker，不用 Vercel |
| Cloudflare Worker (`wrangler.jsonc`) | 同上 |
| Docker 环境变量重构 (`DEFAULT_API_URL` / `API_PROXY_URL`) | 本分支后端已掌管 API URL |
| Nginx 代理路径限制 (`ddae214`) | 本分支后端就是 Node 服务，不依赖 Nginx 代理浏览器请求 |
| IndexedDB 相关持久化与迁移 | 本分支已替换为后端 + MySQL |
| `useVersionCheck` hook | 本分支 [src/hooks/useVersionCheck.ts](../src/hooks/useVersionCheck.ts) 已删除 |

---

## 十、实现完成后的合并策略

当 U1-U2 全部完成、U3-U4 按需完成后，执行正式合并：

```bash
git checkout local-gpt-image
git merge main
```

预期冲突解决策略：

| 文件 | 策略 |
|---|---|
| `src/store.ts` | take ours（后端架构差异本质，本分支已实现等价功能） |
| `src/types.ts` | take ours |
| `src/lib/api.ts` | take ours |
| `src/components/SettingsModal.tsx` | take ours |
| `src/components/Header.tsx` | take ours |
| `src/components/InputBar.tsx` | take ours（U2-1 已重写） |
| `src/components/TaskGrid.tsx` | take ours（U3-1 已实现） |
| `src/components/TaskCard.tsx` | take ours |
| `src/components/DetailModal.tsx` | take ours |
| `src/components/Lightbox.tsx` | 手工合（细节修复需要逐一比对） |
| `src/components/Toast.tsx` | take ours（已有队列化） |
| `src/main.tsx` `src/App.tsx` | 手工合（入口和路由） |
| `package.json` `package-lock.json` | 取并集，重新 `npm install` |
| `.gitignore` | 取并集 |
| `src/hooks/useVersionCheck.ts` (modify/delete) | take ours (deleted) |
| 上游新增文件（未涉及冲突） | take theirs（自动并入） |

---

## 十一、新对话恢复指引

> **如果你（Claude 或我自己）在新对话里继续这件事，从这里开始**

1. **读这份文档** ([docs/upstream-merge-plan.md](upstream-merge-plan.md))，了解策略与阶段
2. **查看当前进度**：`git log local-gpt-image --oneline | head -30`，看 `feat(upstream):` 前缀的 commit
3. **当前已实现的功能**：搜索本文档中状态为 ✅ 的项
4. **选择下一项**：从未完成的最高优先级阶段（U1 → U2 → U3 → U4）里取
5. **实现规范**：
   - 每个功能一个独立 commit
   - commit message 用 `feat(upstream): <功能名>` 或 `fix(upstream): <修复>` 前缀，便于过滤
   - 实现前先用 `git show main:<file>` 查上游实现作为参考
   - 实现后更新本文档对应项的状态为 ✅，附上落地位置和决策记录（沿用 [docs/optimization-plan.md](optimization-plan.md) 的风格）
   - 跑 `npx tsc --noEmit` 确保类型通过
6. **决策点**：本文档中标有"决策"的位置在动手前先确认（U1-1 mask 不持久化、U2-2 是否多 profile、U3-3 是否要做）

---

## 十二、进度跟踪

> 完成一项后，把对应项的"状态"从 ⏳ 改为 ✅，并在下面表格里更新

| 项 | 阶段 | 状态 | 完成时间 | 关键 commit |
|---|---|---|---|---|
| U1-1 蒙版编辑器 | U1 | ⏳ | — | — |
| U1-2 fal.ai provider | U1 | ⏳ | — | — |
| U1-3 通用组件库 | U1 | ⏳ | — | — |
| U1-4 iOS / PWA 修复 | U1 | ⏳ | — | — |
| U1-5 参考图拖拽排序 | U1 | ⏳ | — | — |
| U2-1 @mention 图片引用 | U2 | ⏳ | — | — |
| U2-2 API Profiles 多 provider | U2 | ⏳ | — | — |
| U2-3 Responses API 防护 | U2 | ⏳ | — | — |
| U3-1 批量操作 | U3 | ⏳ | — | — |
| U3-2 收藏 | U3 | ⏳ | — | — |
| U3-3 参数变更链 | U3 | ⏳ | — | — |
| U4-1 图片缓存上限 | U4 | ⏳ | — | — |
| U4-2 详情避免完整解码 | U4 | ⏳ | — | — |
| U4-3 Lightbox 过期图防护 | U4 | ⏳ | — | — |
| U4-4 模态背景虚化 | U4 | ⏳ | — | — |

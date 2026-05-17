# 上游功能补齐计划

> **策略（2026-05-17 更新）**：不做整体 `git merge main`，改为按需从上游手动搬运具体功能到本分支。
> 本文档保留早期计划、已完成清单和上游可参考代码位置，**未来要做的功能见 §十五（差异清单）+ §十六（实施建议）**。

---

## 一、背景

- **本分支**：`local-gpt-image`，fork 点 `f524ff0` (v0.2.7)，14 个 commit
- **上游**：`main` 已同步到 v0.3.5，共领先 75 个 commit
- **方向冲突**：本分支走「后端化」（[server/](../server/) + MySQL + GitHub 登录 + 宝塔编排），上游走「前端化」（IndexedDB + 浏览器本地存储 + 多 provider）
- **冲突现状**：直接 `git merge main` 会产生 16 个文件冲突，其中 15 个 content 冲突 + 1 个 modify/delete，几乎所有核心文件（store.ts、types.ts、api.ts、SettingsModal/Header/InputBar/TaskGrid/TaskCard/DetailModal）双方都大改

## 二、策略

**不合并上游，按需手动搬运具体功能**。

**早期方案（已废弃）**：曾计划"先按本分支架构重新实现上游主要功能，再 `git merge main` 解冲突"。实际尝试合并后发现：

- staged 阶段引入 40+ 个上游纯新增文件，其中绝大多数（apiProfiles.ts / falAiImageApi.ts / paramDisplay.tsx / promptImageMentions.ts 等）跟本分支架构方向不符，需要合并后再手动 `git rm`，工作量大
- 14 个 content 冲突文件即使绝大多数 take ours，仍然要逐文件审查，且会丢失上游一些 UI 细节改进
- 合并 commit 会引入跟本分支无关的提交历史
- 后续上游再有更新，又要重复这套流程

**当前方案**：

1. **不再执行 `git merge main`**——已经实现的上游功能保留，未来不依赖上游分支
2. **按需手动搬运**：要做哪个上游功能，就用 `git show main:<file>` 看上游实现作为参考，按本分支架构重新实现，独立 commit
3. **要做的功能清单见 §十五（差异详情）+ §十六（实施优先级和工作量估算）**
4. **不再追踪 main 进度**：上游后续如有新版本，再由人决定是否纳入

**优势**：

- 不再被上游 IndexedDB 那套架构限制，按后端最佳方式落地
- 每个功能小步独立提交，可逐项验证、可回滚
- 不引入跟本分支无关的代码和历史
- 工作量可控（按 §十六 的批次推进，3-4 个工日可对齐 95% 上游功能）

## 三、上游可参考的代码位置

按需手动实现某个功能时，从 `main` 分支查阅上游实现：

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
| **Phase U1** | 纯新增前端功能：蒙版编辑器、fal.ai provider、iOS 修复、通用组件 | 低 | 无 | ✅ |
| **Phase U2** | 前端大改造但无后端依赖：@mention、API Profiles、Responses API 保护 | 中 | 无 | 🟡 (U2-1 未做) |
| **Phase U3** | 后端配合实现：批量操作、收藏、参数追踪 | 中 | 需扩 schema 和 API | 🟡 (U3-3 可选未做) |
| **Phase U4** | 性能与体验细节：缩略图相关已做（见 P2-2），剩余的图片缓存控制、详情解码优化 | 低 | 无 | ✅ |

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

### U1-2 fal.ai Provider 支持 ❌ 已撤回

- **决策（2026-05-17）**：本部署面向 OpenAI 兼容服务（含官方/Azure/第三方代理/本地网关），fal.ai 是独立平台、需用户单独注册付费 key、跟 OpenAI 协议完全不同。留着只会增加 UI 复杂度和维护成本——已移除。
- **上游**：`bc496dc`，[src/lib/falAiImageApi.ts](../src/lib/falAiImageApi.ts) 227 行
- **本分支状态**：仅启用 OpenAI 兼容路径，前端 provider 选择只剩 OpenAI 一项；非 OpenAI provider 后端直接 400 报错
- **未来如要查上游 fal 实现**：见 `git show main:src/lib/falAiImageApi.ts`
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

## 十、（已废弃）实现完成后的合并策略

> ⚠️ **此章节为早期方案遗留，决策已改为不合并**。本节保留作为历史记录和决策追溯依据。
>
> 当前策略见 §二、未来要做的功能见 §十五 / §十六。
>
> 早期曾尝试执行 `git merge main`，发现需要清理 40+ 个不适用的上游新增文件、解 14 处 content 冲突，且会引入跟本分支无关的提交历史，遂改为按需手动搬运。详见 §二"早期方案（已废弃）"。

---

## 十一、新对话恢复指引

> **如果你（Claude 或我自己）在新对话里继续这件事，从这里开始**

1. **读这份文档**，重点看 §二 当前策略、§十二 已完成清单、§十五 详细差异、§十六 实施建议
2. **当前策略**：**不再 `git merge main`**，按需手动搬运具体功能（详见 §二）
3. **查看进度**：`git log local-gpt-image --oneline | head -30`，看 `feat(upstream):` 前缀的 commit
4. **要做某个上游功能**：
   - 从 §十六 的优先级清单里选一项（A-x / B-x / C-x 编号）
   - 用 `git show main:<file>` 看上游实现作为参考
   - 按本分支架构（backend-first）改造后实现，独立 commit
   - commit message 用 `feat(upstream): A-x <功能名>` 或 `fix(upstream): A-x <修复>` 前缀
   - 完成后在 §十六 对应项加 ✅ 标记完成时间和 commit hash
   - 跑 `npx tsc --noEmit` 确保类型通过
5. **不要建议或执行 `git merge main`**——这是已经评估过并废弃的方案，理由见 §二

---

## 十二、进度跟踪

> 完成一项后，把对应项的"状态"从 ⏳ 改为 ✅，并在下面表格里更新

| 项 | 阶段 | 状态 | 完成时间 | 关键 commit |
|---|---|---|---|---|
| U1-1 蒙版编辑器 | U1 | ✅ | 2026-05-17 | `feat(upstream): U1-1 蒙版编辑器` |
| U1-2 fal.ai provider | U1 | ❌ 撤回 | 2026-05-17 | 经评估不适合本部署场景，已移除 |
| U1-3 通用组件库 | U1 | ✅ | 2026-05-17 | `feat(upstream): U1-3 cherry-pick 通用组件库` |
| U1-4 iOS / PWA 修复 | U1 | ✅ | 2026-05-17 | `feat(upstream): U1-4 iOS / PWA 修复` |
| U1-5 参考图拖拽排序 | U1 | ✅ | 2026-05-17 | `feat(upstream): U1-5 支持拖拽排序参考图` |
| U2-1 @mention 图片引用 | U2 | ⏳ | — | 工作量过大（InputBar 重写为 contentEditable），留待后续 |
| U2-2 API Profiles 多 provider | U2 | ✅ | 2026-05-17 | `feat(upstream): U1-2+U2-2 后端基础` / `feat(upstream): U1-2+U2-2 前端` |
| U2-3 Responses API 防护 | U2 | ✅ | 2026-05-17 | `feat(upstream): U2-3 Responses API prompt 加防护前缀` |
| U3-1 批量操作 | U3 | ✅ | 2026-05-17 | `feat(upstream): U3-1 任务批量删除` |
| U3-2 收藏 | U3 | ✅ | 2026-05-17 | `feat(upstream): U3-2 收藏功能` |
| U3-3 参数变更链 | U3 | ⏳ | — | 可选项，未做（计划本身标为可选） |
| U4-1 图片缓存上限 | U4 | ✅ | 2026-05-17 | `feat(upstream): U4-1 imageCache 加 LRU 上限 100 张` |
| U4-2 详情避免完整解码 | U4 | ✅ | 2026-05-17 | `feat(upstream): U4-2 DetailModal 预览优先用缩略图` |
| U4-3 Lightbox 过期图防护 | U4 | ✅ | 2026-05-17 | 本分支 Lightbox 同步赋值无异步竞态，自然不适用（已确认） |
| U4-4 模态背景虚化 | U4 | ✅ | 2026-05-17 | 本分支已有 backdrop-blur，无需补 |

---

## 十三、当前遗留与下一步

**已完成（12/15，1 项主动撤回）：** U1-1/U1-3/U1-4/U1-5、U2-2/U2-3、U3-1/U3-2、U4-1/U4-2/U4-3/U4-4

**主动撤回（1/15）：** U1-2 fal.ai provider（本部署不需要）

**未完成（2/15）：**
- **U2-1 @mention 图片引用** — 需要把 InputBar 从 textarea 改为 contentEditable，移植 [src/lib/promptImageMentions.ts](../src/lib/promptImageMentions.ts) 解析逻辑。还需要决策"@图N" 在本分支语义（@当前 inputImages 还是 @历史图片库），并新增"从图片库选图"UI 入口。预估 2-3 天。
- **U3-3 参数变更链（可选）** — DB 加 `parent_task_id`，前端 DetailModal 加变更链面板。功能价值需用户确认后再启动。预估 2 天。

**下一步建议：**
- 不再做 `git merge main`，按需手动搬运具体上游功能（详见 §二、§十六）
- **U2-1 / U3-3**：本节列的两项历史"未完成"，已重新归入 §十五 的差异清单（U2-1 = A-3，U3-3 = 未纳入）
- 后续工作直接看 §十六 第一/二/三批的优先级排期

**注意事项（已知简化）：**
- **fal.ai 已撤回**：本部署仅启用 OpenAI 兼容路径，前端 SettingsModal provider 选项只剩 OpenAI 一项；后端 `callUpstreamImageApi` 对非 OpenAI provider 直接 400 报错
- 自定义 HTTP provider 的 schema、CRUD API、前端选择 UI 已就位，但后端实际请求构造逻辑未实现，选择后会被 400 拦截。如果未来要启用，需要补 `callCustomHttpProvider` 函数和模板化的 body / files / result path 解析
- API Profile 增加了 `user_api_profiles` 和 `user_custom_providers` 两张表，旧 `user_settings` 表保留作为兼容回退。第一次访问 `/api/profiles` 时自动迁移一条默认 profile

---

## 十四、Review 回归修复（2026-05-17 增补）

完成后做了一轮系统 review，发现 8 个问题并全部修复：

| 编号 | 优先级 | 问题 | 修复 |
|---|---|---|---|
| R-1 | P0 | [server/db.js](../server/db.js) `initDatabase` 没同步 `is_favorite`、`api_profile_*` 字段，也未创建 `user_api_profiles` / `user_custom_providers` 两张新表。**全新部署会直接报"Unknown column"/"Table doesn't exist"**，无法用 U2-2 / U3-2 功能 | 补全 [server/db.js](../server/db.js) 的 `IF NOT EXISTS` + 自动 `ALTER TABLE` 自检逻辑，全新部署和已有部署都能自动迁移 |
| R-2 | P0 | [src/components/MaskEditorModal.tsx](../src/components/MaskEditorModal.tsx) `handleSave` 用 `storeImage`（本地 IndexedDB hash）作为 mask 目标图 ID，但后端按 server-side `SHA-256(file bytes)` 查 image。两个 ID 永远不一致，**提交带 mask 的任务必报 400** | 改走 `backendApi.saveImage(sourceDataUrl, 'upload')` 拿后端真实 ID；如果 `sourceDataUrl === 原 dataUrl`（既未 resize 也未转 PNG）则复用原 imageId 避免重复上传 |
| R-3 | P1 | U4-2 把 [DetailModal](../src/components/DetailModal.tsx) 主图直接换成 256px 缩略图，**大屏下显示模糊** | 改为双阶段加载：初始用缩略图占位 → 后台 `new Image()` 预加载原图 → `onload` 时切换 `displaySrc`，配合 `highResLoaded: Set<string>` 记录已加载，重复进入同一图无闪烁 |
| R-4 | P1 | [SettingsModal](../src/components/SettingsModal.tsx) 删除了"使用默认配置"开关，但 UI 没有提示"留空 = 用服务端 `DEFAULT_API_URL` / `DEFAULT_API_KEY`"，宝塔多用户部署体验回归 | API URL / API Key 输入框下方加上"留空时使用服务器配置的默认 …"提示 |
| R-5 | P2 | U1-5 用 HTML5 `draggable` API，**iOS Safari / 移动 Chrome 不支持**，移动端拖拽完全失效 | 改用 Pointer Events（`onPointerDown/Move/Up/Cancel`）+ `setPointerCapture`，桌面端和触屏统一。阈值 6px 区分点击和拖拽，配合 `thumbJustDraggedRef` 防止拖拽结束误触 Lightbox |
| R-6 | P2 | `selectAllTasks` 实际只选当前已加载的页（默认 20 条），命名误导 | 重命名为 `selectLoadedTasks`，UI 按钮文案改为"全选已加载"，加 `title` 提示用户继续滚动可加载更多 |
| R-7 | P2 | `batchDeleteSelected` 在前端再跑一遍"清理孤立图片 → IndexedDB `deleteImage`"，但后端 batch-delete 已经处理了——这是 IndexedDB 时代的死代码 | 移除前端 IndexedDB 清理逻辑，仅清理 `imageCache` 内存条目避免占用内存 |
| R-8 | P2 | 后端 `callUpstreamImageApi` 遇到未实现的自定义 provider 时 `console.warn + 回退 OpenAI`——静默 fallback 会产生不可预期结果 | 改为抛 400 错误：`Provider "X" 尚未实现后端调用逻辑`；前端 SettingsModal 提示文案从黄色"会回退"改为红色"会失败" |
| R-9 | P1 | U4-2 双阶段加载副作用：右键复制/下载图片时拿到 `<img>` 的 `src`，这时可能还是缩略图（256px webp），用户复制/下载到的不是原图 | [ImageContextMenu](../src/components/ImageContextMenu.tsx) 优先读 `dataset.originalSrc`；[TaskCard](../src/components/TaskCard.tsx) 主图、[DetailModal](../src/components/DetailModal.tsx) 主图 + 输入图缩略图都加上 `data-original-src` |

所有改动 `npx tsc --noEmit` 通过。涉及文件：[server/db.js](../server/db.js)、[server/server.js](../server/server.js)、[src/store.ts](../src/store.ts)、[src/components/MaskEditorModal.tsx](../src/components/MaskEditorModal.tsx)、[src/components/DetailModal.tsx](../src/components/DetailModal.tsx)、[src/components/SettingsModal.tsx](../src/components/SettingsModal.tsx)、[src/components/InputBar.tsx](../src/components/InputBar.tsx)、[src/components/TaskGrid.tsx](../src/components/TaskGrid.tsx)。

---

## 十五、上游 vs 本分支 - 详细功能差异（2026-05-17 调研）

> 用户决定**不做整体合并**，改为按需手动添加功能。本节是逐项落地清单。
> 已实现 / 主动撤回 / 已知不做的项已剔除，下面列的都是**还能从上游搬过来的具体功能**。
> 工作量估算的"d"指人日（按 6 小时算）。

### A. 用户能看到的功能差异

| ID | 功能 | 上游做了什么（含定位） | 本分支现状 | 建议 | 工作量 |
|---|---|---|---|---|---|
| **A-1** | Header 三件套：PWA 安装 / 操作指南入口 / 版本更新 NEW 徽章 | [Header.tsx:42-91](../src/components/Header.tsx#L42) 监听 `beforeinstallprompt` 弹安装按钮（iOS/微信浏览器降级为文字提示）；问号按钮打开 `HelpModal`；`useVersionCheck()` 拉 GitHub Releases，新版本显示红色 NEW 徽章 | 完全没有。[HelpModal.tsx](../src/components/HelpModal.tsx) 已 cherry-pick 但**无任何入口**，是死代码 | ✅ **做** | 0.5d |
| **A-2** | DetailModal 错误态三件套：复制错误 / 查看原始响应 / 复制图片 URL；完成态加"重试" | DetailModal 错误区增加 3 圆形按钮：① `copyTextToClipboard` 复制完整错误文本 ② `task.rawResponsePayload` 弹模态展示原始响应 ③ `task.rawImageUrls` 复制原始外链。完成态加"重试"按钮（受 `settings.alwaysShowRetryButton` 控制） | 出错只显示文本 + 删除按钮，没有重试 | ✅ **做** | 0.3d 前端 + 0.1d 后端加 `raw_response_payload`/`raw_image_urls` 两列 |
| **A-3** | InputBar @图N 提示词图片引用（@mention） | [promptImageMentions.ts](../src/lib/promptImageMentions.ts) 完整解析；InputBar 从 textarea 改为 `contentEditable`，输入 `@` 弹下拉，发送时 `@图1` → `[image 1]`；参考图重排/删除自动 remap | 纯 textarea | ⏸ **暂缓**（U2-1，工作量大、本分支拖拽逻辑需重写） | 1-2d |
| **A-4** | TaskCard 卡片显示"API 配置名 + 模型 + 局部重绘"标签 + 请求 vs 实际值徽章 | [TaskCard.tsx:403-462](../src/components/TaskCard.tsx#L403) 用 [paramDisplay.tsx](../src/lib/paramDisplay.tsx) 对比 `task.params` vs `task.actualParams`，不一致显示 `<ActualValueBadge>`（黄色高亮 + tooltip "API 实际响应值"） | 卡片只显示请求时的参数，看不出 API 是否改写了 size/quality 等 | ✅ **做**（捕获"请求 4K 但实际 2K"这种隐蔽 bug） | 0.5d（含 B-2 表结构） |
| **A-5** | DetailModal 显示 API 改写后的提示词（revised_prompt） | 检测 `task.revisedPromptByImage[currentImageId]`，与原 prompt 不同则展示提示 | 没有 | ✅ **做**（与 A-4 同批做更顺手） | 0.2d |
| **A-6** | SettingsModal 四 tab 侧栏布局 + 五个体验开关 | 改为左侧栏 + 右侧 tab。"习惯配置" tab 增加：① Enter vs Ctrl+Enter 提交 ② 提交后清空输入框 ③ 重启后加载上次输入 ④ 复用配置时临时复用任务 Profile ⑤ 始终显示重试按钮 | 单页布局，没有这五个开关 | ✅ **做**（高频用户痛点） | 0.5d |
| **A-7** | SettingsModal "自定义 HTTP Provider 模板"管理面板 | 完整 CRUD + JSON Manifest 编辑器 + 内置示例 + LLM 提示词模板（75 行生成 manifest）+ "复制导入 URL"分享功能 | `customProviders` schema 已就位但无管理 UI | ⏸ **简化版**：只做"复制导入 URL"分享 + JSON 导入按钮（2h）；完整面板（2-3d）暂缓 | 0.3d 简化版 |
| **A-8** | SizePickerModal 限制提示 + 超限 clamp 徽章 | 显示 `SIZE_LIMIT_TEXT`（宽高 16 倍数 / 最大边 3840 / 比例 ≤3:1 / 总像素 655360-8294400），超限时显示 `isClamped` 徽章和 hint tooltip | 没有限制提示 | ✅ **做**（用户经常踩坑） | 0.1d |
| **A-9** | SearchBar 收藏按钮位置调整 | 收藏按钮挪到状态选择器左侧，整体更紧凑 | 收藏按钮在右侧 | ❌ **不做**（纯样式偏好） | — |
| **A-10** | Lightbox 显示蒙版叠层预览 | 检测到该图被用作蒙版目标时，叠加半透明红色 mask 区域可视化 | Lightbox 不显示蒙版预览 | ✅ **做**（U1-1 的天然补充） | 0.2d |
| **A-11** | ImageContextMenu 增加"编辑"按钮（图片→参考图） | "复制 / 下载"之外加"编辑"，点击 `addImageFromUrl()` 把当前图加入 inputImages，关闭所有模态返回主界面；iframe 内禁用菜单 | 只有复制/下载 | ✅ **做**（"基于已有图二次编辑"最便捷入口） | 0.1d |
| **A-12** | Toast 栈（同时显示多条） | `toasts: ToastItem[]` 数组，每条独立 fade-in/out | 单条 toast，新的会覆盖旧的 | ✅ **做**（批量操作时单 toast 会被覆盖） | 0.1d |
| **A-13** | SupportPromptModal "感谢使用"弹窗（50 张引导赞助原作者） | 累计成功 50 张图后自动弹一次引导赞助/反馈 | 没有 | ❌ **不做**（私域部署不适合引导赞助原作者） | — |
| **A-14** | ConfirmDialog 增强：icon / 强制冷静期 / 富文本 / tone 色彩 | 支持 `icon: 'info'\|'copy'`、`minConfirmDelayMs` 强制延迟点确认、`tone: 'danger'\|'warning'`、message 中 `` `xxx` `` 渲染为内联代码、`「xxx」`加粗 | 基础版可用，无以上能力 | ⚠️ **按需做**（除非有"高危操作"场景，否则可不动） | 0.2d |

### B. 后台 / 数据层差异

| ID | 功能 | 上游做了什么 | 本分支现状 | 建议 | 工作量 |
|---|---|---|---|---|---|
| **B-1** | Query String 完整参数：`?settings=` `?apiMode=` `?model=` 一键导入 | [urlSettings.ts](../src/lib/urlSettings.ts) 122 行 + 测试 243 行。`?settings=<JSON>` 导入完整 providers + profiles；与现有 profile 去重；临时 profile 自动激活 | 仅识别 `?apiUrl=&apiKey=` | ✅ **做**（如果 A-7 简化版做了，B-1 是配套） | 0.2d |
| **B-2** | tasks 表新增 `actual_params` / `revised_prompt_by_image` / `raw_image_urls` / `raw_response_payload` | 配合 A-4 / A-5 / A-2 | 没有 | ✅ **做**（A-4/A-5 的前置依赖） | 已含在 A-4/A-5 工作量里 |
| **B-3** | Codex CLI 兼容模式提示 + "不再提示"持久化 | 用 OpenAI 但响应缺关键字段时提示可能是 codex CLI，可"以后不再提示" | 没有 | ❌ **不做**（受众极小） | — |
| **B-4** | 临时复用任务的 API Profile（`reuseTaskApiProfileTemporarily`） | 复用历史任务时根据 `settings.reuseTaskApiProfileTemporarily` 临时切到该任务当时的 profile；找不到时警告 | 没有 | ✅ **做**（多 profile 用户的高价值场景） | 0.2d |
| **B-5** | fal.ai provider | 已主动撤回 | — | ❌ — | — |
| **B-6** | Service Worker 启用 | 生产环境注册 sw.js 离线缓存 | 主动 `unregister()` | ❌ **不做**（后端鉴权模式不适合 SW） | — |
| **B-7** | Docker `API_URL` → `DEFAULT_API_URL` / `API_PROXY_URL` 拆分迁移提示 | useDockerApiUrlMigrationNotice hook 引导升级 | 本分支宝塔部署不适用 | ❌ **不做** | — |
| **B-8** | `imageApiShared.ts` 输入大小校验 helper（512MB 总量、50MB 蒙版） | 抽离 isHttpUrl/isDataUrl/normalizeBase64Image | 本分支校验在后端做 | ❌ **不做**（重复劳动） | — |

### C. 开发体验 / 工程化差异

| ID | 项 | 上游做了什么 | 建议 | 工作量 |
|---|---|---|---|---|
| **C-1** | Vitest 单元测试 | `api.test.ts` `apiProfiles.test.ts` `mask.test.ts` `maskPreprocess.test.ts` `paramCompatibility.test.ts` `promptImageMentions.test.ts` `store.test.ts` `urlSettings.test.ts` `viewportTransform.test.ts` `devProxy.test.ts` 等共 ~2000 行 | ⚠️ **挑做**：至少把 `mask.test.ts` + `viewportTransform.test.ts` 拿过来（蒙版逻辑容易出 bug） | 0.2d 关键测试 |
| **C-2** | `scripts/mock-image-api.mjs` 本地 mock 服务器 | 280 行，便于开发不消耗真实 API 额度 | ✅ **做**（开发体验提升） | 0.2d |
| **C-3** | `lib/runtimeEnv.ts` + Docker 二级注入 | 本分支自有架构不需要 | ❌ — | — |
| **C-4** | GitHub Actions Vercel tag deploy | 本分支宝塔部署 | ❌ — | — |

---

## 十六、补充优化建议（按推荐优先级）

基于上节调研，推荐分三批落地。**总工作量约 3-4 个工日**（不含 A-3 @mention 那个大改造）。

### 第一批：高 ROI 小改动（合计 ~1d）

> 用户体验直接提升，每项 2-3 小时之内

1. **A-1 Header PWA 安装 + HelpModal 入口**（0.5d）— ✅ 2026-05-17 完成 — `feat(upstream): A-1 Header 加 PWA 安装与 HelpModal 入口`。**未做 versionCheck**（用户决策：不引入 GitHub Releases 轮询，避免无外网/私域部署场景下的无效请求）。PWA 安装按钮监听 `beforeinstallprompt`，iOS/微信走文字提示。
2. **A-8 SizePickerModal 限制提示**（0.1d）— ✅ 2026-05-17 完成 — `feat(upstream): A-8 SIZE_LIMIT_TEXT + clamp 徽章`。
3. **A-10 Lightbox 蒙版叠层**（0.2d）— ✅ 2026-05-17 完成 — Lightbox 拿 store 里的 `maskDraft`，匹配到目标参考图时叠加 mask 图层 + "蒙版预览"角标。
4. **A-11 ImageContextMenu 加"编辑"按钮**（0.1d）— ✅ 2026-05-17 完成 — 新增 `addImageFromUrl()` action，右键菜单第三个按钮调用后关闭所有模态返回主界面。
5. **A-12 Toast 栈**（0.1d）— ✅ 已在本分支既有实现（store.toasts: ToastItem[]），无需额外改造。

### 第二批：需要后端配合的功能（合计 ~1.5d）

> 都要扩 tasks 表 schema，建议一波改完一次 migration

6. **B-2 + A-4 + A-5：参数追踪三件套**（合计 ~1d）— ✅ 2026-05-17 完成
   - 后端：`tasks` 表新增 `actual_params` / `revised_prompt_by_image` / `raw_response_payload` / `raw_image_urls`；db.js 自检；migration `005_add_param_tracking.sql`
   - 后端：`callOpenAIImageApi` 解析 Responses/Images 响应里的 `revised_prompt` / `size` / `quality` 等回写
   - 前端：新增 `src/lib/paramDisplay.ts`，TaskCard 用徽章对比（mismatched 时 amber 高亮），DetailModal 顶部显示 revised_prompt
7. **A-2 错误态三件套 + 重试**（0.3d）— ✅ 2026-05-17 完成
   - 后端：上游错误同步落 `raw_response_payload`；done/error 路径都写 profile 快照
   - 前端：DetailModal 错误态新增"复制错误 / 查看原始响应 / 复制图片 URL"3 按钮 + 完成态可选"重试"按钮（受 `alwaysShowRetryButton` 控制）；新增 `retryTask()` action
8. **B-4 临时复用任务 API Profile**（0.2d）— ✅ 2026-05-17 完成 — 后端 done/error 都写 `api_profile_id/name/provider/model` 快照；前端 `reuseConfig` 与 `retryTask` 在 `settings.reuseTaskApiProfileTemporarily` 开启时按 task.apiProfileId 临时切换 activeProfileId

### 第三批：体验完善（合计 ~1d）

9. **A-6 五个习惯开关**（0.5d）— ✅ 2026-05-17 完成 — 5 个开关存到 `AppSettings`（localStorage 持久化）：`enterSubmit / clearInputAfterSubmit / persistInputOnRestart / reuseTaskApiProfileTemporarily / alwaysShowRetryButton`。SettingsModal 新增"习惯配置"section + 复用的 `ToggleRow` 组件。**未做四 tab 布局**：本分支 SettingsModal 是单列滚动结构，按 section 切分已经足够，全面 tab 重构性价比低。
10. **A-7 简化版：Profile 分享 URL + JSON 导入**（0.3d）— ✅ 2026-05-17 完成 — 新增 `src/lib/urlSettings.ts`（base64-url 编解码 + `parseImportInput`）；SettingsModal Profile section 新增"分享链接 / 导入 Profile"按钮。分享链接**不含 API Key**。
11. **B-1 Query String `?settings=` 完整参数**（0.2d）— ✅ 2026-05-17 完成 — App.tsx 初始化时解析 `?settings=` 解码后调 `createProfile` 自动落库，并清掉 URL 参数。
12. **A-14 ConfirmDialog 增强**（按需）— ⏳ 未做（无高危操作场景）。

### 暂缓 / 不做的项

| ID | 决定 | 理由 |
|---|---|---|
| A-3 @mention | 暂缓 | InputBar 重写工作量大（1-2d），收益局限在多图编辑场景 |
| A-7 完整自定义 provider 面板 | 暂缓 | 2-3d 工作量，受众小，简化版已覆盖核心需求 |
| A-9 SearchBar 布局 | 不做 | 纯样式偏好 |
| A-13 赞助引导弹窗 | 不做 | 私域部署不引导赞助原作者 |
| B-3 Codex CLI 提示 | 不做 | 受众极小 |
| B-6/B-7/B-8 / C-3/C-4 | 不做 | 跟本分支后端化方向冲突或重复劳动 |
| C-1 完整测试套件 | 部分做 | 只拷 mask.test.ts + viewportTransform.test.ts（最易出 bug 的） |

### 工程化辅助（合计 ~0.4d）

13. **C-2 本地 mock API 脚本**（0.2d）— ✅ 2026-05-17 完成 — `scripts/mock-image-api.mjs`（纯 Node http，无新依赖）。覆盖 generations / edits / responses 三端点，随机改写 prompt + actual size 便于联调 A-4/A-5。
14. **C-1 关键测试拷贝**（0.2d）— ⏳ 暂缓 — 本分支未引入 vitest，引入 `vitest + jsdom` 需要新增 devDependencies 并改 ci 配置。先记录在此，留待后续启用测试栈时一次性补齐。

### 实施建议

- **如果时间紧**：只做第一批（5 项，1d）+ B-4（0.2d）。这些都是"小而美"的体验改进。
- **如果想达到上游核心功能对齐**：第一批 + 第二批（合计 2.5d），覆盖参数追踪、错误态友好、Profile 复用。
- **完整对齐**：再加第三批（合计 3.5-4d）。
- **不建议追求 100% 对齐**——A-3 @mention 不做、A-7 自定义 provider 完整面板不做，已经能覆盖 95% 的用户场景。

### 新对话恢复指引（更新）

未来要做这些项时，让新 Claude：

1. 读 [docs/upstream-merge-plan.md](upstream-merge-plan.md) §十五 + §十六
2. 选定 A-x 或 B-x 项目
3. 上游代码定位：`git show main:<file>` 看上游实现
4. 按 §十六 第二批/第三批的"实施方式"提示动手
5. 每完成一项 commit message 用 `feat(upstream): A-x <功能名>` 前缀
6. 在 §十六 对应项加 ✅ 标记完成时间和 commit hash

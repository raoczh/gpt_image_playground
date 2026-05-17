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
- **合并时**：上游的 falImageApi.ts / falAiImageApi.ts 等纯新增文件会被 take theirs 拉进来，合并后手动删除（见第十节）
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
1. 先做正式的 `git merge main`，按"实现完成后的合并策略"表逐文件解决冲突。已实现的功能直接 take ours，纯新增文件 take theirs。预计还会有 InputBar / store / SettingsModal 等核心文件的冲突需要手工合并取舍。
2. U2-1 / U3-3 等合并完成后再单独处理。

**注意事项（已知简化）：**
- **fal.ai 已撤回**：本部署仅启用 OpenAI 兼容路径，前端 SettingsModal provider 选项只剩 OpenAI 一项；后端 `callUpstreamImageApi` 对非 OpenAI provider 直接 400 报错
- 自定义 HTTP provider 的 schema、CRUD API、前端选择 UI 已就位，但后端实际请求构造逻辑未实现，选择后会被 400 拦截。如果未来要启用，需要补 `callCustomHttpProvider` 函数和模板化的 body / files / result path 解析
- API Profile 增加了 `user_api_profiles` 和 `user_custom_providers` 两张表，旧 `user_settings` 表保留作为兼容回退。第一次访问 `/api/profiles` 时自动迁移一条默认 profile

### 合并清单（执行 `git merge main` 时的指引）

按文件分类的取舍。

合并前/中的具体取舍——按文件分类。

### A. 直接 take ours（已实现等价功能或本分支主动选择）

- [src/store.ts](../src/store.ts) — backend-first 状态层
- [src/types.ts](../src/types.ts) — `BuiltInApiProvider = 'openai'`，撤回了 fal
- [src/lib/api.ts](../src/lib/api.ts) — 极简 fetch 转发到后端
- [src/lib/db.ts](../src/lib/db.ts) — 已退化为缓存 helper，主数据走后端
- [src/lib/devProxy.ts](../src/lib/devProxy.ts) — 本分支自定义版本
- [src/main.tsx](../src/main.tsx) — 主动 `unregister()` Service Worker，不启用 PWA
- [src/components/Header.tsx](../src/components/Header.tsx) — 含 GitHub 登录入口
- [src/components/SettingsModal.tsx](../src/components/SettingsModal.tsx) — Profile UI 已重构，且只支持 OpenAI provider
- [src/components/InputBar.tsx](../src/components/InputBar.tsx) — 已用 Pointer Events 实现拖拽（U2-1 @mention 未做，若以后做再单独迭代）
- [src/components/TaskGrid.tsx](../src/components/TaskGrid.tsx) — 含批量选择 + 收藏过滤
- [src/components/TaskCard.tsx](../src/components/TaskCard.tsx) — 含收藏 + `data-original-src` + 多选 checkbox
- [src/components/DetailModal.tsx](../src/components/DetailModal.tsx) — 双阶段加载 + `data-original-src`
- [src/components/Lightbox.tsx](../src/components/Lightbox.tsx) — 一直用原图，本分支 src 同步赋值无 race
- [src/components/Toast.tsx](../src/components/Toast.tsx) — 已队列化
- [src/components/ImageContextMenu.tsx](../src/components/ImageContextMenu.tsx) — 优先取 `dataset.originalSrc`
- [src/hooks/useVersionCheck.ts](../src/hooks/useVersionCheck.ts) — 本分支已删除（version 由后端管理）

### B. take theirs（纯新增、本分支没有）

- [src/components/MaskEditorModal.tsx](../src/components/MaskEditorModal.tsx) — 已 cherry-pick，文件名相同会自动合
- [src/components/Checkbox.tsx](../src/components/Checkbox.tsx) [HelpModal.tsx](../src/components/HelpModal.tsx) [SupportPromptModal.tsx](../src/components/SupportPromptModal.tsx) [ViewportTooltip.tsx](../src/components/ViewportTooltip.tsx) [icons.tsx](../src/components/icons.tsx) — 已 cherry-pick
- 上游测试文件 `*.test.ts` — 本分支没有测试基础设施，take theirs 不会冲突但可能需要 vitest 配置才能跑

### C. 合并后**手动删除**（take theirs 进来但本分支用不上）

| 文件 | 原因 |
|---|---|
| `src/lib/apiProfiles.ts` | 本分支 Profile 管理在 server.js + store.ts 里，前端不需要 |
| `src/lib/apiShared.ts` | 上游 API 抽象层，本分支只走 backendApi |
| `src/lib/openaiCompatibleImageApi.ts` `src/lib/oaiImageApi.ts` | 同上 |
| `src/lib/falAiImageApi.ts` `src/lib/falImageApi.ts` | fal.ai 已撤回 |
| `src/lib/promptImageMentions.ts` + `*.test.ts` | U2-1 未做，文件进来没人用 |
| `src/lib/urlSettings.ts` + `*.test.ts` | 上游 URL 查询参数处理，本分支配置在后端 |
| `src/lib/paramCompatibility.ts` `src/lib/paramDisplay.tsx` | 跟 a2edf71 / 10ad814 的 TaskCard 参数显示绑定，本分支没采用 |
| `src/hooks/useDockerApiUrlMigrationNotice.ts` `src/hooks/useDockerBreakingChangeNotice.ts` | 上游 Docker env 重构通知，本分支不适用 |
| `scripts/mock-image-api.mjs` `docs/mock-image-api.md` | 上游本地 mock 工具，本分支测试用真实后端 |
| `wrangler.jsonc` | Cloudflare Worker 部署，本分支走宝塔/Docker |
| `.github/workflows/vercel-tag-deploy.yml` | Vercel 部署，本分支走宝塔/Docker |
| `deploy/migrate-api-env.envsh` `src/hooks/useDocker*Notice.ts` | 上游 docker env 迁移辅助 |

### D. 手工合并（双方都有但需要逐块取舍）

| 文件 | 怎么合 |
|---|---|
| `package.json` `package-lock.json` | 取依赖并集，注意 `sharp`（本分支后端用）保留；上游可能新增的 `@fal-ai/client` 等可删；`npm install` 重新生成 lock |
| `.gitignore` | 取并集即可 |
| `README.md` | 本分支 [README_BAOTA.md](../README_BAOTA.md) / [README_DEPLOY.md](../README_DEPLOY.md) 已经覆盖部署说明；上游 README 改进可挑性能/功能描述部分合进来 |

### E. 检查 modify/delete 冲突

- `src/hooks/useVersionCheck.ts` —— 本分支删了，main 改了。冲突时选 `git rm` 保持删除

### 合并执行步骤

```bash
git checkout local-gpt-image
git fetch origin main
git merge --no-commit main         # 不要立即提交，先解冲突
# 按上面 A/B/C/D 表分别处理冲突
git status                          # 看剩余 unmerged
# 对 A 类：git checkout --ours <file>
# 对 E 类：git rm src/hooks/useVersionCheck.ts
npm install                         # 重新生成 lock
npx tsc --noEmit                    # 类型校验
# 启动开发服 + 后端，跑通主流程后再 commit
git commit
# 合并完成后再处理 C 类：git rm 那些用不上的文件
```

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

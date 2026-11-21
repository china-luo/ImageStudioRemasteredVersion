# 技术整改进度清单

> 对应 `docs/technical-rectification-checklist.md`。记录截至 2026-08-25 的落地情况、改动说明与验证结果。

## 总览

| 阶段 | 范围 | 状态 |
|---|---|---|
| 第一阶段 | P0-1 ~ P0-5 | 已完成 |
| 第二阶段 | P1-1 ~ P1-3 | 已完成 |
| 第三阶段 | P2-1、P2-2 | 已完成配置、构建产物和本机实际安装验证 |
| 第四阶段 | P1-4 ~ P1-7 | 已完成（任务执行、提交、恢复与 Agent 工作流均已拆分） |
| 第五阶段 | P2-3 ~ P2-8 | 已完成（全量格式门禁、关键路径测试和超大组件拆分已落地） |

当前验证基线（2026-08-26）：

- `npm run test:coverage`：通过。52 个测试文件、378 个用例；Statements 63.15%、Functions 66.66%、Lines 67.05%。
- `npm run lint` / `npm run format:check`：通过。
- `npm run build`：通过。首屏 `index` JS 约 683 KB；导入导出拆成独立 chunk。
- `npm run test:e2e`：4 个 Playwright 用例通过（路由、SOP、VOC、批量下载）。

---

## 已完成

### P0-1 / P0-2 策划图片引用与 GC

启动清理和删除输入图时纳入 Planner 会话 `referenceImageIds` / `styleImages` 以及 SOP 草稿图。历史策划图不会被误删。

### P0-3 SOP / VOC 草稿持久化

草稿写入 Zustand `sopDraft` / `vocDraft`。切页后表单、上传图、评论和分析结果仍在。

### P0-4 VOC 有效评论强制校验

解析后至少 1 条正文不少于 3 个字符；AI 入口再次 `assertVocHasValidReviews()`。

### P0-5 英文提示词提取失败即关闭

`extractEnglishImagePrompt()` 匹配失败返回空字符串，复制按钮不可复制中文全文。

### P1-1 开发代理 SSRF 防护

Origin、方法、协议、内网/metadata、域名 allowlist、API 路径白名单。测试：`networkGuard.test.ts`。

### P1-2 Electron webSecurity 与受控请求

恢复默认 webSecurity；跨域走主进程 IPC；用户 API 域名注入白名单。

### P1-3 API Key 不再明文 persist

persist/导出剥离密钥。Web 用 sessionStorage，Electron 用 encrypted `secrets.bin`。

### P1-5 统一 LlmTransport

`src/lib/llmTransport.ts` 集中鉴权、URL、JSON/SSE。SOP / VOC / Planner 共用。

### P1-6 页面 URL 与刷新恢复

hash 路由：`#/` `#/sop` `#/voc` `#/editor` `#/tagger`。刷新和前进后退保持页面。

### P1-7 Agent 遗留隔离

`setAppMode('agent')` 回落到 gallery；Agent 页面不挂载；`agentApi` 懒加载。

### P2-1 Vitest 排除 `.worktrees`

`test.include = src/**/*.test.ts`。

### P2-2 关键路径测试 + Playwright（基本完成）

| 路径 | 测试 |
|---|---|
| 页面切换 | `appRoute.test.ts`、`e2e/app-routes.spec.ts` |
| 批量下载 | `downloadImages.test.ts`、`e2e/batch-download.spec.ts` |
| 代理白名单 / Electron IPC | `networkGuard.test.ts`、`electronNetworkGuard.test.ts`、`electron/ipcHandlers.test.cjs` |
| SOP / VOC | `workspaceDrafts.test.ts`、`vocAmazonReviewsApi.test.ts`、`e2e/workspaces.spec.ts` |

命令：`npm run test:e2e`（需已 `npm run build` 且安装 Chromium）。

`src/lib/devProxyIntegration.test.ts` 直接注册 Vite middleware，验证动态私网 metadata 地址在转发前返回 403。NSIS 配置、构建产物和快捷方式声明由 `npm run test:installer-config` 自动断言；本机已完成 `-InstalledRoot` 实际安装目录、桌面快捷方式和开始菜单快捷方式验证。

### P2-4 页面动态导入

SOP / VOC / 编辑 / 设置 / Planner 懒加载。首屏 JS 从约 1.5 MB 降到 697 KB。

### P2-5 CI

`.github/workflows/ci.yml`：`typecheck` → `lint` → `test` → `build` → Playwright。

### P2-6 唯一安装包链路

官方命令 `npm run build:installer`。说明：`docs/packaging.md`。

### P2-7 / P2-8 部署能力对齐

Cloudflare / Vercel / GitHub Pages 均为静态托管，不提供 API 代理。说明：`docs/deployment.md`。

### P1-4 Store 拆分（主提交链路已完成）

已从 `store.ts` 抽出：

- `src/lib/imageCache.ts`：图片缓存
- `src/lib/agentConversationGraph.ts`：Agent 分支路径
- `src/lib/agentConversationNormalize.ts`：会话规范化/合并
- `src/lib/backupCodec.ts`：data URL ↔ 字节
- `src/lib/dataBackup.ts`：导入、导出、清空（动态加载，不进入首屏）
- `src/lib/taskBootstrap.ts`：OpenAI 任务启动中断标记
- `src/lib/taskImageReferences.ts`：任务、草稿、Agent、Planner 图片引用收集与 GC 候选筛选
- `src/lib/taskRecoveryManager.ts`：fal/custom 异步任务轮询、结果持久化与错误收敛；通过注入 Store/持久化适配器，可脱离 React/DOM 单测
- `src/lib/storeBootstrap.ts`：启动任务迁移、中断 OpenAI 任务标记和孤立图片清理；可脱离 Store 单测
- `src/lib/imageReferenceCleanup.ts`：统一单图替换与任务删除后的引用保护、IndexedDB 删除和缓存回收
- `src/lib/taskDeletionManager.ts`：任务单条/批量删除、选择状态更新与 Agent 清洗适配器
- `src/lib/taskSubmissionService.ts`：编辑任务提交与失败任务重试；Store 仅保留配置确认和适配器
- `src/lib/legacyAgentActions.ts`：Agent 提交、停止响应与重新生成控制器；通过注入状态、图片存储、会话更新和执行器保持懒加载路径
- `src/lib/legacyAgentExecution.ts`：Agent Responses 执行循环、批量生图工具调用、任务落库与错误收敛；Store 仅保留依赖注入包装
- `src/lib/gallerySubmission.ts`：Gallery `submitTask` 配置选择、遮罩校验、风格参考图补齐和提交前置流程；Store 仅保留适配器包装
- `src/lib/taskExecutionService.ts`：Gallery `executeTask` 图片输入准备、API 调用、输出落库、错误收敛与恢复调度；Store 仅保留适配器包装
- `src/lib/listingPlannerApi.ts`：移除未使用的旧 SSE 响应解析链，保留当前 `llmTransport` JSON 解析路径，并纳入未使用变量门禁

任务删除已覆盖 Planner 会话引用保护，并有 `src/store.test.ts` 与服务层回归用例。Store 仍保留 Zustand 状态和少量兼容包装；主 Gallery `submitTask` 前置逻辑、Agent 提交/执行循环、任务持久化、编辑提交、重试、删除与 fal/custom 恢复已经迁出。`exportData` / `importData` / `clearData` 对调用方保持原 API。

### P2-3 超大组件拆分（已完成）

- Amazon Planner 业务函数：`plannerHelpers.ts`
- Amazon Planner 会话快照构造：`plannerHelpers.ts`（`createPlannerSessionSnapshot`，已补无 DOM 测试）
- Amazon Planner 顶部平台/模式控制：`components/planner/PlannerHeader.tsx`
- Amazon Planner 策划历史抽屉：`components/planner/PlannerHistoryDrawer.tsx`
- Planner 控制器：`components/planner/useAmazonPlannerController.ts`（会话读写、AI 策划请求、风格板请求）
- Planner 参考图缩略图：`components/planner/PlannerReferenceImageGrid.tsx`
- Planner Listing/A+ 输入区：`components/planner/PlannerInputPanel.tsx`
- InputBar `@图` 编辑：`contentEditableMentions.ts`
- InputBar 压缩率/生成数量边界处理：`components/input/inputBarParams.ts`（已补无 DOM 单测）
- 设置页复制导入 URL / 空白配置判断：`settingsCopyUrl.ts`
- 设置页 General / Data / About Tab：`components/settings/SettingsGeneralTab.tsx`、`SettingsDataTab.tsx`、`SettingsAboutTab.tsx`
- 设置页 API Tab：`components/settings/SettingsApiTab.tsx`（完整 API 配置展示层与强类型回调契约）
- InputBar 历史筛选/选择/下载 ID 聚合：`taskSelection.ts`
- InputBar 批量选择展示层：`components/input/SelectionToolbar.tsx`
- InputBar 参数面板：`components/input/InputParameterPanel.tsx`
- InputBar 下载流程：`components/input/useSelectionDownload.ts`
- InputBar 桌面/移动提交区：`components/input/InputSubmitControls.tsx`
- 设置页自定义服务商表单转换：`customProviderForm.ts`
- 设置页自定义服务商 LLM 提示词：`customProviderLlmPrompt.ts`

`SettingsModal.tsx` 从约 112 KB 降至约 66 KB，`InputBar.tsx` 从约 86 KB 降至约 71 KB；`AmazonPlanner.tsx` 当前约 116 KB。截图指定的 API Tab、InputBar 参数/下载/提交和 Planner 输入/控制器拆分已完成，风格板并发/重试、参考图压缩和 AI 策划异步编排已迁入 `useAmazonPlannerController.ts`，组件剩余为结果展示与 UI 状态落地。

### P2-5 Prettier、覆盖率与 ESLint 类型门禁（已完成）

- `npm run format` / `format:check`：覆盖 `src/**/*.{ts,tsx}`。
- `npm run test:coverage`：`src/lib` 实际 Lines 67.05%、Functions 66.66%、Statements 63.15%，门槛为 50/45/50。
- ESLint 已全局启用 `@typescript-eslint/no-unused-vars` 与 `@typescript-eslint/no-explicit-any`；严格扫描 `src` 无显式 `any`。
- CI：`typecheck` → `lint` → `format:check` → `test:coverage` → `build` → Playwright。

---

## 验收状态

原文清单与截图列出的整改项均已完成。`technical-rectification-remaining.md` 作为交接记录保留，当前无待处理条目；NSIS 安装验证已完成。

---

## 主要改动文件（本轮）

- `src/lib/imageCache.ts`、`src/lib/agentConversationGraph.ts`
- `src/components/planner/plannerHelpers.ts`、`src/lib/contentEditableMentions.ts`
- `eslint.config.js`、`.github/workflows/ci.yml`
- `playwright.config.ts`、`e2e/app-routes.spec.ts`
- `docs/technical-rectification-progress.md`

## 本轮验证记录（2026-08-26）

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过 |
| `npm run format:check` | 通过 |
| `npm run test:coverage` | 52 文件 / 378 用例通过；Lines 67.05%、Functions 66.66%、Statements 63.15% |
| `npm run test:electron` | 3/3 通过 |
| `npm run build` | 通过；`index-ccr0VPPg.js` 686.57 KB，`AmazonPlanner-XFfGRF7F.js` 110.75 KB，`SettingsModal-BGqihSe4.js` 79.61 KB，`three` 516.52 KB，`xlsx` 429.53 KB |
| `npm run test:installer-config` | 通过；`NSIS_CONFIG=PASS` |
| `validate-windows-installer.ps1 -InstalledRoot ...` | 通过；实际 exe、桌面快捷方式、开始菜单快捷方式均存在 |
| `npm run test:e2e -- --workers=1` | 4/4 通过（21.9 秒） |
| `git diff --check` | 通过（仅 CRLF 转换提示） |

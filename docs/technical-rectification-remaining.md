# 技术整改未完成项（工程师交接）

> 给后续工程师接手用。原文清单：`docs/technical-rectification-checklist.md`。已完成说明：`docs/technical-rectification-progress.md`。
>
> 工作目录：`amazon-image-studio/`。
> 验证基线：`npm run typecheck`、`npm run lint`、`npm run format:check`、`npm run test:coverage`、`npm run build`、`npm run test:e2e`。

P0、P1-1～P1-3、P1-5、P1-6、P1-7、P2-1、P2-4、P2-6、P2-7、P2-8 已按验收落地，**不要回退**。下面只列相对原文验收仍未打满的项。

P1-4、P2-3 与 P2-5 已完成。NSIS Windows-only 验证已完成。`executeTask` 与 Planner 异步工作流已进一步迁出。

---

## P1-4 Store 拆分（主 Gallery 提交前置逻辑已完成）

### 原文验收

Store 只保留状态与 action；数据库和网络逻辑可独立单测。

### 当前状态

`src/store.ts` 保留状态、适配器与兼容入口；`executeTask` 已迁至 `src/lib/taskExecutionService.ts` 并有独立单测。已拆出且可单测：

| 模块 | 职责 |
|---|---|
| `src/lib/imageCache.ts` | 图片/缩略图内存缓存 |
| `src/lib/agentConversationGraph.ts` | Agent 分支路径 |
| `src/lib/agentConversationNormalize.ts` | 会话规范化/合并 |
| `src/lib/backupCodec.ts` | data URL ↔ 字节 |
| `src/lib/dataBackup.ts` | 导入、导出、清空（动态 import，不进首屏） |
| `src/lib/taskBootstrap.ts` / `src/lib/storeBootstrap.ts` | 启动中断任务与恢复任务筛选 |
| `src/lib/taskRecovery.ts` | fal/custom 可恢复条件与实际参数映射 |
| `src/lib/taskImageReferences.ts` | 启动 GC 与删除任务的全局图片引用收集 |
| `src/lib/taskRecoveryManager.ts` | fal/custom 异步任务轮询与结果持久化 |
| `src/lib/storeBootstrap.ts` | 启动任务迁移、中断标记和孤立图片清理 |
| `src/lib/imageReferenceCleanup.ts` | 单图替换/任务删除后的引用保护和图片回收 |
| `src/lib/taskDeletionManager.ts` | 单条/批量任务删除与选择状态更新 |
| `src/lib/taskSubmissionService.ts` | 编辑任务提交与失败任务重试 |
| `src/lib/legacyAgentExecution.ts` | Agent Responses 执行循环、批量生图工具调用、任务落库和错误收敛 |
| `src/lib/gallerySubmission.ts` | Gallery 配置选择、遮罩校验、风格参考图补齐和提交前置流程 |
| `src/lib/taskExecutionService.ts` | 任务执行、图片存储、错误收敛与 fal/custom 恢复调度 |

`exportData` / `importData` / `clearData` 在 `store.ts` 里只是动态包装，调用方 API 不变。

### 仍在 `store.ts` 里、需要拆出

| 函数 | 建议去向 |
|---|---|
| `submitTask` | **已完成迁移**；Store 仅组装 Zustand/IndexedDB 适配器，前置逻辑位于 `src/lib/gallerySubmission.ts` |
| `submitTaskWithInput`、`retryTask` | 已迁至 `src/lib/taskSubmissionService.ts`，Store 保留兼容包装 |
| fal/custom 恢复轮询 | 已迁至 `src/lib/taskRecoveryManager.ts`，Store 仅注入状态、持久化和图片适配器 |
| `initStore` 中的 IndexedDB 启动 GC、中断任务标记 | 已迁至 `src/lib/storeBootstrap.ts`，Store 保留草稿回填 |
| `removeTask`、`removeMultipleTasks`、`deleteImageIfUnreferenced`、`deleteUnreferencedImageIds` | 已迁至 `src/lib/taskDeletionManager.ts` / `src/lib/imageReferenceCleanup.ts`，Store 保留兼容包装 |
| `submitAgentMessage` | **已迁移**到 `src/lib/legacyAgentActions.ts`，Store 仅保留注入式兼容包装 |
| `executeAgentRound` | **已完成迁移**到 `src/lib/legacyAgentExecution.ts`，Store 仅保留依赖注入包装 |
| `executeTask` | **已完成迁移**到 `src/lib/taskExecutionService.ts`，Store 仅保留依赖注入包装 |
| `regenerateAgentAssistantMessage`、`stopAgentResponse` | 已迁至 `src/lib/legacyAgentActions.ts`，Store 保留兼容包装 |

### 约束

- 组件继续从 `store.ts` 具名导出调用，先拆实现再改 import。
- 禁止循环依赖：`dataBackup.ts` 已静态引用 `useStore` 和 `deleteUnreferencedImageIds`，新模块用同样方式（运行期再碰 store）。
- `src/store.test.ts` 必须继续绿。现有 persist、submit、导入导出用例不要删。

### 完成标准（已满足）

- `store.ts` 只剩 Zustand state、setter、persist `partialize/merge` 和少量兼容包装。
- 任务提交、恢复、GC 有脱离 DOM 的单测。
- `npm run test:coverage` 与 `npm run build` 通过，首屏体积不明显回升。

---

## P2-3 超大组件拆分（已完成）

### 原文验收

单个组件职责明确，核心业务逻辑可脱离 DOM 单测。

### 当前体积（字节）

| 文件 | 约 |
|---|---|
| `src/components/AmazonPlanner.tsx` | 116 KB |
| `src/components/SettingsModal.tsx` | 66 KB |
| `src/components/InputBar.tsx` | 71 KB |

已抽出：

- `src/components/planner/plannerHelpers.ts` + `plannerHelpers.test.ts`
- `src/components/planner/PlannerHeader.tsx`
- `src/components/planner/PlannerHistoryDrawer.tsx`
- `src/components/planner/PlannerReferenceImageGrid.tsx`
- `src/components/planner/PlannerInputPanel.tsx`
- `src/lib/contentEditableMentions.ts`
- `src/components/settings/SettingsGeneralTab.tsx`
- `src/components/settings/SettingsAboutTab.tsx`
- `src/components/settings/SettingsDataTab.tsx`
- `src/components/settings/SettingsApiTab.tsx`
- `src/lib/settingsCopyUrl.ts` + `settingsCopyUrl.test.ts`
- `src/components/input/InputParameterPanel.tsx`
- `src/components/input/InputSubmitControls.tsx`
- `src/components/input/useSelectionDownload.ts`

### 实现说明

**AmazonPlanner.tsx（控制器、输入区、参考图与异步工作流已抽取）**

- 会话读写、AI 策划请求、风格板并发/重试、参考图压缩已迁至 `useAmazonPlannerController.ts`；组件仅保留结果落地和 UI 状态编排。
- 会话快照构造继续位于 `plannerHelpers.ts` 的 `createPlannerSessionSnapshot`。
- Header、历史抽屉、Listing/A+ 输入区和参考图缩略图列表 JSX 已拆到 `planner/PlannerHeader.tsx`、`planner/PlannerHistoryDrawer.tsx`、`planner/PlannerInputPanel.tsx`、`planner/PlannerReferenceImageGrid.tsx`；风格候选卡片和方案列表保留为纯结果展示 JSX，不包含请求或持久化逻辑。`MarketplaceControls` 已在 `planner/`。

**SettingsModal.tsx（截图指定项已完成）**

- API / Data / General / About 四个 Tab 均已独立；API Tab 的完整 JSX 已迁至 `SettingsApiTab.tsx`，父组件只注入草稿状态和事件回调。
- `CUSTOM_PROVIDER_LLM_PROMPT` 已迁到 `src/lib/customProviderLlmPrompt.ts`。

**InputBar.tsx（截图指定项已完成）**

- 参数面板已迁至 `InputParameterPanel.tsx`，下载流程已迁至 `useSelectionDownload.ts`，桌面/移动提交区域已迁至 `InputSubmitControls.tsx`。
- mention 逻辑、批量选择工具栏、参数边界函数继续分别位于 `contentEditableMentions.ts`、`SelectionToolbar.tsx`、`inputBarParams.ts`。

### 约束

- 不改用户可见交互，除非拆分时发现明显 bug。
- 新抽出的业务函数必须有单测（对齐 `plannerHelpers.test.ts`）。
- 这些页已是 `React.lazy`，继续拆不要把首屏又打回同步大包。

### 完成标准

- 上述三个文件明显变薄；请求/校验/会话逻辑不依赖 DOM。Planner 的剩余 JSX 仅为风格候选和方案结果展示，不包含请求或持久化逻辑。
- 构建无回归，Planner / 设置 / 输入栏主路径可用。

---

## P2-2 测试覆盖缺口（安装器已完成）

### 原文验收

至少覆盖页面切换、批量下载、代理白名单、SOP/VOC 主流程；并有 Playwright、Electron IPC、部署代理测试。

### 已有

| 路径 | 位置 |
|---|---|
| 页面 hash 切换 | `e2e/app-routes.spec.ts`（SOP / VOC / 编辑标题可见） |
| 批量下载 | `src/lib/downloadImages.test.ts`、`e2e/batch-download.spec.ts`（选两条任务并实际触发浏览器下载） |
| 代理白名单 | `src/lib/networkGuard.test.ts` |
| Electron 与 renderer 规则对齐 | `src/lib/electronNetworkGuard.test.ts`、`electron/ipcHandlers.test.cjs`（fetch、secrets-get/set） |
| SOP/VOC 守卫 | `src/lib/workspaceDrafts.test.ts`、`src/lib/vocAmazonReviewsApi.test.ts` |

### 安装器验证结果

`npm run test:installer-config` 已自动断言 NSIS 安装路径、开始菜单/桌面快捷方式和卸载声明；本机已使用 V1.6.0 安装包静默安装，并通过 `-InstalledRoot` 验证实际 exe、桌面快捷方式和开始菜单快捷方式。验证脚本已改为从 NSIS `APP_NAME` 读取快捷方式名称，避免 Windows PowerShell 脚本编码导致中文路径误判。

### 约束

- `npm run test:e2e` 依赖已 build 的 `dist/` + Chromium。
- Playwright 配置：`playwright.config.ts`，`baseURL` `http://127.0.0.1:4173`。
- 不要把 e2e 打进 `vitest` 的 `src/**/*.test.ts`。

### 完成标准

- Playwright 覆盖 SOP/VOC 主路径和页面切换（现有路由用例保留）。
- 代理 403 有集成级证明（插件或 dev server）。
- Electron fetch/secrets 至少有可在 CI 跑的主进程单测，或明确写进文档为何不做（安装器测试可标 Windows-only）。

---

## P2-5 工程门禁余量（已完成）

### 原文验收

PR 自动执行并阻断类型、测试、构建失败；有 lint、Prettier、最低覆盖率。

### 已有

CI：`.github/workflows/ci.yml`  
`typecheck` → `lint` → `format:check` → `test:coverage` → `build` → Playwright。

覆盖率（`vite.config.ts` `test.coverage`）：只扫 `src/lib/**/*.ts`，门槛 **lines 50 / functions 45 / statements 50**。当前 `src/lib` 行覆盖 **67.05%**。

`npm run format` / `npm run format:check` 已覆盖 `src/**/*.{ts,tsx}`，包括 components、hooks、Store 和 lib。

ESLint 已全局启用 `@typescript-eslint/no-unused-vars` 与 `@typescript-eslint/no-explicit-any` 并清理存量问题；严格扫描 `src` 已通过。

### 已完成

1. `@typescript-eslint/no-unused-vars` 与 `@typescript-eslint/no-explicit-any` 均已全局设为 `error`。
2. 覆盖率产物已在 `.gitignore` 的 `coverage/`。

### 完成标准

- `format:check` 覆盖主要 TS/TSX 源码。
- CI 覆盖率门槛能挡住明显回退。
- lint 不再是“几乎全关规则也能过”。

---

## 不要做 / 不要回退

- 不要重新打开 Electron `webSecurity: false`。
- 不要把 API Key 写回 Zustand persist 或导出 ZIP。
- 不要让 Vitest 再扫描 `.worktrees`。
- 不要恢复 `package.json` 里的 electron-builder `build` 块；安装包只走 `npm run build:installer`。
- 不要假设 Cloudflare / Vercel 有 API 代理；策略见 `docs/deployment.md`。
- 不要重新挂载 Agent 主入口；`setAppMode('agent')` 必须继续落到 `gallery`。

---

## 验收命令

在 `amazon-image-studio/`：

```text
npm run typecheck
npm run lint
npm run format:check
npm run test:coverage
npm run build
npm run test:e2e
```

Windows 安装包（本机）：

```text
npm run build:installer
```

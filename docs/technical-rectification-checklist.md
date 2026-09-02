# ImageStudioRemasteredVersion 技术整改清单

> 基于当前代码审查结果整理。优先级：`P0` 立即修复，`P1` 本迭代修复，`P2` 排期治理，`P3` 工程优化。

## P0：功能性问题

| ID | 文件/模块 | 问题与影响 | 修复方向 | 验收标准 |
|---|---|---|---|---|
| P0-1 | `src/store.ts`、`src/components/AmazonPlanner.tsx` | 启动清理 IndexedDB 图片时未统计 Amazon Planner 会话中的 `referenceImageIds/styleImages`，可能删除策划历史仍引用的图片。 | 启动清理和图片删除前统一纳入 Planner 会话引用。 | 创建策划会话、重启应用后，参考图和风格图仍可恢复。 |
| P0-2 | `src/store.ts` | `deleteImageIfUnreferenced()` 不检查 Planner 会话引用，删除当前输入图时可能误删历史策划图片。 | 建立统一图片引用检查，覆盖任务、草稿、Agent、Planner 会话。 | 删除当前输入图后，历史策划会话中的同一图片仍可读取。 |
| P0-3 | `src/App.tsx`、`src/components/SopReverseWorkspace.tsx`、`src/components/VocAmazonReviewsWorkspace.tsx` | SOP 和 VOC 表单/结果只保存在组件 `useState`；切换页面后组件卸载，数据全部丢失。 | 将草稿、上传图、评论数据和分析结果持久化到 Zustand 或 IndexedDB。 | 在 SOP/VOC 与其他页面之间切换后，原表单和结果完整保留。 |
| P0-4 | `src/lib/vocAmazonReviewsApi.ts` | CSV/XLSX 存在数据行但有效评论为 0 时仍返回成功，并生成“中性 100%”等无意义统计。 | 解析后强制要求至少 1 条有效评论；AI 分析入口再次校验。 | 空评论、短评论、全空正文文件均显示错误，不产生分析报告。 |
| P0-5 | `src/components/SopReverseWorkspace.tsx` | 未匹配到英文 Prompt 标题时，`extractEnglishPrompt()` 会返回整份中文分析报告。 | 提取失败时返回空值并要求用户确认，不得回退整份报告。 | 模型未输出指定章节时，“复制英文提示词”按钮不可复制中文全文。 |

## P1：安全问题

| ID | 文件/模块 | 问题与影响 | 修复方向 | 验收标准 |
|---|---|---|---|---|
| P1-1 | `vite.config.ts`、`src/lib/devProxy.ts` | 动态代理允许请求携带任意 HTTP/HTTPS target，仅校验来源地址为 localhost，存在本地代理被滥用于 SSRF 的风险。 | 增加 Origin 校验、目标域名 allowlist、内网地址拦截、请求方法和 API 路径白名单。 | 任意非允许 Origin、内网 IP、非白名单 API 路径均返回 403。 |
| P1-2 | `electron/main.cjs` | `webSecurity: false` 全局关闭 Electron 同源/CORS 防护，渲染层遭遇 XSS 或依赖污染时攻击面扩大。 | 恢复 Web 安全机制，改为主进程提供受控 API 请求能力。 | `webSecurity` 恢复默认值；用户配置的 API 仍能通过受控请求正常调用。 |
| P1-3 | `src/store.ts`、`src/lib/apiProfiles.ts` | OpenAI、fal.ai、Shulex 等 API Key 随 Zustand persist 明文保存到 localStorage。 | Web 版改为会话存储或服务端代理；Electron 使用系统凭据存储。 | 导出数据、localStorage 和普通前端状态中不再出现明文密钥。 |

## P1：架构缺陷

| ID | 文件/模块 | 问题与影响 | 修复方向 | 验收标准 |
|---|---|---|---|---|
| P1-4 | `src/store.ts` | Store 同时负责 Zustand 状态、IndexedDB、图片缓存、任务提交、Provider 恢复、导入导出和旧 Agent 逻辑，约 177 KB。 | 拆分为状态层、图片仓储、任务服务、恢复协调器和导入导出服务。 | Store 只保留状态与 action；数据库和网络逻辑可独立单测。 |
| P1-5 | `src/lib/*Api.ts` | `agentApi`、`listingPlannerApi`、`sopReverseApi`、`vocAmazonReviewsApi` 重复实现 Responses/Chat 请求、SSE 解析和错误处理。 | 抽取统一 `LlmTransport`，集中处理鉴权、代理、超时、JSON/SSE 解析。 | 新增一个文本模型 Provider 时无需复制四套请求代码。 |
| P1-6 | `src/App.tsx`、`src/components/Header.tsx` | 使用 `featureView + appMode` 两套状态模拟路由，没有 URL、深链和浏览器历史。 | 引入统一路由状态，至少支持页面 URL、刷新恢复和前进后退。 | 可通过 URL 直接打开图片编辑、SOP、VOC 页面，刷新后页面不回首页。 |
| P1-7 | `src/components/AgentWorkspace.tsx`、`src/components/HistoryModal.tsx`、`src/lib/agentApi.ts`、`src/store.ts` | Agent 页面当前未挂载，但 Agent 类型、数据迁移和 Store 逻辑仍深度存在，属于半废弃状态。 | 明确重新启用或迁移到独立 legacy 模块，移除无效主流程耦合。 | `AppMode.agent` 不再出现不可达状态；旧数据迁移仍有独立测试。 |

## P2：工程化与维护问题

| ID | 文件/模块 | 问题与影响 | 修复方向 | 验收标准 |
|---|---|---|---|---|
| P2-1 | `package.json`、Vitest 配置 | 默认测试会扫描 `.worktrees/support-prompt`，导致当前源码测试被重复执行，测试统计失真。 | 增加 Vitest `include/exclude`，排除 `.worktrees`、`dist`、构建产物。 | `npm test` 只执行当前 `src` 测试，文件数量与实际目录一致。 |
| P2-2 | `src/components/`、`electron/`、`deploy/` | 没有组件测试、浏览器 E2E、Electron IPC/安装器测试和部署代理测试。 | 增加关键工作流的 Playwright、Electron IPC 和代理集成测试。 | 至少覆盖页面切换、批量下载、代理白名单、SOP/VOC 主流程。 |
| P2-3 | `src/components/AmazonPlanner.tsx`、`SettingsModal.tsx`、`InputBar.tsx` | 多个核心组件超过 100 KB，UI、表单、请求和持久化耦合严重。 | 拆分业务 hooks、请求 controller 和展示组件。 | 单个组件职责明确，核心业务逻辑可脱离 DOM 单测。 |
| P2-4 | `vite.config.ts` | 主 JS 约 986 KB，Vite 报 chunk 过大警告。 | 对 SOP、VOC、图片编辑、设置等页面做动态导入和 vendor 拆包。 | 首屏主包明显下降，构建不再出现大 chunk 警告或有明确阈值说明。 |
| P2-5 | `package.json`、仓库根目录 | 没有 ESLint、Prettier、覆盖率门禁或 CI。 | 增加 `lint/typecheck/test/build` CI 流程和最低覆盖率要求。 | Pull Request 自动执行并阻断类型、测试和构建失败。 |
| P2-6 | `package.json`、`scripts/package-windows-installer.ps1`、`installer/windows-installer.nsi` | Electron-builder 配置与实际 PowerShell + NSIS 手工打包流程并存，存在两套事实来源。 | 选择 electron-builder 或自定义 NSIS 作为唯一打包链路。 | 版本号、产物名、图标、安装路径和快捷方式只由一套配置控制。 |

## P2：部署能力对齐

| ID | 文件/模块 | 问题与影响 | 修复方向 | 验收标准 |
|---|---|---|---|---|
| P2-7 | `wrangler.jsonc` | **推测：**如果产品预期 Cloudflare Workers 解决跨域，则当前配置只有静态 Assets，没有 Worker API 代理，实际能力与预期不匹配。 | 明确选择“静态托管 + 上游 CORS”或新增 Worker 代理，并同步文档。 | 部署文档、实际请求路径和线上能力一致。 |
| P2-8 | `vercel.json` | Vercel 配置只有关闭 Git 自动部署，没有 rewrite、function 或代理规则。 | 明确 Vercel 仅静态托管，或补充正式 API 代理/Serverless Function。 | Vercel 环境下的 API 请求策略有可验证的部署测试。 |

## 建议实施顺序

1. 第一阶段：P0-1 至 P0-5，先修复数据丢失和错误结果问题。
2. 第二阶段：P1-1 至 P1-3，处理代理、Electron 和密钥存储。
3. 第三阶段：P2-1、P2-2，先建立测试边界，再做架构拆分。
4. 第四阶段：P1-4 至 P1-7，治理 Store、Provider 和路由。
5. 第五阶段：P2-3 至 P2-8，处理包体积、CI、安装器和部署一致性。

## 当前验证基线

- 已完成说明：`docs/technical-rectification-progress.md`。
- 未完成交接（给工程师）：`docs/technical-rectification-remaining.md`。
- `npm run test:coverage`：通过；`src/lib` 行覆盖约 64%。
- `npm run lint` / `npm run format:check` / `npm run build`：通过。
- `npm run test:e2e`：可通过 URL 打开 SOP、VOC、图片编辑页。
- 首屏 JS 约 680 KB。

# 更新日志

<details open>
<summary><strong>2026-07-06 至 2026-07-12</strong> - V1.5.0 多站点策划与主线工作流清理</summary>

- 新增 Amazon 目标站点选择，支持 US、JP、DE、FR、IT、ES，并让 AI 策划和最终生图提示词按目标站点控制可见文案语言。
- 新增图片位提示词编辑能力，AI 策划结果可在提交前按单个图片位微调，并保留隐藏提交提示词链路。
- 保留 AI 策划返回的 3 个动态风格候选作为唯一风格板来源，风格板继续结合本次策划的系列一致性说明生成。
- 新增明确尺寸请求的技术分辨率提示，降低模型输出尺寸偏离目标规格的概率。
- 新增输出图二次编辑选择，可在整图编辑和遮罩编辑之间直接选择。
- Agent 工作区和 Agent API 标记为遗留实验功能，主线输入栏不再承载 Agent 对话生成路径，相关代码改为兼容旧数据和显式遗留调用。
- 移除内置风格库、风格来源切换、预设风格选择和跨境固定风格模板，避免与 AI 动态策划风格混用。
- 移除主线输入栏中的 Agent 输出图引用、Agent 自动数量提示和停止 Agent 生成按钮，主线生成入口回归普通图片任务。
</details>

按自然周（周一至周日）整理，最新一周在最上方。每个周块可展开查看本周推送内容，提交号用于回溯具体改动。

<details open>
<summary><strong>2026-07-06 至 2026-07-12</strong> - V1.4.4 图片引用菜单体验修复</summary>

- 修复右侧输入栏参考图较多时，输入 `@图` 的图片引用候选菜单显示不全的问题。
- 图片引用候选菜单改为跟随当前输入光标显示，优先出现在 `@` 所在行下方，并在空间不足时自动限制高度和滚动。

</details>

<details>
<summary><strong>2026-06-29 至 2026-07-05</strong> - V1.4.3 VOC 导入与关于页优化</summary>

- VOC 文件导入支持 `.xlsx`，与 CSV 共用评论字段识别和本地/AI 分析流程。
- XLSX 解析按需加载，避免影响主界面首屏加载体积。
- 更新设置页“关于”说明，覆盖图片生成、Listing/A+ 策划、拆图反推、VOC 评论分析与 CSV/XLSX 导入。
- 关于页说明默认两行截断，支持悬浮查看完整内容，并可点击展开/收起。

</details>

<details>
<summary><strong>2026-06-29 至 2026-07-05</strong> - V1.4.2 VOC 修正与打赏入口</summary>

- VOC 评论分析改回 Shulex OpenAPI 实时任务路径，移除误导性的 DataHub X-Token 配置。
- VOC 板块保留独立 AI 配置和 OpenAPI Key 配置，不影响图片生成、拆图反推等既有功能。
- 顶部品牌区新增“打赏”按钮，点击后弹出微信 / 支付宝收款码，并优化桌面和移动端显示尺寸。
- 修复顶部品牌区 hover 时 JackLuo 签名不高亮的问题。
- 更新 GitHub 仓库 About 描述，覆盖 Amazon / TikTok Shop、商品图生成、A+ 策划、拆图反推、VOC 评论分析和 Windows 桌面端交付。

</details>

<details>
<summary><strong>2026-06-01 至 2026-06-07</strong> - OpenRouter、参考图压缩与策划体验</summary>

- OpenRouter 生图改走 Chat Completions 图片生成，修复普通 Images API 路径下的 404。
- OpenRouter 请求补齐 `image_config.aspect_ratio` 和 `image_config.image_size`，A+ 非 1:1 图片会映射到最接近的支持比例，减少实际输出回落到 1024 级别。
- 风格板生成新增“停止”按钮，并把停止信号接入 OpenRouter、OpenAI Images API、自定义接口和 fal 请求链路。
- 参考图请求前会压缩、控尺寸并校验负载，修复大参考图导致的 413。
- 普通生图限制为 Images API，OpenRouter 图片模型保留兼容入口，避免误用不支持生图的配置。
- README 增加在线体验说明，Windows 启动脚本会在启动前自动检查并安装依赖。
- 优化 Amazon Planner 引导、API 默认配置、图片编辑流程、A+ 策划规则、风格控制和合规提示。
- 提交：`dd63338`、`9cdecd0`、`dc5e54d`、`031069d`、`56be7df`、`bff26ca`、`7d13774`、`ed43bf5`、`73c70f4`。

</details>

<details>
<summary><strong>2026-05-25 至 2026-05-31</strong> - Amazon 策划工作流、知识规则与本地化</summary>

- 大幅更新 Amazon Planner 工作流，强化 Listing 图片和 A+ 图片的策划、选择和生成流程。
- 调整图片默认参数、历史记录字段、任务展示和分类继承逻辑。
- 更新 dev proxy、mock image API、接口兼容测试和参数兼容逻辑。
- 内置 Amazon 图片规范、附图策划逻辑和 A+ 尺寸知识文档。
- 策划接口会引用内置知识规则，提高 Listing / A+ 策划稳定性。
- 项目名称完成界面统一，同步页面标题、PWA manifest、启动脚本和界面文案。
- README 增加更完整的本地安装、启动和交付说明，历史记录搜索栏增加清理能力。
- 优化 Amazon Planner 工作流说明、Listing 图片策划模板、复制逻辑和相关测试。
- 提交：`a85312c`、`7c231bf`、`899532d`、`5cc09c4`、`0c8b9ec`、`d1de756`、`81a3fbd`、`3778620`。

</details>

<details>
<summary><strong>2026-05-18 至 2026-05-24</strong> - 项目初始化、部署配置与 A+ 模板</summary>

- 完成项目初始化，包含前端应用、图片生成、图片编辑、历史记录、设置页、PWA、代理和部署基础配置。
- 配置 GitHub Pages 工作流，并支持 main 分支推送后部署。
- 更新部署文档、安装路径说明和项目 GitHub 链接。
- 完善 README 使用说明。
- 优化 A+ Planner 模板、模块文案和任务历史展示。
- 默认关闭流式输出，降低默认配置复杂度。
- 提交：`ab63d9b`、`78ef9ea`、`3826fbc`、`ae118af`、`94c5cca`、`d929bdc`、`5860ddd`、`93f9585`、`f9198cb`。

</details>

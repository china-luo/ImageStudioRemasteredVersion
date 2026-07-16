# 跨境Image工作台

面向 Amazon 与 TikTok Shop 商品图二次创作的图片设计工作台，支持商品主图、卖点图、详情图、A+ 模块策划、竞品拆图反推与 VOC 评论分析。

维护者：[@china-luo](https://github.com/china-luo/ImageStudioRemasteredVersion)

## 如何使用

### 在线使用

打开在线版本：

[https://china-luo.github.io/ImageStudioRemasteredVersion/](https://china-luo.github.io/ImageStudioRemasteredVersion/)

### Windows 桌面版

下载最新安装包：

[ImageStudioRemasteredVersion-Setup-V1.5.4-2026-07-16-x64.exe](https://github.com/china-luo/ImageStudioRemasteredVersion/releases/download/v1.5.4/ImageStudioRemasteredVersion-Setup-V1.5.4-2026-07-16-x64.exe)

最新发布页：

[V1.5.4 - 2026-07-16](https://github.com/china-luo/ImageStudioRemasteredVersion/releases/tag/v1.5.4)

### 基本流程

1. 打开“设置”，配置可用的图片生成或文本分析 API。
2. 在顶部选择功能板块：图片生成、拆图反推或 VOC 评论。
3. 上传产品实拍、包装、结构图或竞品图作为参考。
4. 在输入框中描述生成目标，或使用 `@图` 精确指定某张参考图。
5. 生成结果后，可继续编辑、复用、收藏、下载或批量管理历史记录。

## 功能

### 图片生成工作台

- Amazon Listing 图：支持主图、卖点图、场景图、尺寸图、包装图等图片方向。
- Amazon A+ 图：支持 A+ 模块策划、模块文案方向和图片生成提示词。
- TikTok Shop 图：支持商品主图和移动端详情图设计流程。
- 参考图生成：可上传产品实拍图、包装图、结构图作为生成参考。
- `@图` 引用：在输入框中指定某一张参考图，让修改要求更明确。

### AI 策划

- 根据商品标题、五点描述或产品资料生成逐张图片方案。
- 输出适合图片模型使用的英文提示词。
- 支持 Amazon / TikTok Shop 不同平台的图片表达逻辑。
- AI 策划面板可直接选择 `gpt-5.5` 或 `gpt-5.6-sol`，也兼容已有的自定义模型。
- Amazon MAIN 主图不附加风格板；附图、A+ 和 TikTok 图片提交前必须选择风格板。
- 最多可上传 16 张产品参考图，策划生成的隐藏风格板单独附加，不占上传数量。

### 拆图反推

- 上传竞品图片后，分析图片解决的购买疑问、信息层级、构图和风格。
- 输出可迁移到自家产品的图片结构建议。
- 生成可直接用于图片模型的英文 image prompt 和 negative prompt。

### VOC 评论分析

- 支持导入 Amazon 评论 CSV / XLSX 文件。
- 提取用户痛点、正向卖点、竞品机会和高频需求。
- 输出标题、五点描述、A+ 内容和图片策略建议。

### 历史记录与管理

- 支持历史记录筛选、搜索、复用、收藏和删除。
- 支持下载单张图片或批量下载结果图。
- 支持复用历史任务的提示词、参数和参考图。

### 配置能力

- 支持 OpenAI Images / Responses API。
- 支持 OpenRouter 图片模型。
- 支持 fal.ai。
- 支持自定义 OpenAI 兼容图片接口。
- 本地浏览器运行时支持动态 API 代理，可直接修改 API URL 并解决接口跨域限制。

## 赞助

应用内“设置 - 关于”和支持提示弹窗提供赞助入口。

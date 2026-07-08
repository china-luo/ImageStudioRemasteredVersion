# 跨境Image工作台

面向 Amazon 与 TikTok Shop 商品图二次创作的本地图片设计工作台，支持商品主图、卖点图、详情图、A+ 模块策划与图片生成。

维护者：[@china-luo](https://github.com/china-luo/ImageStudioRemasteredVersion)

## 在线体验与下载

- 在线体验：[https://china-luo.github.io/ImageStudioRemasteredVersion/](https://china-luo.github.io/ImageStudioRemasteredVersion/)
- 最新版本：[V1.4.4 - 2026-07-08](https://github.com/china-luo/ImageStudioRemasteredVersion/releases/tag/v1.4.4)
- Windows 安装包：[ImageStudioRemasteredVersion-Setup-V1.4.4-2026-07-08-x64.exe](https://github.com/china-luo/ImageStudioRemasteredVersion/releases/download/v1.4.4/ImageStudioRemasteredVersion-Setup-V1.4.4-2026-07-08-x64.exe)

## 功能

- Amazon 图片工作台：支持 Listing 主图、卖点图、详情图与 A+ 模块策划。
- TikTok Shop 图片工作台：支持商品主图与商品详情图独立设计流程。
- AI 策划：根据标题、五点描述或商品资料生成逐张图片方案和英文提示词。
- 参考图上传与引用：可上传商品实拍图、包装图、结构图，并在输入框中使用 `@图` 精确引用指定参考图。
- 拆图反推：上传竞品图后生成电商图片拆解、可迁移结构和英文图片提示词。
- VOC 评论分析：支持 Amazon 评论 CSV / XLSX 导入，提取痛点、卖点、竞品机会和图片策略建议。
- 历史记录：支持筛选、复用、收藏、下载与批量管理。
- 多服务商配置：支持 OpenAI Images / Responses、OpenRouter 图片模型、fal.ai、自定义 OpenAI 兼容接口等配置方式。
- 本地服务控制：页面内提供停止本地服务按钮，避免依赖可见命令行窗口。

## 适用场景

- Amazon Listing 主图、卖点图、场景图、尺寸图、包装图与 A+ 模块创意策划。
- TikTok Shop 商品主图和移动端详情图方向探索。
- 基于产品实拍、包装或结构参考图进行二次生成。
- 从竞品图中反推构图、信息层级、风格和可复用提示词。
- 从 VOC 评论中提取用户关注点，并转化为标题、五点、A+ 和图片策略。

## 环境要求

- Node.js 20 LTS 或更新版本
- npm

检查版本：

```powershell
node --version
npm --version
```

## 安装

```powershell
npm ci
```

## 快速启动

双击或运行项目根目录下的：

```powershell
cmd.exe /c call start-amazon-image-studio.bat
```

脚本会检查依赖并启动本地服务。

## 启动

Windows 用户推荐使用：

```powershell
cmd.exe /c call start-amazon-image-studio.bat
```

如果不使用脚本，也可以运行：

```powershell
npm run dev
```

启动后在浏览器打开：

```text
http://127.0.0.1:5173/
```

## 停止

可以在网页里点击“停止本地服务”按钮，也可以运行：

```powershell
cmd.exe /c call stop-amazon-image-studio.bat
```

## 构建

```powershell
npm run build
```

## Windows 安装包

生成本地 Windows 安装包：

```powershell
npm run build:installer
```

安装包会输出到：

```text
release/
```

## 发布

每次发版前后按固定检查表核对本地服务、安装包、GitHub Release 和在线部署：

```text
docs/release-checklist.md
```

## 项目结构

```text
src/components/        前端界面组件
src/lib/               API、提示词、图片处理、历史记录等核心逻辑
docs/knowledge/        Amazon / TikTok Shop 图片规范与策划知识
docs/images/           示例图片资源
scripts/               本地开发、mock API、Windows 打包脚本
electron/              Windows 桌面端入口
deploy/                Docker / Nginx 部署配置
```

## 赞助

赞助码图片放置在：

```text
public/support-wechat-pay.jpg
```

应用内“设置 - 关于”和支持提示弹窗会展示该赞助码。

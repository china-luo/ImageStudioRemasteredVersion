# 跨境Image工作台

面向 Amazon 与 TikTok Shop 商品图二次创作的本地图片设计工作台，支持商品主图、卖点图、详情图、A+ 模块策划与图片生成。

维护者：[@china-luo](https://github.com/china-luo/ImageStudioRemasteredVersion)

## 功能

- Amazon 图片工作台：支持 Listing 主图、卖点图、详情图与 A+ 模块策划。
- TikTok Shop 图片工作台：支持商品主图与商品详情图独立设计流程。
- 参考图上传：可上传商品实拍图、包装图、结构图作为生成参考。
- 历史记录：支持筛选、复用、收藏、下载与批量管理。
- 本地服务控制：页面内提供停止本地服务按钮，避免依赖可见命令行窗口。

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

## 赞助

赞助码图片放置在：

```text
public/support-wechat-pay.jpg
```

应用内“设置 - 关于”和支持提示弹窗会展示该赞助码。

# 部署与 API 请求策略

本应用的 Web 构建是纯静态站点。Cloudflare Workers 和 Vercel 都不提供上游 API 代理。浏览器直连用户配置的图片/文本 API 时，必须由上游开启 CORS，或改用本地开发代理 / Windows 桌面版。

## 共同行为

- 静态资源：`npm run build` 产出 `dist/`，`base` 为 `./`。
- API Key：Web 只保存在当前标签的 `sessionStorage`；桌面版使用系统加密存储。
- 开发跨域：本地 `vite` 的 `/api-proxy` 仅允许 localhost Origin，并拦截内网地址和非白名单 API 路径。
- 桌面跨域：Electron 主进程受控 `fetch`，不关闭 `webSecurity`。

## Cloudflare

配置见 `wrangler.jsonc`：只发布 `dist/` 静态 Assets，并按 SPA 回退到 `index.html`。

```text
npm run deploy:cf
```

**没有 Worker 去转发 OpenAI / fal / Shulex。** 线上 Cloudflare 环境与 GitHub Pages 一样，属于静态托管。若上游 API 拒绝浏览器 CORS，请使用桌面版或自备同源代理。

## Vercel

`vercel.json` 只关闭了 Git 自动部署，没有 rewrite、Serverless Function 或 API 代理。

把 `dist/` 作为静态站点发布即可。Vercel 环境下的 API 策略与 Cloudflare 相同：浏览器直连上游，依赖上游 CORS。

## GitHub Pages

README 中的在线地址同样是静态托管，策略与上相同。

## Docker

`deploy/Dockerfile` + `deploy/nginx.conf` 用于静态文件托管。容器内 nginx 如需反代上游 API，必须单独配置，且不得开放到任意目标（避免 SSRF）。默认镜像不包含通用 API 代理。

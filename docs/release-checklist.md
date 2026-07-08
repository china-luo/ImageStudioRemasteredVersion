# 发布检查表

用于每次发版前后核对不同交付渠道，避免出现“代码已改但本地没启动”、“安装包还是旧版”、“线上部署不是最新”的混淆。

## 1. 发版前确认

- [ ] `git status --short --branch`：确认当前分支、未提交文件和是否有不属于本次发布的改动。
- [ ] `package.json` 版本号已更新，且 `package-lock.json` 同步。
- [ ] `CHANGELOG.md` 已补充本次版本更新内容。
- [ ] 如新增用户可见功能，确认 README 或相关 docs 是否需要同步更新。

## 2. 本地验证

- [ ] `npm test` 通过。
- [ ] `npm run build` 通过。
- [ ] 如果改动影响 UI，使用本地页面或 Playwright 做一次关键路径烟测。
- [ ] 如需本地预览，确认服务端口是否启动：

```powershell
Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
```

- [ ] 如果端口未启动，运行：

```powershell
npm run dev
```

## 3. 安装包验证

- [ ] 执行 Windows 安装包构建：

```powershell
npm run build:installer
```

- [ ] 确认安装包文件名包含正确版本号和日期，例如：

```text
release/ImageStudioRemasteredVersion-Setup-V1.4.4-2026-07-08-x64.exe
```

- [ ] 确认安装包不是旧文件复用，检查 `LastWriteTime` 和文件大小。
- [ ] 如用户反馈桌面 APP 仍是旧版，确认用户安装的是本次新生成的 `.exe`。

## 4. Git 与 GitHub Release

- [ ] 提交代码：

```powershell
git add <files>
git commit -m "Release Vx.y.z ..."
```

- [ ] 创建并推送 tag：

```powershell
git tag vx.y.z
git push origin main
git push origin vx.y.z
```

- [ ] 创建 GitHub Release，并上传安装包。
- [ ] 在 GitHub Release 页面确认：
  - [ ] tag 正确。
  - [ ] 标题版本正确。
  - [ ] 安装包资产存在。
  - [ ] 安装包文件名正确。
  - [ ] Release 不是 draft，也不是误标 prerelease。

## 5. 在线部署确认

- [ ] GitHub Pages 工作流成功。
- [ ] Vercel deploy hook 工作流成功。
- [ ] Docker 发布工作流成功。
- [ ] 如果需要 Cloudflare/Wrangler 本地部署，确认本机存在：

```powershell
$env:CLOUDFLARE_API_TOKEN
```

- [ ] 如果没有 `CLOUDFLARE_API_TOKEN`，Wrangler 本地部署会失败；不要把 GitHub Pages 成功误认为 Cloudflare 也已更新。
- [ ] 打开线上地址确认版本和关键文案：

```text
https://china-luo.github.io/ImageStudioRemasteredVersion/
```

- [ ] 必要时直接检查线上构建产物是否包含新版本号或新文案。

## 6. 发布后状态确认

- [ ] `git status --short --branch` 干净，或只剩明确不需要提交的本地产物。
- [ ] GitHub Actions 最近一次运行全部成功，或已记录失败渠道和原因。
- [ ] GitHub Release 链接、安装包路径、线上地址已记录给用户。
- [ ] 如本地服务需要继续使用，确认服务已启动；如不需要，确认服务已停止。

## 7. 常见误区

- 代码提交成功，不等于本地服务已经启动。
- 本地构建成功，不等于安装包已经重新生成。
- 安装包生成成功，不等于 GitHub Release 已上传。
- GitHub Release 上传成功，不等于用户已经安装新版。
- GitHub Pages 部署成功，不等于 Cloudflare/Wrangler 也已部署成功。
- 线上页面更新成功，不等于桌面 APP 自动更新。

# Windows 安装包

官方安装包只走这一条链路：

```text
npm run build:installer
```

它会：

1. 执行 `tsc -b && vite build`，产出 `dist/`。
2. 运行 `scripts/package-windows-installer.ps1`，把 Electron 运行时、`dist/`、`electron/` 复制到 `release/win-unpacked`。
3. 用 `installer/windows-installer.nsi` 生成安装包。

## 唯一配置来源

| 项 | 来源 |
|---|---|
| 版本号 | `package.json` 的 `version`，由 PowerShell 传入 NSIS 的 `APP_VERSION` |
| 产物名 | `release/ImageStudioRemasteredVersion-Setup-V{version}-{date}-x64.exe` |
| 图标 | `build/icon.ico`（可由 `build/icon.png` 生成） |
| 安装路径 | NSIS `InstallDir`：`$LOCALAPPDATA\Programs\ImageStudioRemasteredVersion` |
| 快捷方式 | NSIS 写入开始菜单和桌面，名称「跨境Image工作台」 |

不要再运行 `electron-builder`。`package.json` 里的 electron-builder 配置已删除，避免和第二套产物名、安装路径冲突。`electron-builder` 仍可作为可选开发依赖，仅用于本机缓存 `makensis.exe`。

## 前置工具

- Node.js 与项目依赖（`npm install`）
- NSIS 3（`makensis.exe` 在 PATH 中，或位于 electron-builder 缓存目录）
- `rcedit.exe`（通常随 npm 依赖提供）

## Windows 验证

不安装系统资源时可先验证 NSIS 的安装路径、开始菜单/桌面快捷方式和卸载清理声明：

```text
npm run test:installer-config
```

在已有构建产物上追加版本、未打包程序和安装包存在性断言：

```text
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-windows-installer.ps1 -RequireBuiltInstaller
```

在隔离 Windows 环境实际安装后，可传入安装目录执行快捷方式和可执行文件断言：

```text
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-windows-installer.ps1 -InstalledRoot "$env:LOCALAPPDATA\Programs\ImageStudioRemasteredVersion"
```

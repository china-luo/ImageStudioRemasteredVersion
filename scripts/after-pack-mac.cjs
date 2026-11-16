// macOS 打包后处理：没有 Developer ID 证书时对 .app 做 ad-hoc 签名。
// 未签名的 Electron 应用被 electron-builder 改名/重写后旧签名失效，
// 直接被 SIGKILL 无法启动；ad-hoc 签名可保证本机构建正常运行。
const { execFileSync } = require('node:child_process')

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const hasIdentity = (() => {
    try {
      const out = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
        encoding: 'utf-8',
      })
      return out.includes('Developer ID Application')
    } catch {
      return false
    }
  })()

  if (hasIdentity) return // 交给 electron-builder 正式签名

  const appPath = context.appOutDir.endsWith('.app')
    ? context.appOutDir
    : require('node:path').join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)

  console.log(`[afterPack] ad-hoc signing ${appPath}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
}

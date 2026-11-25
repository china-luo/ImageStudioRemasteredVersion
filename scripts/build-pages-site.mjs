import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

const distAppDir = path.join(rootDir, 'dist')
const siteLandingPath = path.join(rootDir, 'site', 'index.html')
const outDir = path.join(rootDir, 'dist-pages')
const outAppDir = path.join(outDir, 'app')
const outAssetsDir = path.join(outDir, 'assets')

if (!fs.existsSync(path.join(distAppDir, 'index.html'))) {
  throw new Error('Missing dist/index.html. Run `npm run build` before assembling the GitHub Pages site.')
}

if (!fs.existsSync(siteLandingPath)) {
  throw new Error('Missing site/index.html.')
}

const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
const versionTag = `v${String(pkg.version || '2.0.0').replace(/^v/i, '')}`

// Reset output directory
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outAppDir, { recursive: true })
fs.mkdirSync(outAssetsDir, { recursive: true })

// 1. Write standalone landing page to root /index.html with synced package version
const rawLandingHtml = fs.readFileSync(siteLandingPath, 'utf8')
const syncedLandingHtml = rawLandingHtml.replace(
  /(data-release-tag>)v[\d.]+(?:-[0-9A-Za-z.-]+)?(<\/)/g,
  `$1${versionTag}$2`,
)
fs.writeFileSync(path.join(outDir, 'index.html'), syncedLandingHtml, 'utf8')

// 2. Copy static visual assets used by the landing page
const assetMappings = [
  {
    src: path.join(rootDir, 'docs', 'images', 'workbench-overview.png'),
    dest: path.join(outAssetsDir, 'workbench-overview.png'),
  },
  {
    src: path.join(rootDir, 'public', 'pwa-icon.png'),
    dest: path.join(outAssetsDir, 'pwa-icon.png'),
  },
]

for (const { src, dest } of assetMappings) {
  if (!fs.existsSync(src)) {
    throw new Error(`Missing required landing page asset: ${path.relative(rootDir, src)}`)
  }
  fs.copyFileSync(src, dest)
}

// 3. Copy built React workbench into /app/
fs.cpSync(distAppDir, outAppDir, { recursive: true })

// 4. Disable Jekyll processing on GitHub Pages
fs.writeFileSync(path.join(outDir, '.nojekyll'), '', 'utf8')

console.log(
  `[build:pages] Assembled GitHub Pages bundle at dist-pages/ (landing: /, workbench: /app/, version: ${versionTag})`,
)

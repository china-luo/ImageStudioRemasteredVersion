import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const nginx = read('deploy/nginx.conf')
const workflow = read('.github/workflows/vercel-tag-deploy.yml')

describe('Docker API proxy configuration', () => {
  // Exercise the allowlist expressions from the shipped template, not a separate
  // copy of the policy. Runtime nginx integration is in scripts/test-nginx-proxy.mjs.
  const rules = [...nginx.matchAll(/if \(\$proxy_route ~ (.+)\) \{\s*set \$allow_proxy 1;/g)].map(
    (match) => new RegExp(match[1]),
  )
  const allowed = (method: string, path: string) => rules.some((rule) => rule.test(`${method}:${path}`))

  it('allows GET only for the exact models endpoint, POST only for generation endpoints', () => {
    expect(rules).toHaveLength(2)
    const generationPaths = ['images/generations', 'images/edits', 'responses', 'chat/completions']
    for (const prefix of ['/api-proxy/', '/api-proxy/v1/']) {
      for (const endpoint of ['models', ...generationPaths]) {
        for (const method of ['GET', 'POST', 'OPTIONS', 'HEAD', 'PUT', 'PATCH', 'DELETE']) {
          expect(allowed(method, `${prefix}${endpoint}`), `${method} ${prefix}${endpoint}`).toBe(
            method === 'OPTIONS' || method === (endpoint === 'models' ? 'GET' : 'POST'),
          )
        }
      }
    }
    for (const path of ['/api-proxy/models/extra', '/api-proxy/files', '/api-proxy/v1/files', '/api-proxy/models/']) {
      for (const method of ['GET', 'POST', 'OPTIONS']) expect(allowed(method, path)).toBe(false)
    }
    expect(nginx).toContain('if ($allow_proxy = 0)')
    expect(nginx).toContain('return 403 "Forbidden: API Proxy path restricted"')
    expect(nginx).toContain('proxy_pass ${API_PROXY_URL}/;')
  })

  it('normalizes optional /v1 only when the fixed base already ends in /v1', () => {
    expect(nginx).toContain('if ($api_proxy_base ~ /v1$)')
    const rewrite = nginx.match(/rewrite (\S+) (\S+) last;/)!
    expect(rewrite).not.toBeNull()
    const rule = new RegExp(rewrite[1])
    for (const [base, path, expected] of [
      ['https://upstream.example', '/api-proxy/models', 'https://upstream.example/models'],
      ['https://upstream.example', '/api-proxy/v1/models', 'https://upstream.example/v1/models'],
      ['https://upstream.example/v1', '/api-proxy/models', 'https://upstream.example/v1/models'],
      ['https://upstream.example/v1', '/api-proxy/v1/models', 'https://upstream.example/v1/models'],
    ]) {
      const normalized = /\/v1$/.test(base) ? path.replace(rule, rewrite[2]) : path
      expect(`${base}/${normalized.slice('/api-proxy/'.length)}`).toBe(expected)
      if (base.endsWith('/v1')) expect(normalized).not.toMatch(rule) // No rewrite loop on the next pass.
    }
    expect(nginx).toContain('proxy_ssl_server_name on;')
  })
})

describe('Vercel hook HTTP failures', () => {
  const server = createServer((request, response) => {
    response.writeHead(Number(request.url?.slice(1)) || 200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ method: request.method }))
  })
  let baseURL: string
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected a loopback HTTP address')
    baseURL = `http://127.0.0.1:${address.port}`
  })
  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  })

  it.each([200, 400, 401, 404, 500, 503])('returns the correct curl exit status for HTTP %s', async (status) => {
    const line = workflow.match(/^\s*(curl .+)$/m)![1]
    const args = line
      .match(/"[^"]*"|\S+/g)!
      .slice(1)
      .map((value) => value.replace(/^"|"$/g, ''))
    const index = args.indexOf('$VERCEL_DEPLOY_HOOK')
    expect(index).toBeGreaterThanOrEqual(0)
    args[index] = `${baseURL}/${status}`
    const run = promisify(execFile)(process.platform === 'win32' ? 'curl.exe' : 'curl', args)
    if (status >= 400) await expect(run).rejects.toMatchObject({ code: 22 })
    else expect((await run).stdout).toContain('"method":"POST"')
  })
})

describe.skipIf(process.platform !== 'win32')('Windows dependency version guard', () => {
  it.each(['20.19.0', '22.0.0', '22.13.0', '24.0.0', '25.0.0'])(
    'checks mocked Node %s without installing packages',
    async (version) => {
      const directory = mkdtempSync(join(tmpdir(), 'image-studio-node-guard-'))
      try {
        mkdirSync(join(directory, 'node_modules', '.bin'), { recursive: true })
        writeFileSync(join(directory, 'node_modules', '.bin', 'vite.cmd'), '')
        const packageText = '{}'
        writeFileSync(join(directory, 'package.json'), packageText)
        const hash = createHash('sha256').update(packageText).digest('hex').toUpperCase()
        writeFileSync(join(directory, '.amazon-image-studio-deps.hash'), `package.json:${hash}`)
        const script = fileURLToPath(new URL('../../scripts/ensure-dev-dependencies.ps1', import.meta.url))
        const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
        const command = `function node { 'v${version}' }; function npm { throw 'Tests must never install dependencies' }; & ${quote(script)} -ProjectDir ${quote(directory)}`
        // PowerShell 7 hosts can pass their PSModulePath to Node. Windows
        // PowerShell 5.1 must resolve its own built-in modules for Get-FileHash.
        const env = { ...process.env }
        for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key]
        const result = promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
          env,
        })
        if (Number(version.split('.')[0]) < 24) {
          await expect(result).rejects.toMatchObject({ code: 1 })
          await expect(result).rejects.toMatchObject({
            stderr: expect.stringContaining('Node.js 24 LTS or newer is required'),
          })
        } else expect((await result).stdout).toContain('Dependencies are already installed.')
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    },
    15000,
  )
})

it('keeps the documented Node baseline aligned with CI, Docker and the Windows guard', () => {
  expect(read('deploy/Dockerfile')).toContain('node:24-alpine')
  for (const file of ['.github/workflows/ci.yml', '.github/workflows/deploy-pages.yml']) {
    expect(read(file)).toMatch(/node-version: 24\b/)
  }
  expect(read('scripts/ensure-dev-dependencies.ps1')).toContain('$nodeVersion.Major -lt 24')
  expect(read('README.md')).toContain('Node.js 24 LTS 或更高版本')
  expect(read('docs/packaging.md')).toContain('Node.js 24 LTS 或更高版本')
})

it('publishes the standalone landing page at root and the web workbench under /app/ on GitHub Pages', () => {
  const pagesWorkflow = read('.github/workflows/deploy-pages.yml')
  const landingHtml = read('site/index.html')
  const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }

  expect(pkg.scripts?.['build:pages']).toBe('npm run build && node scripts/build-pages-site.mjs')
  expect(pagesWorkflow).toContain('run: npm run build:pages')
  expect(pagesWorkflow).toContain('path: dist-pages')
  expect(landingHtml).toContain('href="./app/"')
  expect(landingHtml).toContain("window.location.replace('./app/' + search + hash)")
})

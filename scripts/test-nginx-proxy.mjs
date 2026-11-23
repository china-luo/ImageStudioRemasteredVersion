// Optional runtime regression: NGINX_BIN=/path/to/nginx node --test scripts/test-nginx-proxy.mjs
// Uses only temporary files and loopback listeners; never calls a real API/deployment.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, spawn, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const executable = process.env.NGINX_BIN || 'nginx'
const available = !spawnSync(executable, ['-v'], { encoding: 'utf8' }).error
const run = promisify(execFile)
const template = await readFile(new URL('../deploy/nginx.conf', import.meta.url), 'utf8')

async function listen(server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}

for (const basePath of ['', '/v1']) {
  test(
    `nginx fixed upstream ${basePath || '/'} enforces methods and avoids duplicate v1`,
    {
      skip: !available && 'nginx is not installed; set NGINX_BIN to enable runtime verification',
      timeout: 30000,
    },
    async () => {
      let forwarded = 0
      const upstream = createServer(async (request, response) => {
        forwarded++
        const chunks = []
        for await (const chunk of request) chunks.push(chunk)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({ method: request.method, url: request.url, body: Buffer.concat(chunks).toString() }),
        )
      })
      const upstreamPort = await listen(upstream)
      const reservation = createServer()
      const proxyPort = await listen(reservation)
      await new Promise((resolve) => reservation.close(resolve))
      const directory = await mkdtemp(join(tmpdir(), 'image-studio-nginx-'))
      const prefix = `${directory.replaceAll('\\', '/')}/`
      await mkdir(join(directory, 'logs'))
      const configPath = join(directory, 'nginx.conf')
      const config = template
        .replaceAll('${HOST}', '127.0.0.1')
        .replaceAll('${PORT}', String(proxyPort))
        .replaceAll('${API_PROXY_URL}', `http://127.0.0.1:${upstreamPort}${basePath}`)
      await writeFile(configPath, `error_log logs/error.log;\npid nginx.pid;\nevents {}\nhttp {\n${config}\n}\n`)
      let nginx
      try {
        await run(executable, ['-p', prefix, '-c', configPath, '-t'])
        nginx = spawn(executable, ['-p', prefix, '-c', configPath, '-g', 'daemon off; master_process off;'], {
          stdio: 'ignore',
        })
        const exited = once(nginx, 'exit')
        const origin = `http://127.0.0.1:${proxyPort}`
        let ready = false
        for (let attempt = 0; attempt < 50; attempt++) {
          try {
            const response = await fetch(`${origin}/api-proxy/not-a-product-endpoint`, {
              signal: AbortSignal.timeout(500),
            })
            await response.text()
            ready = response.status === 403
            if (ready) break
          } catch {
            /* Wait for the local nginx listener. */
          }
          if (nginx.exitCode !== null) break
          await delay(50)
        }
        assert.ok(ready, 'nginx must start and reject an unlisted path')
        for (const clientVersion of ['', 'v1/']) {
          for (const endpoint of ['models', 'images/generations', 'images/edits', 'responses', 'chat/completions']) {
            const path = `/api-proxy/${clientVersion}${endpoint}`
            for (const method of [endpoint === 'models' ? 'GET' : 'POST', 'OPTIONS']) {
              const body = method === 'POST' ? '{"test":"local-only"}' : undefined
              const response = await fetch(`${origin}${path}?limit=2`, {
                method,
                body,
                signal: AbortSignal.timeout(2000),
              })
              assert.equal(response.status, 200, `${method} ${path}`)
              const expectedVersion = basePath || (clientVersion ? '/v1' : '')
              assert.deepEqual(await response.json(), {
                method,
                url: `${expectedVersion}/${endpoint}?limit=2`,
                body: body || '',
              })
            }
            for (const method of [endpoint === 'models' ? 'POST' : 'GET', 'HEAD', 'PUT', 'DELETE']) {
              const count = forwarded
              const response = await fetch(`${origin}${path}`, { method, signal: AbortSignal.timeout(2000) })
              await response.text()
              assert.equal(response.status, 403, `${method} ${path}`)
              assert.equal(forwarded, count, 'denied requests must not reach the upstream')
            }
          }
        }
        for (const path of ['/api-proxy/files', '/api-proxy/models/extra', '/api-proxy/v1/files']) {
          const count = forwarded
          const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(2000) })
          await response.text()
          assert.equal(response.status, 403)
          assert.equal(forwarded, count)
        }
        await run(executable, ['-p', prefix, '-c', configPath, '-s', 'quit'])
        await exited
      } finally {
        if (nginx && nginx.exitCode === null) nginx.kill()
        upstream.closeAllConnections()
        await new Promise((resolve) => upstream.close(resolve))
        await rm(directory, { recursive: true, force: true })
      }
    },
  )
}

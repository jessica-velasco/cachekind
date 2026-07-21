import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'

const port = Number(process.env.CONTRACT_PROBE_PORT || 3212)
const root = process.cwd()
const serverPath = path.join(
  root,
  'examples/contract-probe/.next/standalone/examples/contract-probe/server.js',
)

const server = spawn(process.execPath, [serverPath], {
  cwd: root,
  env: {
    ...process.env,
    CACHE_HANDLER_PROBE: '1',
    HOSTNAME: '127.0.0.1',
    PORT: String(port),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
server.stdout.on('data', (chunk) => {
  output += chunk
  process.stdout.write(chunk)
})
server.stderr.on('data', (chunk) => {
  output += chunk
  process.stderr.write(chunk)
})

function waitUntilReady() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Probe server did not become ready.\n${output}`)),
      10_000,
    )

    const check = () => {
      if (output.includes('Ready in')) {
        clearTimeout(timeout)
        resolve()
      }
    }

    server.stdout.on('data', check)
    server.stderr.on('data', check)
    server.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`Probe server exited with code ${code}.\n${output}`))
    })
    check()
  })
}

async function request(pathname, init) {
  return fetch(`http://127.0.0.1:${port}${pathname}`, init)
}

try {
  await waitUntilReady()

  const firstPage = await request('/')
  const secondPage = await request('/')
  assert.equal(firstPage.headers.get('x-nextjs-cache'), 'MISS')
  assert.equal(secondPage.headers.get('x-nextjs-cache'), 'HIT')

  const firstRoute = await request('/api/value')
  const secondRoute = await request('/api/value')
  assert.equal(firstRoute.headers.get('x-nextjs-cache'), 'MISS')
  assert.equal(secondRoute.headers.get('x-nextjs-cache'), 'HIT')

  const edge = await request('/api/edge')
  assert.deepEqual(await edge.json(), { runtime: 'edge' })

  const revalidated = await request('/api/revalidate', { method: 'POST' })
  assert.equal(revalidated.ok, true)

  const pageAfterRevalidation = await request('/')
  assert.equal(pageAfterRevalidation.headers.get('x-nextjs-cache'), 'MISS')

  assert.match(output, /"kind":"FETCH"/)
  assert.match(output, /"kind":"APP_PAGE"/)
  assert.match(output, /"kind":"APP_ROUTE"/)
  assert.match(output, /"operation":"revalidateTag"/)

  process.stdout.write('Contract verification passed.\n')
} finally {
  server.kill('SIGTERM')
}

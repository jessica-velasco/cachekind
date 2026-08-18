import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access } from 'node:fs/promises'
import path from 'node:path'

const redisUrl = process.env.CACHEKIND_TEST_REDIS_URL
if (!redisUrl) {
  throw new Error('CACHEKIND_TEST_REDIS_URL is required')
}

const root = process.cwd()
const build = spawnSync('npm', ['run', 'build:probe'], {
  cwd: root,
  env: {
    ...process.env,
    CACHEKIND_BUILD_REAL: '1',
    CACHEKIND_TEST_REDIS_URL: '',
    CACHEKIND_TEST_NAMESPACE: '',
  },
  encoding: 'utf8',
  stdio: 'inherit',
})
if (build.status !== 0) {
  throw new Error(`Next.js production build failed with code ${build.status}`)
}

const serverPath = path.join(
  root,
  'examples/contract-probe/.next/standalone/examples/contract-probe/server.js',
)
const standaloneRoot = path.join(
  root,
  'examples/contract-probe/.next/standalone',
)
await Promise.all([
  access(serverPath),
  access(path.join(standaloneRoot, 'dist/index.js')),
  access(path.join(standaloneRoot, 'node_modules/@redis/client/package.json')),
])

const basePort = Number(process.env.SHARED_CACHE_PORT || 3230)
const namespace = `cachekind-e2e-${randomUUID()}`
const servers = [basePort, basePort + 1].map((port) => {
  const child = spawn(process.execPath, [serverPath], {
    cwd: root,
    env: {
      ...process.env,
      CACHEKIND_TEST_REDIS_URL: redisUrl,
      CACHEKIND_TEST_NAMESPACE: namespace,
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.output = ''
  child.stdout.on('data', (chunk) => {
    child.output += chunk
    process.stdout.write(`[${port}] ${chunk}`)
  })
  child.stderr.on('data', (chunk) => {
    child.output += chunk
    process.stderr.write(`[${port}] ${chunk}`)
  })
  return { child, port }
})

function waitUntilReady(server) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(
          `Server ${server.port} did not become ready.\n${server.child.output}`,
        ),
      )
    }, 15_000)

    const check = () => {
      if (server.child.output.includes('Ready in')) {
        clearTimeout(timeout)
        resolve()
      }
    }
    server.child.stdout.on('data', check)
    server.child.stderr.on('data', check)
    server.child.once('exit', (code) => {
      clearTimeout(timeout)
      reject(
        new Error(
          `Server ${server.port} exited with code ${code}.\n${server.child.output}`,
        ),
      )
    })
    check()
  })
}

async function request(server, pathname, init) {
  return fetch(`http://127.0.0.1:${server.port}${pathname}`, init)
}

try {
  await Promise.all(servers.map(waitUntilReady))
  const [first, second] = servers

  const firstPage = await request(first, '/')
  const sharedPage = await request(second, '/')
  assert.equal(firstPage.headers.get('x-nextjs-cache'), 'MISS')
  assert.equal(sharedPage.headers.get('x-nextjs-cache'), 'HIT')

  const firstRoute = await request(first, '/api/value')
  const sharedRoute = await request(second, '/api/value')
  assert.equal(firstRoute.headers.get('x-nextjs-cache'), 'MISS')
  assert.equal(sharedRoute.headers.get('x-nextjs-cache'), 'HIT')

  const tagRevalidation = await request(first, '/api/revalidate', {
    method: 'POST',
  })
  assert.equal(tagRevalidation.ok, true)
  const pageAfterTag = await request(second, '/')
  assert.equal(pageAfterTag.headers.get('x-nextjs-cache'), 'MISS')

  const pathRevalidation = await request(first, '/api/revalidate-path', {
    method: 'POST',
  })
  assert.equal(pathRevalidation.ok, true)
  const pageAfterPath = await request(second, '/')
  assert.equal(pageAfterPath.headers.get('x-nextjs-cache'), 'MISS')

  process.stdout.write('Two-instance shared-cache verification passed.\n')
} finally {
  for (const { child } of servers) child.kill('SIGTERM')
}

/**
 * dsh-plugin-runcat-inventory —— host 半端 mock 单元测试（单进程脚本）
 *
 * 用临时 profile 目录 + 假 loader 条目驱动真实 apply(ctx)，验证：
 * 清单采集（字段/来源/过滤/跳过）、启用/停用（cordis.patch.yml 写入与
 * 恢复）、信任校验、参数校验。
 *
 * 运行：node test/mock-test.mjs
 * 说明：导入的是【已安装到 profile 的】模块（真实路径）；js-yaml 惰性
 * 解析锚定临时 profile 目录，测试在临时目录里 junction 了真实 js-yaml。
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const REAL_JS_YAML = 'C:/Users/yeyu1/.dsh/profiles/node_modules/js-yaml'
const PLUGIN_URL = 'file:///C:/Users/yeyu1/.dsh/profiles/web/node_modules/dsh-plugin-runcat-inventory/lib/index.js'

let passed = 0
let failed = 0
function test(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log('  ok ' + name) })
    .catch((error) => { failed++; console.error('  FAIL ' + name + '\n    ' + (error?.stack || error)) })
}

const tempDir = mkdtempSync(join(tmpdir(), 'runcat-mock-'))
let registrations = []

function makeReq({ method = 'GET', url = '/', headers = {} } = {}) {
  const listeners = {}
  const req = {
    method,
    url,
    headers: Object.assign({
      host: '127.0.0.1:3080',
      'sec-fetch-site': 'same-origin',
      origin: 'http://127.0.0.1:3080',
    }, headers),
    on(ev, fn) { listeners[ev] = fn; return req },
    destroy() {},
    _emit(ev, arg) { if (listeners[ev]) listeners[ev](arg) },
    _feed(payload) {
      const self = req
      setImmediate(() => { self._emit('data', Buffer.from(JSON.stringify(payload))); self._emit('end') })
    },
  }
  return req
}

function makeRes() {
  const res = { status: 0, body: '' }
  res.writeHead = (code) => { res.status = code }
  res.end = (chunk) => { res.body = String(chunk ?? '') }
  return res
}

function fakeEntry({ id, name, config, group = false, disabled = false, fiberState = 2 }) {
  return {
    id,
    options: { id, name, ...(config !== undefined ? { config } : {}), ...(group ? { group: true } : {}) },
    get disabled() { return disabled },
    fiber: fiberState === null ? undefined : { state: fiberState },
  }
}

function fakeCtx() {
  const entries = [
    {
      id: 'include',
      options: { name: 'cordis:include', config: { path: pathToFileURL(join(tempDir, 'cordis.yml')).href } },
      disabled: false,
      fiber: { state: 2 },
    },
    fakeEntry({ id: 'hello', name: 'dsh-plugin-hello', config: { greeting: 'hi' }, fiberState: 2 }),
    fakeEntry({ id: 'market', name: 'dsh-plugins-market', fiberState: 3 }),
    fakeEntry({ id: 'web-search', name: '@deepseek-ai/dsh-web-search-deepseek', disabled: true, fiberState: null }),
    fakeEntry({ id: 'runcat-inventory', name: 'dsh-plugin-runcat-inventory', fiberState: 2 }),
    fakeEntry({ id: 'group-demo', name: 'some-group', group: true, fiberState: 2 }),
  ]
  return {
    loader: { entries() { return entries } },
    webServer: { register(opts) { registrations.push(opts) } },
    effect(fn) { const d = fn(); return d ?? (() => {}) },
    logger() { return { info() {}, warn() {}, error() {} } },
  }
}

async function handle(reg, req) {
  const res = makeRes()
  await reg.handler(req, res)
  return res
}

// ── 环境准备 ───────────────────────────────────────────────────────────
writeFileSync(join(tempDir, 'cordis.yml'), '[]\n')
writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
  name: 'dsh-profile-mock',
  private: true,
  dependencies: {
    'dsh-plugin-hello': 'link:C:/some/hello',
    'dsh-plugins-market': 'github:Luaphes/dsh-plugins-market',
    '@deepseek-ai/dsh-web-search-deepseek': '^0.1.0-rc.6',
  },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-plugin-hello', 'dsh-plugins-market'] } },
}))
writeFileSync(join(tempDir, 'cordis.patch.yml'), [
  '# Your patch layer for this dsh profile, applied after every bundle layer:',
  '# a top-level YAML array of loader patch entries.',
  '[]',
  '',
].join('\n'))
const nm = join(tempDir, 'node_modules')
// hello：无 repository → 回退按安装方式（link）
mkdirSync(join(nm, 'dsh-plugin-hello'), { recursive: true })
writeFileSync(join(nm, 'dsh-plugin-hello', 'package.json'), JSON.stringify({ name: 'dsh-plugin-hello', version: '0.1.0', description: 'demo' }))
mkdirSync(join(nm, 'dsh-plugins-market'), { recursive: true })
writeFileSync(join(nm, 'dsh-plugins-market', 'package.json'), JSON.stringify({ name: 'dsh-plugins-market', version: '0.1.0', description: 'market' }))
// 本插件：带 repository（git+ 前缀与 .git 后缀应被清理）→ 显示仓库地址
mkdirSync(join(nm, 'dsh-plugin-runcat-inventory'), { recursive: true })
writeFileSync(join(nm, 'dsh-plugin-runcat-inventory', 'package.json'), JSON.stringify({
  name: 'dsh-plugin-runcat-inventory',
  version: '0.3.1',
  description: 'self',
  repository: { type: 'git', url: 'git+https://github.com/runcat-tommy/dsh-plugin-runcat-inventory.git' },
}))
mkdirSync(join(nm, '@deepseek-ai', 'dsh-web-search-deepseek'), { recursive: true })
writeFileSync(join(nm, '@deepseek-ai', 'dsh-web-search-deepseek', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-web-search-deepseek', version: '0.1.0-rc.6', description: 'search' }))
mkdirSync(join(nm, '@deepseek-ai', 'dsh-base'), { recursive: true })
writeFileSync(join(nm, '@deepseek-ai', 'dsh-base', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-base', version: '0.1.0-rc.6', description: 'base' }))
try {
  symlinkSync(REAL_JS_YAML, join(nm, 'js-yaml'), 'junction')
} catch { /* 已存在 */ }

function patchFileContent() {
  return readFileSync(join(tempDir, 'cordis.patch.yml'), 'utf8')
}

// ── 测试用例 ───────────────────────────────────────────────────────────
test('route registration: prefix /runcat-api', async () => {
  const mod = await import(PLUGIN_URL)
  mod.apply(fakeCtx())
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].kind, 'prefix')
  assert.equal(registrations[0].path, '/runcat-api')
})

test('GET /inventory: fields, sources, skip group/include', async () => {
  const mod = await import(PLUGIN_URL)
  mod.apply(fakeCtx())
  const reg = registrations[registrations.length - 1]

  const res = await handle(reg, makeReq({ url: '/runcat-api/inventory' }))
  assert.equal(res.status, 200)
  const data = JSON.parse(res.body)
  assert.equal(data.ok, true)
  assert.equal(data.entries.length, 4, 'should be 4 non-group entries')
  const byId = Object.fromEntries(data.entries.map((e) => [e.id, e]))

  assert.equal(byId['hello'].name, 'dsh-plugin-hello')
  assert.equal(byId['hello'].enabled, true)
  assert.equal(byId['hello'].fiberPhase, 'active')
  assert.equal(byId['hello'].description, 'demo')
  assert.equal(byId['hello'].version, '0.1.0')
  // 无 repository 的插件 → 回退按安装方式显示
  assert.equal(byId['hello'].sourceKind, 'link')
  assert.equal(byId['hello'].sourceSpec, 'C:/some/hello')
  assert.deepEqual(byId['hello'].config, { greeting: 'hi' })

  assert.equal(byId['market'].fiberPhase, 'failed')
  assert.equal(byId['market'].sourceKind, 'github')
  assert.equal(byId['market'].sourceSpec, 'github:Luaphes/dsh-plugins-market')

  assert.equal(byId['web-search'].enabled, false)
  assert.equal(byId['web-search'].fiberPhase, null)
  assert.equal(byId['web-search'].sourceKind, 'npm')
  assert.equal(byId['web-search'].sourceSpec, '^0.1.0-rc.6')

  // 仅本插件：显示清理后的仓库 URL（git+ 前缀和 .git 后缀被去掉）
  assert.equal(byId['runcat-inventory'].sourceKind, 'repo')
  assert.equal(byId['runcat-inventory'].sourceSpec, 'https://github.com/runcat-tommy/dsh-plugin-runcat-inventory')

  assert.equal(byId['group-demo'], undefined, 'group entries should be skipped')
})

test('POST /set-enabled: disable writes patch (keep comments), idempotent, enable removes', async () => {
  const mod = await import(PLUGIN_URL)
  mod.apply(fakeCtx())
  const reg = registrations[registrations.length - 1]

  // disable hello
  let req = makeReq({ method: 'POST', url: '/runcat-api/set-enabled' })
  req._feed({ id: 'hello', name: 'dsh-plugin-hello', enabled: false })
  let res = await handle(reg, req)
  assert.equal(res.status, 200)
  assert.equal(JSON.parse(res.body).ok, true)

  let content = patchFileContent()
  assert.match(content, /^# Your patch layer/, 'leading comments preserved')
  assert.match(content, /id: hello/)
  assert.match(content, /disabled: true/)

  // idempotent: second disable does not duplicate
  req = makeReq({ method: 'POST', url: '/runcat-api/set-enabled' })
  req._feed({ id: 'hello', name: 'dsh-plugin-hello', enabled: false })
  await handle(reg, req)
  content = patchFileContent()
  assert.equal((content.match(/id: hello/g) || []).length, 1, 'only one disable patch')

  // enable hello (remove patch)
  req = makeReq({ method: 'POST', url: '/runcat-api/set-enabled' })
  req._feed({ id: 'hello', name: 'dsh-plugin-hello', enabled: true })
  res = await handle(reg, req)
  assert.equal(JSON.parse(res.body).ok, true)
  content = patchFileContent()
  assert.doesNotMatch(content, /disabled: true/)
  assert.match(content, /\[\]/)
})

test('security: non-loopback host rejected (403)', async () => {
  const mod = await import(PLUGIN_URL)
  mod.apply(fakeCtx())
  const reg = registrations[registrations.length - 1]
  const res = await handle(reg, makeReq({ url: '/runcat-api/inventory', headers: { host: 'evil.example.com', origin: 'http://evil.example.com' } }))
  assert.equal(res.status, 403)
  assert.equal(JSON.parse(res.body).code, 'FORBIDDEN')
})

test('validation: missing id/name returns error', async () => {
  const mod = await import(PLUGIN_URL)
  mod.apply(fakeCtx())
  const reg = registrations[registrations.length - 1]
  const req = makeReq({ method: 'POST', url: '/runcat-api/set-enabled' })
  req._feed({}) // valid JSON but missing id/name
  const res = await handle(reg, req)
  assert.equal(res.status, 200)
  const data = JSON.parse(res.body)
  assert.equal(data.ok, false)
  assert.equal(data.code, 'MISSING_PARAMS')
})

// ── 汇总（留足异步测试完成时间）─────────────────────────────────────
setTimeout(() => {
  rmSync(tempDir, { recursive: true, force: true })
  console.log('\n结果：' + passed + ' 通过，' + failed + ' 失败')
  process.exit(failed === 0 ? 0 : 1)
}, 5000)

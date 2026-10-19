/**
 * dsh-plugin-runcat-inventory —— 更新路径回归测试（单进程脚本）
 *
 * 钉住 v1.2.1 的两类实测缺陷：
 *   ① 更新命令必须带目标版本（`add <name>@<latest>`）；不带版本时 pnpm 会把
 *      `add <name>` 当成"已满足"空转、仍然 exit 0，随后自检把空转报成"更新失败"。
 *   ② 本地链接（link:/file:/workspace:）依赖不得 spawn pnpm —— 带版本的 add
 *      会把开发链接静默替换成 registry 安装。
 *
 * 做法：临时 profile 目录 + 假 loader 条目驱动真实 apply(ctx)，用
 * globalThis.__runcatRunCommand 注入假命令（记录 argv、改写临时安装版本），
 * 并替换 globalThis.fetch 伪造 npm registry 的 latest。
 *
 * 运行：node test/update-test.mjs
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PLUGIN_URL = pathToFileURL(join(REPO_ROOT, 'lib', 'index.js')).href

// 更新用例只需离线确定性：清单扫描关掉（更新动作本身走假 fetch）
process.env.RUNCAT_SKIP_UPDATE_SCAN = '1'

let passed = 0
let failed = 0
/** 串行执行：每个用例都要改临时安装目录与全局注入点，并发会互相踩。 */
let queue = Promise.resolve()
function test(name, fn) {
  queue = queue
    .then(fn)
    .then(() => { passed++; console.log('  ok ' + name) })
    .catch((error) => { failed++; console.error('  FAIL ' + name + '\n    ' + (error?.stack || error)) })
}

// ── 临时 profile ───────────────────────────────────────────────────────
const tempDir = mkdtempSync(join(tmpdir(), 'runcat-update-'))
const nm = join(tempDir, 'node_modules')
const PROFILE_NAME = tempDir.split(/[\\/]/).pop()

const DEPS = {
  'dsh-fake-npm': '^1.0.0',        // 范围 specifier（用例 ①）
  'dsh-fake-mismatch': '^3.0.0',   // 用例 ②：exit 0 但版本不变
  'dsh-fake-pinned': '2.0.2',      // 精确 specifier（用例 ①b）
  'dsh-fake-link': 'link:D:/dev/fake-link',
  'dsh-fake-file': 'file:../fake-file',
  'dsh-fake-workspace': 'workspace:*',
  'dsh-fake-offline': '^4.0.0',    // 用例 ⑥：registry 不可达
}

writeFileSync(join(tempDir, 'cordis.yml'), '[]\n')
writeFileSync(join(tempDir, 'cordis.patch.yml'), '[]\n')
writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
  name: 'dsh-profile-update-mock',
  private: true,
  dependencies: DEPS,
}))

/** 在临时 profile 里写一个"已安装"的包并返回其路径。 */
function install(name, version) {
  const dir = join(nm, ...name.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version, description: name }))
  return dir
}
for (const [name, spec] of Object.entries(DEPS)) {
  install(name, name === 'dsh-fake-pinned' ? '2.0.2' : '1.0.0')
}
function versionOf(name) {
  return JSON.parse(readFileSync(join(nm, ...name.split('/'), 'package.json'), 'utf8')).version
}

// ── 宿主 ctx / 请求 ────────────────────────────────────────────────────
const registrations = []
/** 假 cordis 服务表（ctx.get(name)）——用例里注入 hmr。 */
const services = {}
function setServices(next) {
  for (const key of Object.keys(services)) delete services[key]
  Object.assign(services, next)
}
function fakeCtx() {
  const entries = [
    {
      id: 'include',
      options: { name: 'cordis:include', config: { path: pathToFileURL(join(tempDir, 'cordis.yml')).href } },
      disabled: false,
      fiber: { state: 2 },
    },
    // 每个假依赖都挂一条 loader 条目：清单采集要靠它才认得这些包
    ...Object.keys(DEPS).map((name) => ({
      id: name,
      options: { id: name, name },
      disabled: false,
      fiber: { state: 2 },
    })),
  ]
  return {
    loader: { entries() { return entries } },
    webServer: { register(opts) { registrations.push(opts) } },
    effect(fn) { const d = fn(); return d ?? (() => {}) },
    logger() { return { info() {}, warn() {}, error() {} } },
    // cordis 的服务注册表：测试通过 setServices() 注入假的 hmr
    get(name) { return services[name] },
  }
}
function makeReq({ method = 'GET', url = '/', headers = {} } = {}) {
  const listeners = {}
  const req = {
    method,
    url,
    headers: Object.assign({ host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:3080' }, headers),
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
  const res = { status: 0, body: '', onEnd: null }
  res.writeHead = (code) => { res.status = code }
  res.end = (chunk) => { res.body = String(chunk ?? ''); if (res.onEnd) res.onEnd() }
  return res
}

/** 调用一次路由并等到响应真正写完（handler 本身是 async 但不返回 promise）。 */
function callHandler(reg, req) {
  const res = makeRes()
  const done = new Promise((resolve) => { res.onEnd = resolve })
  reg.handler(req, res)
  return done.then(() => res)
}

// ── 注入点 / npm 伪造 ──────────────────────────────────────────────────
function installFetchStub(registry = {}) {
  const previous = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    const name = decodeURIComponent(String(url).replace(/^.*registry\.npmjs\.org\//, '').replace(/\/latest.*$/, ''))
    if (!(name in registry)) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => ({ version: registry[name] }) }
  }
  return { calls, restore() { globalThis.fetch = previous } }
}

/** 注入假命令；返回 { calls, restore }。calls[i] = { cmd, args }。 */
function installRunCommandStub(handler) {
  const previous = globalThis.__runcatRunCommand
  const calls = []
  globalThis.__runcatRunCommand = async (cmd, args) => {
    calls.push({ cmd, args: args.slice() })
    return await handler(cmd, args)
  }
  return { calls, restore() { if (previous === undefined) delete globalThis.__runcatRunCommand; else globalThis.__runcatRunCommand = previous } }
}

/** 每次 apply 注册一个 handler；取【本次 apply】注册的那个，别拿全局最后一个。 */
async function freshServer() {
  const mod = await import(PLUGIN_URL)
  const before = registrations.length
  mod.apply(fakeCtx())
  return registrations[before]
}

async function callUpdate(name, reg) {
  const server = reg ?? await freshServer()
  const req = makeReq({ method: 'POST', url: '/runcat-api/update' })
  req._feed({ name })
  const res = await callHandler(server, req)
  return { status: res.status, body: JSON.parse(res.body) }
}

/** 调任意 POST 路由（restart / apply-changes）。 */
async function callPost(path, payload, reg) {
  const server = reg ?? await freshServer()
  const req = makeReq({ method: 'POST', url: path })
  req._feed(payload ?? {})
  const res = await callHandler(server, req)
  return { status: res.status, body: JSON.parse(res.body) }
}

// ── 用例 ───────────────────────────────────────────────────────────────

// ① 本 bug 的钉子：实际传给 dsh 的 argv 必须带 name@latest（范围 specifier）
test('update: 范围 specifier → argv 带 name@<latest>（不带版本就会空转）', async () => {
  const npm = installFetchStub({ 'dsh-fake-npm': '1.2.0' })
  const stub = installRunCommandStub(() => ({ code: 0, stdout: 'Done', stderr: '' }))
  try {
    const { body } = await callUpdate('dsh-fake-npm')
    assert.equal(stub.calls.length, 1, '应当执行一次命令')
    assert.equal(stub.calls[0].cmd, 'dsh')
    assert.deepEqual(stub.calls[0].args, ['plugin', '--profile', PROFILE_NAME, 'add', 'dsh-fake-npm@1.2.0'])
    assert.equal(body.ok, false, '命令空转（版本未变）不得报成功')
    assert.equal(body.code, 'VERSION_MISMATCH')
    assert.equal(body.installed_version, '1.0.0')
    assert.equal(body.latest_version, '1.2.0')
  } finally { stub.restore(); npm.restore() }
})

// ①b 精确 specifier 同样必须带版本
test('update: 精确 specifier → argv 带 name@<latest>，成功后 from→to 可读', async () => {
  const npm = installFetchStub({ 'dsh-fake-pinned': '2.0.4' })
  const stub = installRunCommandStub((_cmd, args) => {
    const spec = args[args.length - 1]
    assert.equal(spec, 'dsh-fake-pinned@2.0.4')
    install('dsh-fake-pinned', '2.0.4')   // 模拟 pnpm 真的装了
    return { code: 0, stdout: 'Packages: +1', stderr: '' }
  })
  try {
    const { body } = await callUpdate('dsh-fake-pinned')
    assert.equal(body.ok, true)
    assert.equal(body.from_version, '2.0.2')
    assert.equal(body.to_version, '2.0.4')
    assert.equal(body.need_restart, true)
    assert.equal(versionOf('dsh-fake-pinned'), '2.0.4')
  } finally {
    stub.restore(); npm.restore()
    install('dsh-fake-pinned', '2.0.2')   // 还原，避免影响其他用例
  }
})

// ② 命令 exit 0 但版本不变 → 明确的失败码，而不是静默 ok:true
test('update: exit 0 但版本不变 → VERSION_MISMATCH（不静默成功）', async () => {
  const npm = installFetchStub({ 'dsh-fake-mismatch': '3.1.0' })
  const stub = installRunCommandStub(() => ({ code: 0, stdout: 'Already up to date', stderr: '' }))
  try {
    const { body } = await callUpdate('dsh-fake-mismatch')
    assert.equal(body.ok, false)
    assert.equal(body.code, 'VERSION_MISMATCH')
    assert.equal(body.exit_code, undefined, 'VERSION_MISMATCH 不该被当成命令失败')
    assert.match(String(body.command), /add dsh-fake-mismatch@3\.1\.0$/)
  } finally { stub.restore(); npm.restore() }
})

// ③ 本地链接依赖 → 根本不 spawn pnpm
for (const name of ['dsh-fake-link', 'dsh-fake-file', 'dsh-fake-workspace']) {
  test('update: ' + name + '（本地链接）→ 不执行任何命令', async () => {
    const npm = installFetchStub({ [name]: '9.9.9' })
    const stub = installRunCommandStub(() => { throw new Error('不得 spawn：本地链接依赖不能走 npm add') })
    try {
      const { body } = await callUpdate(name)
      assert.equal(body.ok, false)
      assert.equal(body.code, 'NOT_UPDATABLE')
      assert.equal(stub.calls.length, 0)
      assert.equal(npm.calls.length, 0, '拒绝前不该先打 npm registry')
    } finally { stub.restore(); npm.restore() }
  })
}

// ④ npm latest 等于已装版本 → 成功/中性结果，而不是"更新失败"
//    同一实例先扫描（latest 进缓存）→ 再点更新：本地已是 1.2.0，不该再装一遍。
test('update: 已扫描到 latest == 已装版本 → ALREADY_LATEST（不是失败）', async () => {
  install('dsh-fake-npm', '1.2.0')
  const npm = installFetchStub({ 'dsh-fake-npm': '1.2.0' })
  const stub = installRunCommandStub(() => { throw new Error('不该 spawn：无版本可更新') })
  try {
    const reg = await freshServer()
    process.env.RUNCAT_SKIP_UPDATE_SCAN = '0'
    const scanRes = await callHandler(reg, makeReq({ url: '/runcat-api/inventory' }))
    process.env.RUNCAT_SKIP_UPDATE_SCAN = '1'
    assert.equal(scanRes.status, 200, 'scan request failed: ' + scanRes.body)
    assert.ok(npm.calls.some((u) => /dsh-fake-npm\/latest/.test(u)),
      'scan did not query dsh-fake-npm; fetch=' + JSON.stringify(npm.calls) + ' body=' + scanRes.body)

    const { body } = await callUpdate('dsh-fake-npm', reg)
    assert.equal(body.ok, true, JSON.stringify(body))
    assert.equal(body.code, 'ALREADY_LATEST')
    assert.equal(body.need_restart, false)
    assert.equal(body.to_version, '1.2.0')
    assert.equal(stub.calls.length, 0, '已是最新就不该再装一遍')
  } finally {
    stub.restore(); npm.restore()
    install('dsh-fake-npm', '1.0.0')
  }
})

// ⑤ 命令失败 → UPDATE_FAILED（保留 exit code 与输出尾巴）
test('update: 命令非 0 退出 → UPDATE_FAILED', async () => {
  const npm = installFetchStub({ 'dsh-fake-mismatch': '3.1.0' })
  const stub = installRunCommandStub(() => ({ code: 1, stdout: '', stderr: 'ERR_PNPM_NO_MATCHING_VERSION' }))
  try {
    const { body } = await callUpdate('dsh-fake-mismatch')
    assert.equal(body.ok, false)
    assert.equal(body.code, 'UPDATE_FAILED')
    assert.equal(body.exit_code, 1)
    assert.match(body.stderr_tail, /NO_MATCHING_VERSION/)
  } finally { stub.restore(); npm.restore() }
})

// ⑥ npm 查询失败（离线）时不得谎报成功
test('update: npm 不可达 → 不谎报成功（回退不带 @，仍走安装后校验）', async () => {
  const npm = installFetchStub({})            // 全部 404
  const stub = installRunCommandStub(() => ({ code: 0, stdout: '', stderr: '' }))
  try {
    const { body } = await callUpdate('dsh-fake-offline')
    assert.equal(stub.calls.length, 1)
    assert.deepEqual(stub.calls[0].args, ['plugin', '--profile', PROFILE_NAME, 'add', 'dsh-fake-offline'])
    assert.equal(body.ok, true, '拿不到目标版本时无法判定，按命令结果放行但不谎报版本')
    assert.equal(body.need_restart, true)
  } finally { stub.restore(); npm.restore() }
})

// ⑦ HMR 可用时：热应用成功 → applied=true / need_restart=false（不用重启）
test('update: HMR 可用 → 热应用成功，不再要求重启', async () => {
  const npm = installFetchStub({ 'dsh-fake-pinned': '2.0.4' })
  const stub = installRunCommandStub(() => {
    install('dsh-fake-pinned', '2.0.4')
    return { code: 0, stdout: '', stderr: '' }
  })
  let reconciledIds = null
  setServices({
    hmr: {
      async reconcileProfile(ids) { reconciledIds = ids; return {} },
    },
  })
  try {
    const { body } = await callUpdate('dsh-fake-pinned')
    assert.equal(body.ok, true, JSON.stringify(body))
    assert.equal(body.applied, true)
    assert.equal(body.need_restart, false, '热应用成功就不该再要求重启')
    assert.deepEqual(reconciledIds, ['dsh-fake-pinned'], 'reconcile 应带上该包的条目 id')
  } finally {
    stub.restore(); npm.restore(); setServices({})
    install('dsh-fake-pinned', '2.0.2')
  }
})

// ⑧ HMR 表示仍需重启 → applied=false + 原因
test('update: HMR 表示仍需重启 → need_restart=true 且带原因', async () => {
  const npm = installFetchStub({ 'dsh-fake-mismatch': '3.1.0' })
  const stub = installRunCommandStub(() => {
    install('dsh-fake-mismatch', '3.1.0')
    return { code: 0, stdout: '', stderr: '' }
  })
  setServices({ hmr: { async reconcileProfile() { return { restartReason: 'host-code' } } } })
  try {
    const { body } = await callUpdate('dsh-fake-mismatch')
    assert.equal(body.ok, true, JSON.stringify(body))
    assert.equal(body.applied, false)
    assert.equal(body.need_restart, true)
    assert.equal(body.apply_reason, 'host-code')
  } finally {
    stub.restore(); npm.restore(); setServices({})
    install('dsh-fake-mismatch', '1.0.0')
  }
})

// ⑨ /apply-changes：没有 hmr 服务 → HMR_UNAVAILABLE（不假装成功）
test('apply-changes: 无 HMR 服务 → HMR_UNAVAILABLE', async () => {
  setServices({})
  const { body } = await callPost('/runcat-api/apply-changes')
  assert.equal(body.ok, false)
  assert.equal(body.code, 'HMR_UNAVAILABLE')
  assert.equal(body.need_restart, true)
})

// ⑩ /restart：桌面端（electron）→ 明确不支持，且**不能**杀进程
test('restart: 桌面端 → DESKTOP_RESTART_UNSUPPORTED（不当场退出）', async () => {
  const hadElectron = Object.prototype.hasOwnProperty.call(process.versions, 'electron')
  const saved = process.versions.electron
  Object.defineProperty(process.versions, 'electron', { value: '38.0.0', configurable: true })
  try {
    const { body } = await callPost('/runcat-api/restart')
    assert.equal(body.ok, false, JSON.stringify(body))
    assert.equal(body.code, 'DESKTOP_RESTART_UNSUPPORTED')
    assert.match(String(body.detail), /重新打开/)
  } finally {
    if (hadElectron) Object.defineProperty(process.versions, 'electron', { value: saved, configurable: true })
    else delete process.versions.electron
  }
})

// ── 汇总 ───────────────────────────────────────────────────────────────
const timer = setTimeout(() => {
  console.error('  FAIL 用例超时（5s）')
  process.exit(1)
}, 5000)
queue.then(() => {
  clearTimeout(timer)
  rmSync(tempDir, { recursive: true, force: true })
  console.log('\n结果：' + passed + ' 通过，' + failed + ' 失败')
  process.exit(failed === 0 ? 0 : 1)
})

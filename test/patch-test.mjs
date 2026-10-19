/**
 * dsh-plugin-runcat-inventory —— 补丁层写回回归测试（2026-10-19 实测缺陷）
 *
 * 覆盖三件事：
 *   A. `!!js` 自定义标记：只要 cordis.patch.yml 里出现一句 `!!js`，旧实现会让
 *      `yaml.load()` 抛 `unknown tag !<tag:yaml.org,2002:js>`，**启用/停用整片失败**。
 *   B. 写回的保真度：重新序列化必须**保留 `!!js` 里的原始代码**（旧实现会静默丢掉
 *      标签 → 用户手写的取值逻辑变成普通字符串），并**保留用户手写注释**。
 *   C. 找不到 dsh CLI 时必须报 `DSH_CLI_NOT_FOUND`，而不是伪装成普通失败
 *      （2026-10-19 实测：桌面端宿主进程 PATH 里没有 dsh，更新/卸载全部
 *      "不是内部或外部命令"）。
 *
 * 运行：node test/patch-test.mjs
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PLUGIN_URL = pathToFileURL(join(REPO_ROOT, 'lib', 'index.js')).href

let passed = 0
let failed = 0
let queue = Promise.resolve()
function test(name, fn) {
  queue = queue
    .then(fn)
    .then(() => { passed++; console.log('  ok ' + name) })
    .catch((error) => { failed++; console.error('  FAIL ' + name + '\n    ' + (error?.stack || error)) })
}

const JS_CODE = "(()=>{try{return((process.getBuiltinModule('node:fs').readFileSync(process.env.USERPROFILE+'/.dsh/.credentials.yaml','utf8').match(/^TOKEN: *(.*)$/m)||[])[1]||'').trim()}catch{return''}})()"

const tempDir = mkdtempSync(join(tmpdir(), 'runcat-patch-'))
const nm = join(tempDir, 'node_modules')
const patchPath = join(tempDir, 'cordis.patch.yml')

/** 带 !!js、带用户注释、带一个已存在条目的真实形态补丁文件 */
const PATCH_FIXTURE = `# Your patch layer for this dsh profile, applied after every bundle layer:
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
# ---------------------------------------------------------------------------
# 这里是用户手写的大段说明，重写补丁层时不能丢。
# ---------------------------------------------------------------------------
- id: some-mcp
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: demo
    env:
      DEMO_TOKEN: !!js ${JSON.stringify(JS_CODE)}
    enabled: true
- id: theme
  name: '@deepseek-ai/dsh-client-ui-theme'
  config:
    preference: system
`

writeFileSync(join(tempDir, 'cordis.yml'), '[]\n')
writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'dsh-profile-patch-mock', private: true, dependencies: {} }))
mkdirSync(join(nm, 'js-yaml'), { recursive: true })
// 复用真实 js-yaml（与 host 同一套解析器），路径按需探测
function realJsYaml() {
  const candidates = [
    process.env.RUNCAT_TEST_JS_YAML,
    join(REPO_ROOT, 'node_modules', 'js-yaml'),
    process.env.DSH_HOME ? join(process.env.DSH_HOME, 'profiles', 'desktop', 'node_modules', 'js-yaml') : null,
    process.env.DSH_HOME ? join(process.env.DSH_HOME, 'profiles', 'node_modules', 'js-yaml') : null,
    process.env.USERPROFILE ? join(process.env.USERPROFILE, '.dsh', 'profiles', 'desktop', 'node_modules', 'js-yaml') : null,
    process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node_modules', 'js-yaml') : null,
  ].filter(Boolean)
  return candidates.find((p) => existsSync(join(p, 'package.json'))) ?? null
}
const JS_YAML_DIR = realJsYaml()
if (JS_YAML_DIR !== null) {
  // 用 junction 让临时 profile 能 require 到真实 js-yaml
  const { symlinkSync } = await import('node:fs')
  rmSync(join(nm, 'js-yaml'), { recursive: true, force: true })
  try { symlinkSync(JS_YAML_DIR, join(nm, 'js-yaml'), 'junction') } catch { /* 已有 */ }
} else {
  console.log('  warn: 找不到 js-yaml，跳过补丁写回用例')
  process.exit(0)
}

const registrations = []
function fakeCtx() {
  return {
    loader: {
      entries() {
        return [{
          id: 'include',
          options: { name: 'cordis:include', config: { path: pathToFileURL(join(tempDir, 'cordis.yml')).href } },
          disabled: false,
          fiber: { state: 2 },
        }]
      },
    },
    webServer: { register(opts) { registrations.push(opts) } },
    effect(fn) { const d = fn(); return d ?? (() => {}) },
    logger() { return { info() {}, warn() {}, error() {} } },
  }
}
async function freshServer() {
  const mod = await import(PLUGIN_URL)
  const before = registrations.length
  mod.apply(fakeCtx())
  return registrations[before]
}
function makeReq(payload) {
  const listeners = {}
  const req = {
    method: 'POST',
    url: '/runcat-api/set-enabled',
    headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:3080' },
    on(ev, fn) { listeners[ev] = fn; return req },
    destroy() {},
    _feed() {
      setImmediate(() => {
        if (listeners.data) listeners.data(Buffer.from(JSON.stringify(payload)))
        if (listeners.end) listeners.end()
      })
    },
  }
  return req
}
async function callSetEnabled(payload) {
  const reg = await freshServer()
  const res = { status: 0, body: '' }
  res.writeHead = (c) => { res.status = c }
  res.end = (b) => { res.body = String(b ?? '') }
  const req = makeReq(payload)
  req._feed()
  await new Promise((resolve) => {
    const original = res.end
    res.end = (b) => { original(b); resolve() }
    reg.handler(req, res)
  })
  return { status: res.status, body: JSON.parse(res.body) }
}

// ── A + B：!!js 能读、能写回、代码与注释都不丢 ─────────────────────────
test('set-enabled: 补丁文件含 !!js 时仍能写入（不再 PATCH_PARSE_FAILED）', async () => {
  writeFileSync(patchPath, PATCH_FIXTURE, 'utf8')
  const { body } = await callSetEnabled({ id: 'theme', name: '@deepseek-ai/dsh-client-ui-theme', enabled: false })
  assert.equal(body.ok, true, JSON.stringify(body))
})

test('set-enabled: 写回后 !!js 原始代码逐字保留', async () => {
  const after = readFileSync(patchPath, 'utf8')
  assert.ok(after.includes('!!js'), '应当仍保留 !!js 标记')
  assert.ok(!/JS\d|\\0JS/.test(after), '不得泄漏内部占位符')
  // 取出写回后的代码，与原文逐字比较
  const m = /DEMO_TOKEN: !!js ("(?:[^"\\]|\\.)*")/.exec(after)
  assert.ok(m, '应当找到 DEMO_TOKEN: !!js "…"')
  assert.equal(JSON.parse(m[1]), JS_CODE, '!!js 里的代码必须一字不差')
})

test('set-enabled: 写回后用户手写注释保留', async () => {
  const after = readFileSync(patchPath, 'utf8')
  assert.ok(after.includes('这里是用户手写的大段说明'), '用户注释不得被删掉')
  assert.ok(after.includes('Your patch layer for this dsh profile'), '文件头注释不得被删掉')
})

test('set-enabled: 写回结果仍是可解析的 YAML，且停用补丁已生效', async () => {
  const after = readFileSync(patchPath, 'utf8')
  const req = (await import('node:module')).createRequire(pathToFileURL(join(tempDir, 'package.json')))
  const yaml = await import(pathToFileURL(req.resolve('js-yaml')).href)
  const JsType = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', resolve: () => true, construct: (d) => String(d) })
  const schema = yaml.DEFAULT_SCHEMA.extend([JsType])
  const doc = yaml.load(after, { schema })
  assert.ok(Array.isArray(doc) && doc.length >= 3, '顶层仍是数组且未丢条目')
  const disable = doc.find((e) => e && e.id === 'theme' && e.disabled === true)
  assert.ok(disable, '应当写入 {id: theme, disabled: true} 补丁')
  const mcp = doc.find((e) => e && e.id === 'some-mcp')
  assert.equal(mcp.config.env.DEMO_TOKEN, JS_CODE, '重新解析后 !!js 代码与原文一致')
})

test('set-enabled: 再启用（移除停用补丁）同样保真', async () => {
  const { body } = await callSetEnabled({ id: 'theme', name: '@deepseek-ai/dsh-client-ui-theme', enabled: true })
  assert.equal(body.ok, true, JSON.stringify(body))
  const after = readFileSync(patchPath, 'utf8')
  assert.ok(!/disabled: true/.test(after), '启用后不应再有 disabled: true')
  assert.ok(after.includes('!!js'), '!!js 标记仍应保留')
  assert.ok(after.includes('这里是用户手写的大段说明'), '注释仍应保留')
  assert.ok(after.endsWith('\n'), '文件末尾的换行应当保留')
})

// ── A2：2026-10-19 用户实测缺陷 —— 不依赖 js-yaml 也必须能启用/停用 ────
// 当时宿主里 js-yaml 解析不到，set-enabled 直接返回 YAML_UNAVAILABLE，
// 界面表现就是"点了启用/停用完全没反应"。现在改成纯文本编辑，不再需要它。
test('set-enabled: 没有 js-yaml 的 profile 也能写停用补丁', async () => {
  const bare = mkdtempSync(join(tmpdir(), 'runcat-bare-'))
  writeFileSync(join(bare, 'cordis.yml'), '[]\n')
  writeFileSync(join(bare, 'package.json'), JSON.stringify({ name: 'bare', private: true, dependencies: {} }))
  writeFileSync(join(bare, 'cordis.patch.yml'), '# user header\n[]\n')
  const mod = await import(PLUGIN_URL + '?bare=1') // 新实例，避免共享 yaml 缓存
  const regs = []
  mod.apply({
    loader: {
      entries() {
        return [{ id: 'i', options: { name: 'cordis:include', config: { path: pathToFileURL(join(bare, 'cordis.yml')).href } }, disabled: false, fiber: { state: 2 } }]
      },
    },
    webServer: { register(o) { regs.push(o) } },
    effect(fn) { const d = fn(); return d ?? (() => {}) },
    logger() { return { info() {}, warn() {}, error() {} } },
    get() { return undefined },
  })
  const res = { status: 0, body: '', writeHead(c) { this.status = c }, end(b) { this.body = String(b); done() } }
  let done
  const finished = new Promise((r) => { done = r })
  const listeners = {}
  const req = {
    method: 'POST', url: '/runcat-api/set-enabled',
    headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:3080' },
    on(ev, fn) { listeners[ev] = fn; return req },
    destroy() {},
  }
  regs[regs.length - 1].handler(req, res)
  setImmediate(() => {
    listeners.data(Buffer.from(JSON.stringify({ id: 'x', name: 'dsh-x', enabled: false })))
    listeners.end()
  })
  await finished
  const body = JSON.parse(res.body)
  assert.equal(body.ok, true, JSON.stringify(body))
  const text = readFileSync(join(bare, 'cordis.patch.yml'), 'utf8')
  assert.match(text, /- id: x/)
  assert.match(text, /disabled: true/)
  assert.match(text, /^# user header/)
  rmSync(bare, { recursive: true, force: true })
})

// ── C：找不到 dsh CLI 时的错误码 ───────────────────────────────────────
test('resolveDshCli：桌面端布局识别为 <exe> + asar 内 cli.js，且不需要 shell', async () => {
  const mod = await import(PLUGIN_URL)
  const fake = join(tempDir, 'fake-desktop')
  const fakeExe = join(fake, 'DeepSeek Harness.exe')
  const entry = join(fake, 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')
  mkdirSync(dirname(entry), { recursive: true })
  writeFileSync(entry, '// stub')
  writeFileSync(fakeExe, '')
  const savedExecPath = process.execPath
  const savedResources = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
  const savedEnv = process.env.RUNCAT_DSH_CLI
  try {
    Object.defineProperty(process, 'execPath', { value: fakeExe, configurable: true })
    Object.defineProperty(process, 'resourcesPath', { value: join(fake, 'resources'), configurable: true })
    delete process.env.RUNCAT_DSH_CLI
    mod.__resetDshCliCache()
    const cli = mod.__resolveDshCli()
    assert.ok(cli, '应当解析出桌面端 CLI')
    assert.equal(cli.command, fakeExe, '应直接用宿主可执行文件')
    assert.deepEqual(cli.prefix, [entry], '应先传 asar 内的 cli.js')
    assert.equal(cli.shell, false, '直接起可执行文件不需要 shell')
    assert.equal(cli.kind, 'desktop-electron')
  } finally {
    Object.defineProperty(process, 'execPath', { value: savedExecPath, configurable: true })
    if (savedResources) Object.defineProperty(process, 'resourcesPath', savedResources)
    else delete process.resourcesPath
    if (savedEnv === undefined) delete process.env.RUNCAT_DSH_CLI
    else process.env.RUNCAT_DSH_CLI = savedEnv
    mod.__resetDshCliCache()
  }
})

test('resolveDshCli：RUNCAT_DSH_CLI 指定 .cmd 时走 shell', async () => {
  const mod = await import(PLUGIN_URL)
  const shim = join(tempDir, 'fake-desktop', 'dsh.cmd')
  writeFileSync(shim, '@echo off\n')
  const saved = process.env.RUNCAT_DSH_CLI
  try {
    process.env.RUNCAT_DSH_CLI = shim
    mod.__resetDshCliCache()
    const cli = mod.__resolveDshCli()
    assert.ok(cli, '应当解析出用户指定的 shim')
    assert.equal(cli.command, shim)
    assert.equal(cli.shell, true, '.cmd 必须交给 shell')
  } finally {
    if (saved === undefined) delete process.env.RUNCAT_DSH_CLI
    else process.env.RUNCAT_DSH_CLI = saved
    mod.__resetDshCliCache()
  }
})

test('update/uninstall: dsh CLI 不可用 → DSH_CLI_NOT_FOUND（而不是笼统失败）', async () => {
  const { spawnSync } = await import('node:child_process')
  // 子进程里把"宿主可执行文件"指到不存在的路径、PATH 摘空，验证真实的"找不到 dsh"分支
  const script = `
    Object.defineProperty(process, 'execPath', { value: 'X:/no-such-host/node.exe', configurable: true })
    delete process.env.RUNCAT_DSH_CLI
    process.env.PATH = ${JSON.stringify(join(tempDir, 'empty-path'))}
    delete globalThis.__runcatRunCommand
    const { pathToFileURL } = await import('node:url')
    const mod = await import(${JSON.stringify(PLUGIN_URL)})
    const regs = []
    mod.apply({
      loader: { entries() { return [{ id: 'i', options: { name: 'cordis:include', config: { path: ${JSON.stringify(pathToFileURL(join(tempDir, 'cordis.yml')).href)} } }, disabled: false, fiber: { state: 2 } }] } },
      webServer: { register(o) { regs.push(o) } },
      effect(fn) { const d = fn(); return d ?? (() => {}) },
      logger() { return { info() {}, warn() {}, error() {} } },
    })
    const reg = regs[regs.length - 1]
    let done
    const finished = new Promise((r) => { done = r })
    const res = { status: 0, body: '', writeHead(c) { this.status = c }, end(b) { this.body = String(b); done() } }
    const req = {
      method: 'POST', url: '/runcat-api/update',
      headers: { host: '127.0.0.1:1', 'sec-fetch-site': 'same-origin', origin: 'http://127.0.0.1:1' },
      on(ev, fn) {
        if (ev === 'data') setImmediate(() => fn(Buffer.from(JSON.stringify({ name: 'dsh-fake-npm' }))))
        if (ev === 'end') setImmediate(fn)
        return req
      },
      destroy() {},
    }
    reg.handler(req, res)
    await finished
    console.log(res.body)
  `
  mkdirSync(join(tempDir, 'empty-path'), { recursive: true })
  writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-patch-mock',
    private: true,
    dependencies: { 'dsh-fake-npm': '^1.0.0' },
  }))
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: REPO_ROOT, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, RUNCAT_DSH_CLI: '' },
  })
  if (out.status !== 0) {
    throw new Error('子进程失败：' + (out.stderr || out.stdout).slice(0, 600))
  }
  const body = JSON.parse(out.stdout.trim().split('\n').pop())
  assert.equal(body.ok, false, JSON.stringify(body))
  assert.equal(body.code, 'DSH_CLI_NOT_FOUND', JSON.stringify(body))
  assert.match(String(body.detail), /RUNCAT_DSH_CLI/)
})

queue.then(() => {
  rmSync(tempDir, { recursive: true, force: true })
  console.log('\n结果：' + passed + ' 通过，' + failed + ' 失败')
  process.exit(failed === 0 ? 0 : 1)
})

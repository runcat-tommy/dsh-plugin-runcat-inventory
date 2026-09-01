/**
 * dsh-plugin-runcat-inventory —— Host 半端（逃咪-插件总览）
 *
 * 职责：
 *   1. 读取 loader 的实时条目（id / 模块名 / 启用状态 / Cordis fiber 状态）
 *      + 从各包 package.json 补充描述、版本，从 profile 清单判定来源。
 *   2. 提供 /runcat-api/inventory（GET）与 /runcat-api/set-enabled（POST）。
 *   3. 启用/停用 = 编辑 profile 的 cordis.patch.yml（用户覆盖层）：
 *      写入 {id, name, disabled: true} 补丁即可停用；移除该补丁即恢复。
 *      DSH 通过 HMR 监听该文件，改动热生效，无需重启 Web UI。
 *
 * 通信模型与 dsh-plugins-market 一致：注入 webServer，注册 prefix 路由，
 * 浏览器半端用同源 fetch 调用；路由做 loopback 信任校验防 CSRF。
 *
 * 注意：本插件可能以 link: 方式装进 profile（真实路径在工作区），因此
 * js-yaml 采用惰性解析——锚定在 profile 目录（真实安装链）上 require，
 * 而不是在模块顶层静态 import。
 */

import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'

export const inject = ['webServer', 'loader']

const API_PREFIX = '/runcat-api'
const PATCH_FILENAME = 'cordis.patch.yml'
const COMMAND_TIMEOUT_MS = 120000
const LATEST_TTL_MS = 3600000      // 版本检测成功缓存 1 小时
const LATEST_FAIL_TTL_MS = 30000   // 失败冷却 30s
const SCAN_BATCH_SIZE = 4          // 分批扫描：每批 4 个
const SCAN_BATCH_GAP_MS = 200      // 批间间隔
const SCAN_REQUEST_TIMEOUT_MS = 8000

/** 本插件自身包名：其"来源"列显示仓库主页地址（用户指定）。 */
const PLUGIN_NAME = 'dsh-plugin-runcat-inventory'

/** Runtime mirror: FiberState 是跨包 const enum（与官方 inventory 一致）。 */
const FIBER_PHASE = {
  0: 'pending',   // PENDING
  1: 'loading',   // LOADING
  2: 'active',    // ACTIVE
  3: 'failed',    // FAILED
  4: null,        // DISPOSED
  5: 'unloading', // UNLOADING
}

// ── 极简 semver 比较（保持零依赖）─────────────────────────────────────
function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(value).trim())
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] ?? '' }
}

/** a > b → 1；a < b → -1；相等/无法解析 → 0。 */
function compareVersions(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return 0
  for (const key of ['major', 'minor', 'patch']) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1
  }
  if (pa.pre === pb.pre) return 0
  if (pa.pre === '') return 1  // 正式版 > 预发布
  if (pb.pre === '') return -1
  return pa.pre < pb.pre ? -1 : 1
}

// ── js-yaml 惰性解析：优先锚定 profile 目录，回退到本模块 ─────────────
let yamlPromise = null
function getYaml(profileDir) {
  if (yamlPromise !== null) return yamlPromise
  yamlPromise = (async () => {
    const anchors = []
    if (profileDir) {
      try {
        anchors.push(createRequire(pathToFileURL(join(profileDir, 'package.json'))))
      } catch { /* 忽略 */ }
    }
    try {
      anchors.push(createRequire(import.meta.url))
    } catch { /* 忽略 */ }
    for (const req of anchors) {
      try {
        const resolved = req.resolve('js-yaml')
        // Windows 下 resolve 返回盘符路径，import() 需要 file URL
        return await import(pathToFileURL(resolved).href)
      } catch { /* 换下一个锚点 */ }
    }
    throw new Error('js-yaml 不可用（无法解析）')
  })()
  return yamlPromise
}

export function apply(ctx) {
  const logger = ctx.logger('runcat-inventory')
  /** 本进程内已卸载的插件名（重启前用于在列表中标记，避免重复操作）。 */
  const uninstalledNames = new Set()
  /** 本进程内已更新、待重启生效的插件名。 */
  const updatedNames = new Set()
  /** 串行更新队列：正在进行更新的包名（null = 空闲）。 */
  let updateInFlight = null
  /** 版本检测缓存：name → { version, ts }（成功 1h / 失败 30s）。 */
  const latestCache = new Map()

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /** 查询 npm registry 的 latest 版本（带超时与缓存）。 */
  async function fetchLatestVersion(name) {
    const now = Date.now()
    const hit = latestCache.get(name)
    if (hit) {
      const ttl = hit.version !== null ? LATEST_TTL_MS : LATEST_FAIL_TTL_MS
      if (now - hit.ts < ttl) return hit.version
    }
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), SCAN_REQUEST_TIMEOUT_MS)
      const res = await fetch('https://registry.npmjs.org/' + name + '/latest', {
        signal: controller.signal,
        headers: { 'User-Agent': 'dsh-plugin-runcat-inventory' },
      })
      clearTimeout(timer)
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const data = await res.json()
      const version = typeof data?.version === 'string' ? data.version : null
      latestCache.set(name, { version, ts: now })
      return version
    } catch {
      latestCache.set(name, { version: null, ts: now })
      return null
    }
  }

  /** 分批扫描候选包：每批 4 个、批间 200ms；本插件自身排第一批。 */
  async function scanUpdates(candidates) {
    const ordered = candidates.slice()
    const selfIndex = ordered.indexOf(PLUGIN_NAME)
    if (selfIndex > 0) ordered.splice(selfIndex, 1), ordered.unshift(PLUGIN_NAME)
    const results = new Map()
    for (let i = 0; i < ordered.length; i += SCAN_BATCH_SIZE) {
      const batch = ordered.slice(i, i + SCAN_BATCH_SIZE)
      await Promise.all(batch.map(async (name) => {
        const latest = await fetchLatestVersion(name)
        if (latest !== null) results.set(name, latest)
      }))
      if (i + SCAN_BATCH_SIZE < ordered.length) await sleep(SCAN_BATCH_GAP_MS)
    }
    return results
  }

  // ── 小工具（来自 market 插件的同款信任校验）─────────────────────────
  function header(headers, name) {
    const value = headers[name]
    return Array.isArray(value) ? value[0] : value
  }

  function isLoopbackHostname(hostname) {
    if (hostname === 'localhost' || hostname === '::1') return true
    if (hostname.startsWith('127.')) return true
    return false
  }

  function isTrustedApiRequest(req) {
    const host = header(req.headers, 'host')
    if (host === undefined) return false
    let hostUrl
    try { hostUrl = new URL('http://' + host) } catch { return false }
    if (!isLoopbackHostname(hostUrl.hostname)) return false
    if (header(req.headers, 'sec-fetch-site') === 'cross-site') return false
    const origin = header(req.headers, 'origin')
    if (origin === undefined) return true
    try { return new URL(origin).host === hostUrl.host } catch { return false }
  }

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      let size = 0
      const chunks = []
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > limit) {
          reject(new Error('body too large'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })
  }

  function sendJson(res, code, obj) {
    const body = JSON.stringify(obj)
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    res.end(body)
  }

  // ── 定位 profile 目录 ────────────────────────────────────────────────
  // 根 Include 条目（name='cordis:include'）的 config.path 就是本 profile
  // 的 cordis.yml 绝对路径（file URL），其所在目录即 profile 目录。
  function profileDirOf() {
    for (const entry of ctx.loader.entries()) {
      if (entry.options.name !== 'cordis:include') continue
      const path = entry.options.config?.path
      if (typeof path !== 'string') return null
      try { return dirname(fileURLToPath(path)) } catch { return null }
    }
    return null
  }

  // ── 解析某个模块名对应的 package.json ──────────────────────────────
  function resolvePackage(name) {
    if (typeof name !== 'string' || name.length === 0) return null
    const profileDir = profileDirOf()
    // 1) 锚定 profile 目录的 require（与 loader 同一条解析链）
    if (profileDir !== null) {
      try {
        const req = createRequire(pathToFileURL(join(profileDir, 'package.json')))
        const pkgPath = req.resolve(name + '/package.json')
        return JSON.parse(readFileSync(pkgPath, 'utf8'))
      } catch { /* 继续回退 */ }
      // 2) profile 级 node_modules 直读
      for (const base of [join(profileDir, 'node_modules'), join(profileDir, '..', 'node_modules')]) {
        try {
          return JSON.parse(readFileSync(join(base, name, 'package.json'), 'utf8'))
        } catch { /* 继续 */ }
      }
    }
    return null
  }

  /** 清理仓库地址：去掉 git+ 前缀与 .git 后缀。 */
  function cleanRepoUrl(url) {
    return String(url).replace(/^git\+/, '').replace(/\.git$/, '')
  }

  /**
   * 机器可读来源（kind + spec），显示文案由客户端翻译。
   * 仅【本插件】显示仓库主页地址（用户指定）；其余插件一律按安装方式
   * （profile 依赖声明）分类，不读取 repository 字段。
   */
  function sourceOf(name, manifest, pkg) {
    if (name === PLUGIN_NAME) {
      const repo = pkg?.repository
      const repoUrl = typeof repo === 'string' ? repo : repo?.url
      if (typeof repoUrl === 'string' && repoUrl.length > 0) {
        return { kind: 'repo', spec: cleanRepoUrl(repoUrl) }
      }
    }
    const spec = manifest?.dependencies?.[name]
    if (typeof spec === 'string') {
      if (/^link:/.test(spec)) return { kind: 'link', spec: spec.slice(5) }
      if (/^file:/.test(spec)) return { kind: 'file', spec: spec.slice(5) }
      if (/^github:|^git\+/.test(spec)) return { kind: 'github', spec }
      return { kind: 'npm', spec }
    }
    const bundles = manifest?.dsh?.profile?.bundles
    if (Array.isArray(bundles) && bundles.includes(name)) return { kind: 'builtin', spec: '' }
    return { kind: 'other', spec: '' }
  }

  // ── 采集清单（含更新扫描）───────────────────────────────────────────
  async function collectInventory() {
    const profileDir = profileDirOf()
    let manifest = null
    if (profileDir !== null) {
      try {
        manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
      } catch { /* 无清单也可用 */ }
    }
    // 自愈：若某插件重新成为 profile 依赖，清除"已卸载"标记
    if (manifest) {
      for (const name of [...uninstalledNames]) {
        if (manifest.dependencies?.[name]) uninstalledNames.delete(name)
      }
    }
    const rows = []
    for (const entry of ctx.loader.entries()) {
      if (entry.options.group) continue
      if (entry.options.name === 'cordis:include') continue
      const pkg = resolvePackage(entry.options.name)
      const src = sourceOf(entry.options.name, manifest, pkg)
      let config = null
      try {
        config = entry.options.config === undefined ? null : entry.options.config
      } catch { /* 保持 null */ }
      rows.push({
        id: entry.id,                    // 树内完整 id（展示用）
        patchId: entry.options.id,       // 原始 id（补丁定位用）
        name: entry.options.name,        // 模块标识符
        enabled: !entry.disabled,        // 是否启用（考虑祖先禁用）
        fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
        description: pkg?.description ?? '',
        version: pkg?.version ?? '',
        sourceKind: src.kind,
        sourceSpec: src.spec,
        uninstalled: uninstalledNames.has(entry.options.name),
        pendingRestart: updatedNames.has(entry.options.name),
        latestVersion: '',
        updateAvailable: false,
        config,
      })
    }
    // 更新扫描：仅 profile 依赖且非 link/file/builtin 的包；
    // 可用环境变量 RUNCAT_SKIP_UPDATE_SCAN=1 关闭（测试/离线环境）
    let updatesCount = 0
    if (manifest && process.env.RUNCAT_SKIP_UPDATE_SCAN !== '1') {
      const candidates = rows
        .filter((row) => manifest.dependencies?.[row.name] && !['link', 'file', 'builtin'].includes(row.sourceKind))
        .map((row) => row.name)
      if (candidates.length > 0) {
        const latestMap = await scanUpdates(candidates)
        for (const row of rows) {
          const latest = latestMap.get(row.name)
          if (typeof latest === 'string' && row.version && compareVersions(latest, row.version) > 0) {
            row.latestVersion = latest
            row.updateAvailable = true
            if (row.name !== PLUGIN_NAME) updatesCount += 1
          } else if (typeof latest === 'string') {
            row.latestVersion = latest
          }
        }
      }
    }
    return { rows, updatesCount }
  }

  // ── 启用 / 停用：编辑 cordis.patch.yml ─────────────────────────────
  // 停用 = 追加 {id, name, disabled: true} 补丁（用户覆盖层覆盖 bundle 层
  // 的 insert）；启用 = 移除我们写入的那条补丁。文件被 HMR 监听热生效。
  async function setEnabled(patchId, name, enabled) {
    if (typeof patchId !== 'string' || patchId.length === 0 ||
        typeof name !== 'string' || name.length === 0) {
      return { ok: false, code: 'MISSING_PARAMS' }
    }
    const profileDir = profileDirOf()
    if (profileDir === null) return { ok: false, code: 'PROFILE_DIR_NOT_FOUND' }
    const patchPath = join(profileDir, PATCH_FILENAME)

    let raw
    try {
      raw = await readFile(patchPath, 'utf8')
    } catch (error) {
      return { ok: false, code: 'PATCH_READ_FAILED', detail: String(error?.message ?? error) }
    }
    let yaml
    try {
      yaml = await getYaml(profileDir)
    } catch (error) {
      return { ok: false, code: 'YAML_UNAVAILABLE', detail: String(error?.message ?? error) }
    }
    let patches
    try {
      patches = yaml.load(raw)
    } catch (error) {
      return { ok: false, code: 'PATCH_PARSE_FAILED', detail: String(error?.message ?? error) }
    }
    if (!Array.isArray(patches)) return { ok: false, code: 'PATCH_NOT_ARRAY' }

    // 精确匹配我们写入的停用补丁：恰好是 {id, name, disabled: true} 三个键
    const isOurs = (p) => p !== null && typeof p === 'object' && !Array.isArray(p) &&
      p.id === patchId && p.name === name && p.disabled === true &&
      Object.keys(p).sort().join(',') === 'disabled,id,name'
    const kept = patches.filter((p) => !isOurs(p))
    if (!enabled) kept.push({ id: patchId, name, disabled: true })

    // 保留原文件顶部的注释块，其余按 YAML 重新序列化
    const comment = (raw.match(/^(\s*#.*\n)*/) || [''])[0]
    let body
    try {
      body = yaml.dump(kept, { indent: 2, lineWidth: -1, noRefs: true, noCompatMode: true })
    } catch (error) {
      return { ok: false, code: 'YAML_DUMP_FAILED', detail: String(error?.message ?? error) }
    }
    try {
      await writeFile(patchPath, comment + body, 'utf8')
    } catch (error) {
      return { ok: false, code: 'PATCH_WRITE_FAILED', detail: String(error?.message ?? error) }
    }
    logger.info('%s %s %s（已写入 ' + PATCH_FILENAME + '，HMR 将热生效）', enabled ? '启用' : '停用', name, patchId)
    return { ok: true }
  }

  // ── 卸载：dsh plugin --profile <p> remove <name> ────────────────────
  // 从 profile 移除依赖与 bundle 层（pnpm remove + reconcile），需重启
  // Web UI 生效。守卫：不能卸载自身；必须是在 profile 依赖里声明的包。
  function runCommand(cmd, args) {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
      }, COMMAND_TIMEOUT_MS)
      child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8') })
      child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
      child.on('error', (error) => {
        clearTimeout(timer)
        resolve({ spawnError: error, stdout, stderr, timedOut })
      })
      child.on('close', (code, signal) => {
        clearTimeout(timer)
        resolve({ code, signal, stdout, stderr, timedOut })
      })
    })
  }

  async function uninstallPlugin(name) {
    if (typeof name !== 'string' || name.length === 0) {
      return { ok: false, code: 'MISSING_PARAMS' }
    }
    if (name === PLUGIN_NAME) {
      return { ok: false, code: 'SELF_UNINSTALL_DENIED' }
    }
    const profileDir = profileDirOf()
    if (profileDir === null) return { ok: false, code: 'PROFILE_DIR_NOT_FOUND' }
    let manifest = null
    try {
      manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    } catch { /* 无清单则按未安装处理 */ }
    if (!manifest?.dependencies?.[name]) {
      return { ok: false, code: 'NOT_INSTALLED' }
    }
    const profileName = basename(profileDir)
    const command = 'dsh plugin --profile ' + profileName + ' remove ' + name
    const out = await runCommand('dsh', ['plugin', '--profile', profileName, 'remove', name])
    if (out.spawnError) {
      return { ok: false, code: 'RUN_FAILED', detail: String(out.spawnError.message || out.spawnError), command }
    }
    if (out.code === 0) uninstalledNames.add(name)
    return {
      ok: out.code === 0,
      code: out.code === 0 ? undefined : 'UNINSTALL_FAILED',
      exit_code: out.code === null ? null : out.code,
      timed_out: out.timedOut,
      stdout_tail: out.stdout.slice(-2000),
      stderr_tail: out.stderr.slice(-2000),
      command,
      need_restart: true,
    }
  }

  // ── 更新：dsh plugin --profile <p> add <name>（安装后校验版本）────────
  async function updatePlugin(name) {
    if (typeof name !== 'string' || name.length === 0) {
      return { ok: false, code: 'MISSING_PARAMS' }
    }
    const profileDir = profileDirOf()
    if (profileDir === null) return { ok: false, code: 'PROFILE_DIR_NOT_FOUND' }
    let manifest = null
    try {
      manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    } catch { /* 无清单则按未安装处理 */ }
    if (!manifest?.dependencies?.[name]) {
      return { ok: false, code: 'NOT_INSTALLED' }
    }
    if (updateInFlight !== null) {
      return { ok: false, code: 'BUSY', detail: updateInFlight }
    }
    updateInFlight = name
    try {
      const profileName = basename(profileDir)
      const command = 'dsh plugin --profile ' + profileName + ' add ' + name
      const out = await runCommand('dsh', ['plugin', '--profile', profileName, 'add', name])
      if (out.spawnError) {
        return { ok: false, code: 'RUN_FAILED', detail: String(out.spawnError.message || out.spawnError), command }
      }
      if (out.code !== 0) {
        return {
          ok: false, code: 'UPDATE_FAILED',
          exit_code: out.code === null ? null : out.code,
          timed_out: out.timedOut,
          stdout_tail: out.stdout.slice(-2000),
          stderr_tail: out.stderr.slice(-2000),
          command,
        }
      }
      // 安装后校验：命令成功 ≠ 版本已更新（npm 镜像同步延迟等）
      const pkg = resolvePackage(name)
      const installed = pkg?.version ?? ''
      const latest = await fetchLatestVersion(name)
      if (typeof latest === 'string' && installed && latest !== installed) {
        return {
          ok: false, code: 'VERSION_MISMATCH', command,
          installed_version: installed, latest_version: latest,
          detail: 'npm 镜像可能同步延迟，实际安装 ' + installed + '，期望 ' + latest,
        }
      }
      updatedNames.add(name)
      logger.info('updated %s -> %s（待重启生效）', name, installed || latest)
      return { ok: true, command, need_restart: true, installed_version: installed, latest_version: latest }
    } finally {
      updateInFlight = null
    }
  }

  // ── 路由 ────────────────────────────────────────────────────────────
  async function handle(req, res) {
    if (!isTrustedApiRequest(req)) {
      sendJson(res, 403, { ok: false, code: 'FORBIDDEN' })
      return
    }
    let url
    try {
      url = new URL(req.url, 'http://localhost')
    } catch {
      sendJson(res, 400, { ok: false, code: 'BAD_REQUEST' })
      return
    }
    const pathname = url.pathname

    if (pathname === API_PREFIX + '/inventory' && req.method === 'GET') {
      try {
        const inventory = await collectInventory()
        sendJson(res, 200, { ok: true, entries: inventory.rows, updatesCount: inventory.updatesCount })
      } catch (error) {
        sendJson(res, 500, { ok: false, code: 'INVENTORY_FAILED', detail: String(error?.message ?? error) })
      }
      return
    }

    if (pathname === API_PREFIX + '/set-enabled' && req.method === 'POST') {
      let body
      try {
        body = JSON.parse((await readBody(req, 65536)) || '{}')
      } catch {
        sendJson(res, 400, { ok: false, code: 'BAD_JSON' })
        return
      }
      try {
        sendJson(res, 200, await setEnabled(String(body.id ?? ''), String(body.name ?? ''), Boolean(body.enabled)))
      } catch (error) {
        sendJson(res, 500, { ok: false, code: 'INTERNAL', detail: String(error?.message ?? error) })
      }
      return
    }

    if (pathname === API_PREFIX + '/uninstall' && req.method === 'POST') {
      let body
      try {
        body = JSON.parse((await readBody(req, 65536)) || '{}')
      } catch {
        sendJson(res, 400, { ok: false, code: 'BAD_JSON' })
        return
      }
      try {
        sendJson(res, 200, await uninstallPlugin(String(body.name ?? '')))
      } catch (error) {
        sendJson(res, 500, { ok: false, code: 'INTERNAL', detail: String(error?.message ?? error) })
      }
      return
    }

    if (pathname === API_PREFIX + '/update' && req.method === 'POST') {
      let body
      try {
        body = JSON.parse((await readBody(req, 65536)) || '{}')
      } catch {
        sendJson(res, 400, { ok: false, code: 'BAD_JSON' })
        return
      }
      try {
        sendJson(res, 200, await updatePlugin(String(body.name ?? '')))
      } catch (error) {
        sendJson(res, 500, { ok: false, code: 'INTERNAL', detail: String(error?.message ?? error) })
      }
      return
    }

    res.writeHead(404)
    res.end('not found')
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: handle,
  }))
  logger.info('routes registered at ' + API_PREFIX)
}

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

import { readFileSync, existsSync, statSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, delimiter } from 'node:path'
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

// ── 补丁层文本编辑（启用/停用）────────────────────────────────────────
// 不解析、不重排 YAML：只增删我们自己的那一个顶层列表项，其余字节原样保留。
// 为什么不用 js-yaml（2026-10-19 用户实测 + 本人复现）：宿主动态解析 js-yaml 会在
// 某些环境失败（YAML_UNAVAILABLE）→ 点"启用/停用"完全没反应；即使解析成功，
// js-yaml 4.x 也会把用户手写的注释与 `!!js` 排版整片重写。
const DISABLE_MARKER_OPEN = '# >>> 逃咪-插件总览：停用（删除本段即恢复启用）'
const DISABLE_MARKER_CLOSE = '# <<< 逃咪-插件总览'

/** YAML 标量：只在必要时加单引号（保持文件可读、diff 干净）。
 *  注意 `@deepseek-ai/...` 这类以 `@` 开头的是 YAML 保留指示符，必须加引号。 */
function yamlScalar(value) {
  const text = String(value)
  const plain = /^[A-Za-z0-9_.][A-Za-z0-9._\-\/@]*$/.test(text) && !/^(?:true|false|null|yes|no|on|off|~)$/i.test(text)
  return plain ? text : "'" + text.replace(/'/g, "''") + "'"
}

function unquoteValue(value) {
  const text = String(value ?? '').trim()
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replace(/''/g, "'")
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1)
  return text
}

/** 一个顶层列表项的「直接键」（缩进 2 空格的键，嵌套更深的忽略）。 */
function itemKeys(itemLines) {
  const entries = []
  const first = /^-[ \t]+([A-Za-z0-9_]+):(.*)$/.exec(itemLines[0] ?? '')
  if (first) entries.push({ key: first[1], value: first[2] })
  for (let i = 1; i < itemLines.length; i++) {
    const match = /^ {2}([A-Za-z0-9_]+):(.*)$/.exec(itemLines[i])
    if (match) entries.push({ key: match[1], value: match[2] })
  }
  return entries
}

/** 是否正是「我们这个插件写的」停用项：恰好 id/name/disabled 三个键且值匹配。 */
function isOurDisableItem(itemLines, patchId, name) {
  const entries = itemKeys(itemLines)
  const keys = entries.map((entry) => entry.key).sort().join(',')
  if (keys !== 'disabled,id,name') return false
  const get = (key) => unquoteValue((entries.find((entry) => entry.key === key) ?? {}).value)
  return get('id') === patchId && get('name') === name && get('disabled') === 'true'
}

/**
 * 在补丁文本里写入/移除一个停用项。
 * @returns {{ text: string, changed: boolean }}
 */
function editPatchList(raw, patchId, name, enabled) {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split(/\r?\n/)
  const starts = []
  for (let i = 0; i < lines.length; i++) {
    if (/^-(?:\s|$)/.test(lines[i])) starts.push(i) // 顶层项；缩进的子项不算
  }
  const ranges = starts.map((start, index) => ({
    start,
    end: index + 1 < starts.length ? starts[index + 1] : lines.length,
  }))
  const matches = ranges.filter((range) => isOurDisableItem(lines.slice(range.start, range.end), patchId, name))

  if (enabled) {
    if (matches.length === 0) return { text: raw, changed: false }
    const drop = new Set()
    for (const range of matches) {
      let start = range.start
      let end = range.end
      if (start > 0 && lines[start - 1].trim() === DISABLE_MARKER_OPEN) start -= 1
      if (end < lines.length && lines[end].trim() === DISABLE_MARKER_CLOSE) end += 1
      for (let i = start; i < end; i++) drop.add(i)
    }
    const out = []
    let placeholderAt = -1
    for (let i = 0; i < lines.length; i++) {
      if (drop.has(i)) {
        if (placeholderAt < 0) placeholderAt = out.length
        continue
      }
      out.push(lines[i])
    }
    // 删完之后如果文件里一个顶层项都不剩，必须补回空数组（补丁层要求是数组）
    const hasItem = out.some((line) => /^-(?:\s|$)/.test(line))
    const hasEmpty = out.some((line) => line.trim() === '[]')
    if (!hasItem && !hasEmpty) out.splice(placeholderAt < 0 ? out.length : placeholderAt, 0, '[]')
    // 保留原来的"文件末尾有换行"这一属性（删掉最后一项时容易丢）
    let text = out.join(eol)
    if (/\r?\n$/.test(raw) && !text.endsWith(eol)) text += eol
    return { text, changed: true }
  }

  // 停用：已经有同样的项就不动（幂等）
  if (matches.length > 0) return { text: raw, changed: false }
  const block = [
    DISABLE_MARKER_OPEN,
    '- id: ' + yamlScalar(patchId),
    '  name: ' + yamlScalar(name),
    '  disabled: true',
    DISABLE_MARKER_CLOSE,
  ]
  // 空清单 `[]`：直接追加会变成非法 YAML，要把这一行替换掉
  const emptyIndex = ranges.length === 0 ? lines.findIndex((line) => line.trim() === '[]') : -1
  if (emptyIndex >= 0) {
    const next = lines.slice()
    next.splice(emptyIndex, 1, ...block)
    return { text: next.join(eol), changed: true }
  }
  const base = raw.replace(/\s*$/, '')
  const text = (base === '' ? '' : base + eol) + block.join(eol) + eol
  return { text, changed: true }
}

// ── 定位 dsh CLI（宿主进程的 PATH 里通常没有 dsh）─────────────────────
// 2026-10-19 实测：桌面端只把 CLI 装在 `<resources>\runtime\cli\bin\dsh.cmd`，
// 既不在系统 PATH、也不在 `%APPDATA%\npm`，于是 `spawn('dsh', …)` 必然
// "不是内部或外部命令"——更新与卸载全废。这里按"最可靠 → 兜底"找一个能跑的入口。
let cliCache = null

function isFile(path) {
  try { return statSync(path).isFile() } catch { return false }
}

/** 桌面端 asar 里的 CLI 入口：与 `resources\runtime\cli\bin\dsh.cmd` 同一个文件。 */
function desktopCliEntry() {
  const candidates = []
  if (typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0) {
    candidates.push(join(process.resourcesPath, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'))
    candidates.push(join(process.resourcesPath, 'app.asar.unpacked', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'))
  }
  if (typeof process.execPath === 'string' && process.execPath.length > 0) {
    const root = dirname(process.execPath)
    candidates.push(join(root, 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'))
    candidates.push(join(root, 'resources', 'app.asar.unpacked', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'))
  }
  for (const path of candidates) {
    if (isFile(path)) return path
  }
  return null
}

/**
 * 解析 dsh 的启动方式。
 * @returns {{ command: string, prefix: string[], shell: boolean, kind: string } | null}
 */
function resolveDshCli() {
  if (cliCache !== null) return cliCache
  const override = (process.env.RUNCAT_DSH_CLI ?? '').trim()
  if (override !== '') {
    const lower = override.toLowerCase()
    if (lower.endsWith('.cmd') || lower.endsWith('.bat')) {
      cliCache = { command: override, prefix: [], shell: true, kind: 'env-shim' }
      return cliCache
    }
    if (lower.endsWith('.js') && process.versions.electron !== undefined) {
      cliCache = { command: process.execPath, prefix: [override], shell: false, kind: 'env-script-electron' }
      return cliCache
    }
    cliCache = { command: override, prefix: [], shell: false, kind: 'env-bin' }
    return cliCache
  }
  // 桌面端：宿主可执行文件 + asar 内 cli.js（无需 shell、不依赖 PATH）
  const entry = desktopCliEntry()
  if (entry !== null && typeof process.execPath === 'string' && process.execPath.length > 0) {
    cliCache = { command: process.execPath, prefix: [entry], shell: false, kind: 'desktop-electron' }
    return cliCache
  }
  // 桌面端兜底：安装目录里自带的 dsh.cmd（绝对路径，只是要 shell）
  if (typeof process.execPath === 'string' && process.execPath.length > 0) {
    const shim = join(dirname(process.execPath), 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd')
    if (isFile(shim)) {
      cliCache = { command: shim, prefix: [], shell: true, kind: 'desktop-shim' }
      return cliCache
    }
  }
  // PATH 里的 dsh（CLI 安装场景）
  for (const dir of String(process.env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue
    for (const name of process.platform === 'win32' ? ['dsh.cmd', 'dsh.exe', 'dsh.bat'] : ['dsh']) {
      const path = join(dir, name)
      if (isFile(path)) {
        cliCache = { command: path, prefix: [], shell: process.platform === 'win32', kind: 'path-shim' }
        return cliCache
      }
    }
  }
  // 平台常见安装位置（PATH 没刷新的情况）
  const extra = []
  if (process.platform === 'win32') {
    if (process.env.APPDATA) extra.push(join(process.env.APPDATA, 'npm', 'dsh.cmd'))
    if (process.env.ProgramFiles) extra.push(join(process.env.ProgramFiles, 'nodejs', 'dsh.cmd'))
    if (process.env.LOCALAPPDATA) extra.push(join(process.env.LOCALAPPDATA, 'pnpm', 'dsh.cmd'))
  } else {
    for (const dir of ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin']) extra.push(join(dir, 'dsh'))
  }
  for (const path of extra) {
    if (isFile(path)) {
      cliCache = { command: path, prefix: [], shell: process.platform === 'win32', kind: 'known-path-shim' }
      return cliCache
    }
  }
  return null
}

/** 仅测试用：清掉解析缓存 / 读取解析结果（都不触发 spawn）。 */
export function __resetDshCliCache() { cliCache = null }
export function __resolveDshCli() { return resolveDshCli() }

export function apply(ctx) {
  const logger = ctx.logger('runcat-inventory')
  // 一次解析、一次性记录：出问题时能立刻看到 dsh 是从哪儿来的
  try {
    const cli = resolveDshCli()
    if (cli === null) logger.warn('dsh CLI 未找到：更新/卸载将返回 DSH_CLI_NOT_FOUND（可用 RUNCAT_DSH_CLI 指定路径）')
    else logger.info('dsh CLI = %s [%s]', [cli.command, ...cli.prefix].join(' '), cli.kind)
  } catch { /* 解析失败不影响其余功能 */ }

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

  /**
   * 依赖 specifier 是否"不可更新"：本地路径/工作区链接不能走 npm add。
   *
   * pnpm 的 `add <name>@<version>` 对这类依赖会把它**替换成 registry 安装**，
   * 静默丢掉本地的开发链接，所以更新按钮对它们必须是明确的拒绝，而不是照装。
   * （与 collectInventory 里跳过扫描的判断同源：link / file / workspace。）
   */
  function isNonUpdatableSpec(spec) {
    return typeof spec === 'string' && /^(?:link|file|workspace):/i.test(spec)
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

    // 纯文本编辑：只增删我们自己的那一个顶层列表项，其余字节原样保留。
    // 不依赖 js-yaml —— 它在宿主里可能解析不到（会让启用/停用"点了没反应"）。
    const { text, changed } = editPatchList(raw, patchId, name, enabled)
    if (!changed) {
      logger.info('%s %s %s（清单里已是目标状态，无需写入）', enabled ? '启用' : '停用', name, patchId)
      return { ok: true }
    }
    try {
      await writeFile(patchPath, text, 'utf8')
    } catch (error) {
      return { ok: false, code: 'PATCH_WRITE_FAILED', detail: String(error?.message ?? error) }
    }
    logger.info('%s %s %s（已写入 ' + PATCH_FILENAME + '，HMR 将热生效）', enabled ? '启用' : '停用', name, patchId)
    return { ok: true }
  }

  // ── 卸载：dsh plugin --profile <p> remove <name> ────────────────────
  // 从 profile 移除依赖与 bundle 层（pnpm remove + reconcile），需重启
  // Web UI 生效。守卫：不能卸载自身；必须是在 profile 依赖里声明的包。
  /** 把"找不到 dsh"这类环境问题翻译成可执行的诊断，而不是一串 shell 报错。 */
  function cliUnavailable() {
    return {
      ok: false,
      code: 'DSH_CLI_NOT_FOUND',
      detail: '找不到 dsh 可执行文件。桌面端通常装在 <resources>\\runtime\\cli\\bin\\dsh.cmd，'
        + '但宿主进程的 PATH 里没有它。可用环境变量 RUNCAT_DSH_CLI 指定 dsh.cmd / cli.js 的绝对路径后重启 DSH。',
    }
  }

  function runCommand(cmd, args) {
    // 测试注入点：同一进程内调用 apply(ctx) 的回归测试可挂
    // globalThis.__runcatRunCommand 记录 argv 并伪造结果，不 spawn 任何进程。
    const injected = globalThis.__runcatRunCommand
    if (typeof injected === 'function') return Promise.resolve(injected(cmd, args))
    const cli = resolveDshCli()
    if (cli === null) {
      return Promise.resolve({
        spawnError: new Error('dsh CLI not found (PATH / resources / known install locations)'),
        notFound: true, stdout: '', stderr: '', timedOut: false,
      })
    }
    const argv = cli.prefix.concat(args)
    return new Promise((resolve) => {
      const child = spawn(cli.command, argv, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: cli.shell,
        // Electron 作为 node 运行时需要这个开关；其他场景设置了也无害
        env: process.versions.electron !== undefined
          ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
          : process.env,
        windowsHide: true,
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
        resolve({ spawnError: error, stdout, stderr, timedOut, cli })
      })
      child.on('close', (code, signal) => {
        clearTimeout(timer)
        resolve({ code, signal, stdout, stderr, timedOut, cli })
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
    if (out.notFound) return { ...cliUnavailable(), command }
    if (out.spawnError) {
      return { ok: false, code: 'RUN_FAILED', detail: String(out.spawnError.message || out.spawnError), command }
    }
    const applied = out.code === 0 ? await applyProfileChanges(entryIdsOf(name)) : { applied: false }
    // 热应用成功说明已经从树里摘掉了，不需要再靠"已卸载"标记提示重启
    if (out.code === 0 && !applied.applied) uninstalledNames.add(name)
    return {
      ok: out.code === 0,
      code: out.code === 0 ? undefined : 'UNINSTALL_FAILED',
      exit_code: out.code === null ? null : out.code,
      timed_out: out.timedOut,
      stdout_tail: out.stdout.slice(-2000),
      stderr_tail: out.stderr.slice(-2000),
      command,
      need_restart: out.code === 0 ? !applied.applied : true,
      applied: applied.applied === true,
      apply_reason: applied.reason ?? null,
    }
  }

  // ── 更新：dsh plugin --profile <p> add <name>@<latest>（安装后校验）──────
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
    const declared = manifest?.dependencies?.[name]
    if (!declared) {
      return { ok: false, code: 'NOT_INSTALLED' }
    }
    // 本地链接/工作区依赖：装 npm 版本会静默丢掉开发链接，明确拒绝
    if (isNonUpdatableSpec(declared)) {
      return { ok: false, code: 'NOT_UPDATABLE', spec: declared }
    }
    if (updateInFlight !== null) {
      return { ok: false, code: 'BUSY', detail: updateInFlight }
    }
    updateInFlight = name
    try {
      const profileName = basename(profileDir)
      const previous = resolvePackage(name)?.version ?? ''
      // 已有较新的本地版本（npm 上 latest 还没跟上，例如镜像回退或预发布线）：
      // 装 latest 等于降级，直接返回"已是最新"。
      const cached = latestCache.get(name)
      if (typeof cached?.version === 'string' && previous &&
          compareVersions(cached.version, previous) <= 0) {
        return {
          ok: true, code: 'ALREADY_LATEST',
          command: 'dsh plugin --profile ' + profileName + ' add ' + name + '@' + cached.version,
          from_version: previous, to_version: previous,
          installed_version: previous, latest_version: cached.version,
          need_restart: false,
        }
      }
      // pnpm 把不带版本的 `add <name>` 视为"已满足"：装了任意版本它就不做事，
      // 但仍然 exit 0，于是下面那段自检会把这次空转报成"更新失败"。
      // 必须明确要哪个版本。
      const latest = await fetchLatestVersion(name)
      const spec = typeof latest === 'string' ? name + '@' + latest : name
      const command = 'dsh plugin --profile ' + profileName + ' add ' + spec
      if (latest === null) {
        logger.warn('latest version of %s is unavailable — falling back to the profile specifier %s', name, declared)
      }
      const out = await runCommand('dsh', ['plugin', '--profile', profileName, 'add', spec])
      if (out.notFound) return { ...cliUnavailable(), command }
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
      // 安装后校验：命令成功 ≠ 版本已更新（npm 镜像同步延迟等）。
      // 只有"确实比目标旧"才算失败；镜像回退导致的"比 latest 还新"不是错误。
      const installed = resolvePackage(name)?.version ?? ''
      const target = typeof latest === 'string' ? latest : ''
      if (target && installed && compareVersions(installed, target) < 0) {
        return {
          ok: false, code: 'VERSION_MISMATCH', command,
          installed_version: installed, latest_version: target,
          detail: 'npm 源可能尚未同步（实际安装 ' + installed + '，目标 ' + target + '）',
        }
      }
      // 让 DSH 自己热应用补丁层变更：能应用就不用重启（Desktop 尤其需要）
      const applied = await applyProfileChanges(entryIdsOf(name))
      // 只有"确实需要重启"才标记待重启；热应用成功的当场就生效了
      if (!applied.applied) updatedNames.add(name)
      logger.info('updated %s: %s -> %s（%s）', name, previous || '(unknown)', installed || target || '(unknown)',
        applied.applied ? '热应用成功' : '待重启生效')
      return {
        ok: true, command, need_restart: !applied.applied,
        from_version: previous, to_version: installed || target,
        installed_version: installed, latest_version: target,
        applied: applied.applied,
        apply_reason: applied.reason ?? null,
      }
    } finally {
      updateInFlight = null
    }
  }

  // ── 热应用 / 重启：让更新真正生效 ────────────────────────────────────
  // DSH 自带 HMR 服务（官方插件管理器用的也是它：`hmr.reconcileProfile()`）。
  // 用它把补丁层/依赖变更就地应用，**能应用就不用重启**。
  function service(name) {
    try {
      return typeof ctx.get === 'function' ? ctx.get(name) : undefined
    } catch { return undefined }
  }

  /** 某个包在 loader 里的所有条目 id（reconcile 用它决定要起的条目）。 */
  function entryIdsOf(name) {
    const ids = []
    try {
      for (const entry of ctx.loader.entries()) {
        if (entry?.options?.name === name && typeof entry.id === 'string') ids.push(entry.id)
      }
    } catch { /* 无 loader 时返回空数组 */ }
    return ids
  }

  /**
   * 调 HMR 的 `reconcileProfile()` 就地应用 profile 变更。
   * @returns {{ available: boolean, applied: boolean, reason?: string|null }}
   */
  async function applyProfileChanges(requiredIds = []) {
    const hmr = service('hmr')
    if (!hmr || typeof hmr.reconcileProfile !== 'function') {
      return { available: false, applied: false, reason: 'HMR 不可用' }
    }
    try {
      const run = () => hmr.reconcileProfile(requiredIds)
      const result = typeof hmr.runExclusive === 'function' ? await hmr.runExclusive(run) : await run()
      const reason = result?.restartReason ?? result?.pending?.[0]?.reason
      return reason === undefined || reason === null
        ? { available: true, applied: true, reason: null }
        : { available: true, applied: false, reason: String(reason) }
    } catch (error) {
      return { available: true, applied: false, reason: String(error?.message ?? error) }
    }
  }

  /** 这个请求来自哪个端口（重启后要回到同一个端口）。 */
  function servingPort(req) {
    const host = header(req.headers, 'host')
    const match = host === undefined ? null : /:(\d{1,5})$/.exec(host)
    return match === null ? null : Number(match[1])
  }

  /** 脱离父进程的重启助手：等端口释放 → 用同一个 CLI 重新拉起。 */
  function restartHelperSource(command, args, cwd, port) {
    return [
      "const { spawn } = require('node:child_process')",
      "const net = require('node:net')",
      'const sleep = (ms) => new Promise((r) => setTimeout(r, ms))',
      'const listening = () => new Promise((resolve) => {',
      '  const probe = net.connect({ host: "127.0.0.1", port })',
      '  const done = (value) => { probe.destroy(); resolve(value) }',
      '  probe.on("connect", () => done(true))',
      '  probe.on("error", () => done(false))',
      '  setTimeout(() => done(false), 500)',
      '})',
      'const main = async () => {',
      '  if (port) {',
      '    const until = Date.now() + 30000',
      '    while (Date.now() < until && await listening()) await sleep(250)',
      '    await sleep(400)',
      '  } else { await sleep(1500) }',
      `  const child = spawn(${JSON.stringify(command)}, ${JSON.stringify(args)}, { cwd: ${JSON.stringify(cwd)}, detached: true, stdio: 'ignore', windowsHide: true })`,
      '  child.unref()',
      '}',
      'main()',
    ].join('\n')
  }

  /**
   * 重启 DSH 宿主进程。
   *
   * 桌面端限制（2026-10-19 读 app.asar 的 lib/main.js 实测）：宿主是 Electron 外壳的
   * 子进程，外壳只认 `ready` / `shutdown-complete` / `platform-session` 三种事件，
   * 没有任何"请求重启"的通道；宿主退出会被判成故障页。所以**桌面端不从插件内杀进程**，
   * 改为回报 `DESKTOP_RESTART_UNSUPPORTED`，由界面提示手动重启。
   * CLI 宿主（`dsh web`）则可以安全自重启：等端口释放后用同一个 CLI 重新拉起。
   */
  async function restartHost(req) {
    if (updateInFlight !== null) return { ok: false, code: 'BUSY', detail: updateInFlight }
    if (process.versions.electron !== undefined) {
      return {
        ok: false, code: 'DESKTOP_RESTART_UNSUPPORTED',
        detail: '桌面端由 Electron 外壳管理宿主进程，插件内重启会让界面进入故障页；请退出并重新打开 DeepSeek Harness。',
      }
    }
    const cli = resolveDshCli()
    if (cli === null) return cliUnavailable()
    const port = servingPort(req)
    const args = cli.prefix.concat(process.argv.slice(2))
    const helper = spawn(process.execPath, ['-e', restartHelperSource(cli.command, args, process.cwd(), port)], {
      detached: true, stdio: 'ignore', windowsHide: true, env: process.env,
    })
    helper.unref()
    logger.info('restarting dsh: %s %s (port %s)', cli.command, args.join(' '), port ?? 'unknown')
    setTimeout(() => process.exit(0), 400)
    return { ok: true, code: 'RESTARTING', port }
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

    // 热应用：让已写入的 profile 变更就地生效（不需要重启）
    if (pathname === API_PREFIX + '/apply-changes' && req.method === 'POST') {
      try {
        const applied = await applyProfileChanges([])
        sendJson(res, 200, {
          ok: applied.available && applied.applied,
          applied: applied.applied === true,
          available: applied.available === true,
          need_restart: !applied.applied,
          reason: applied.reason ?? null,
          code: applied.available === false ? 'HMR_UNAVAILABLE' : (applied.applied ? undefined : 'RESTART_REQUIRED'),
        })
      } catch (error) {
        sendJson(res, 500, { ok: false, code: 'INTERNAL', detail: String(error?.message ?? error) })
      }
      return
    }

    // 重启宿主（桌面端不支持，返回明确原因而不是假装成功）
    if (pathname === API_PREFIX + '/restart' && req.method === 'POST') {
      try {
        sendJson(res, 200, await restartHost(req))
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

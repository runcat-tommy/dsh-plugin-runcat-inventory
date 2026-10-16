#!/usr/bin/env node
/**
 * dsh-plugin-runcat-inventory —— 兼容性验收（复用 dshmarket 自己的判定）
 *
 * 缺陷 2 的复核：市场只统计「既在宿主包清单内、又匹配 @deepseek-ai/dsh*」
 * 的 peer（dshmarket/lib/discovery-compatibility.js 的 deriveHostCompatibility）。
 * 1.2.1 只声明了 @deepseek-ai/dsh-client-runtime，而桌面端 app.asar 的宿主清单
 * 里没有这个包 → 一条都不计入 → status 仍是 unknown。
 *
 * 本脚本用**真实**的 corePackageNames(dshHostInfo().directory) 清单判定仓库里的
 * package.json（不给 HOST_FALLBACK 兜底，避免测出假绿），并断言：
 *   1) status === 'compatible'
 *   2) declarations.length >= 1（防"声明了但一条都不计入"的假修复）
 *   3) peerDependencies 与 dsh.client.inject 双向同步
 *
 * 运行：node test/compat-test.mjs
 * 可选：--market-lib <dshmarket/lib>  --dsh-home <DSH_HOME>
 */

import { mkdirSync, openSync, readSync, closeSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const argv = process.argv.slice(2)
let marketLib = null
let dshHome = process.env.DSH_HOME ?? (process.env.USERPROFILE ? join(process.env.USERPROFILE, '.dsh') : null)
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--market-lib') marketLib = argv[++i]
  else if (argv[i] === '--dsh-home') dshHome = argv[++i]
}

let passed = 0
let failed = 0
function check(name, fn) {
  try {
    fn()
    passed++
    console.log('  ok ' + name)
  } catch (error) {
    failed++
    console.error('  FAIL ' + name + '\n    ' + (error?.stack || error))
  }
}

// ── 找 dshmarket 的判定库 ─────────────────────────────────────────────
function findMarketLib() {
  const candidates = []
  if (marketLib) candidates.push(marketLib)
  if (dshHome) {
    for (const p of ['web', 'desktop', 'headless']) {
      candidates.push(join(dshHome, 'profiles', p, 'node_modules', 'dshmarket', 'lib'))
      candidates.push(join(dshHome, 'profiles', 'node_modules', 'dshmarket', 'lib'))
    }
    candidates.push(join(dshHome, 'dsh-market', 'lib'))
  }
  for (const c of candidates) {
    if (existsSync(join(c, 'discovery-compatibility.js')) && existsSync(join(c, 'check.js'))) return c
  }
  return null
}
const LIB = findMarketLib()
if (LIB === null) {
  console.error('找不到 dshmarket/lib —— 用 --market-lib 指定，或设置 DSH_HOME')
  process.exit(2)
}
const { deriveHostCompatibility, manifestFacts } = await import(pathToFileURL(join(LIB, 'discovery-compatibility.js')).href)
const { corePackageNames } = await import(pathToFileURL(join(LIB, 'check.js')).href)
const { dshHostInfo } = await import(pathToFileURL(join(LIB, 'dsh-install.js')).href)

// ── 真实宿主事实 ──────────────────────────────────────────────────────
// process.argv[1] 视调用方而定，桌面端宿主在 Electron resources 里，
// dshHostInfo() 需要 process.resourcesPath 才能走到；命令行下先把常见的
// 桌面/CLI 布局找出来，再用同一套 corePackageNames 读它的真实清单。
const HOST_DIR_CANDIDATES = [
  process.env.RUNCAT_HOST_DIR,
  'D:\\DeepSeek Harness\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh',
  dshHome ? join(dshHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh') : null,
  dshHome ? join(dshHome, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh') : null,
].filter((p) => typeof p === 'string' && p.length > 0)

function hostFromDirectory(directory) {
  try {
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    if (manifest.name !== '@deepseek-ai/dsh') return null
    return { directory, version: manifest.version ?? 'unknown' }
  } catch { return null }
}

/** 显式指定的宿主目录优先（要复现具体的部署布局时用）。 */
function hostFromEnv() {
  const dir = process.env.RUNCAT_HOST_DIR
  return typeof dir === 'string' && dir.length > 0 ? hostFromDirectory(dir) : null
}

let host = hostFromEnv() ?? dshHostInfo()
if (host === null) {
  for (const candidate of HOST_DIR_CANDIDATES) {
    host = hostFromDirectory(candidate)
    if (host !== null) break
  }
}
if (host === null) {
  console.error('找不到 DSH 宿主 —— 用 RUNCAT_HOST_DIR 指向 <...>/node_modules/@deepseek-ai/dsh')
  process.exit(2)
}
if (!existsSync(join(host.directory, 'package.json'))) {
  console.error('宿主目录不可读（app.asar 需要 Electron 的 asar 支持）：' + host.directory)
  process.exit(2)
}
const hostPackages = corePackageNames(host.directory)
const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))
const facts = manifestFacts(manifest)
const verdict = deriveHostCompatibility(facts, host.version, hostPackages)

console.log('仓库：' + REPO_ROOT)
console.log('宿主：' + host.version + '    目录：' + host.directory)
console.log('宿主包清单：' + hostPackages.size + ' 个（corePackageNames，无兜底种子）')
console.log('判定：' + verdict.status + '（basis=' + verdict.basis + '，requirement=' + verdict.requirement + '）')
console.log('计入的声明：' + (verdict.declarations.length === 0
  ? '（无）'
  : verdict.declarations.map((d) => d.kind + ':' + (d.package ?? 'engines.dsh') + '=' + d.range).join('; ')))
console.log('')

// ── 断言 ──────────────────────────────────────────────────────────────
check('市场判定为 compatible（不是 unknown）', () => {
  if (verdict.status !== 'compatible') {
    throw new Error('status=' + verdict.status + ' basis=' + verdict.basis +
      ' —— 声明的 peer 一条都没计入宿主清单' +
      '（逐条：' + Object.keys(facts.peerDependencies).map((n) => n + (hostPackages.has(n) ? '[在清单]' : '[不在清单]')).join(', ') + '）')
  }
})

check('至少一条声明被计入（防假修复）', () => {
  if (verdict.declarations.length < 1) throw new Error('declarations 为空：声明了但没有一条进入判定')
})

check('peerDependencies 每一项都在 dsh.client.inject 里（反之亦然）', () => {
  const inject = new Set(manifest.dsh?.client?.inject ?? [])
  const peers = new Set(Object.keys(manifest.peerDependencies ?? {}))
  const onlyPeer = [...peers].filter((n) => !inject.has(n))
  const onlyInject = [...inject].filter((n) => !peers.has(n))
  if (onlyPeer.length > 0 || onlyInject.length > 0) {
    throw new Error('不同步 —— 仅 peer：' + JSON.stringify(onlyPeer) + '；仅 inject：' + JSON.stringify(onlyInject))
  }
})

const names = Object.keys(manifest.peerDependencies ?? {})
const missing = []
for (const name of names) {
  try {
    const res = await fetch('https://registry.npmjs.org/' + name + '/latest', { signal: AbortSignal.timeout(15000) })
    if (!res.ok) missing.push(name + ' (HTTP ' + res.status + ')')
  } catch (error) {
    missing.push(name + ' (' + (error?.message ?? error) + ')')
  }
}
if (missing.length === 0) {
  passed++
  console.log('  ok 每条 peer 在 npm 上都存在（' + names.length + ' 条）')
} else if (process.env.RUNCAT_OFFLINE === '1') {
  console.log('  skip npm 存在性校验（RUNCAT_OFFLINE=1）')
} else {
  failed++
  console.error('  FAIL 有 peer 在 npm 上找不到：' + missing.join('; '))
}

// ── 桌面端 app.asar 布局复核（部署布局会改变清单，别只测一种）──────────
// 桌面端把宿主装在 app.asar 里，普通 Node 读不了 asar 虚拟路径。这里只从 asar
// 头部索引读出**真实存在**的 @deepseek-ai/* 目录名，在临时目录里按同样的
// 目录名重建一棵树，再交给 dshmarket 自己的 corePackageNames() 读——判定规则
// 与清单构建逻辑都复用市场代码，只有"部署布局"这一项被换成桌面端的。
const ASAR_PATH = process.env.RUNCAT_ASAR ?? 'D:\\DeepSeek Harness\\resources\\app.asar'

function readAsarPackageNames(asarPath) {
  const fd = openSync(asarPath, 'r')
  try {
    const head = Buffer.alloc(16)
    readSync(fd, head, 0, 16, 0)
    const jsonLen = head.readUInt32LE(12)
    const buf = Buffer.alloc(jsonLen)
    readSync(fd, buf, 0, jsonLen, 16)
    const header = JSON.parse(buf.toString('utf8'))
    const names = new Set()
    const walk = (node, prefix) => {
      if (node === null || typeof node !== 'object') return
      if (node.files) {
        for (const [key, value] of Object.entries(node.files)) walk(value, prefix + '/' + key)
        return
      }
      const match = /@deepseek-ai\/([^/]+)\/package\.json$/.exec(prefix)
      if (match) names.add(match[1])
    }
    walk(header, '')
    return names
  } finally { closeSync(fd) }
}

if (!existsSync(ASAR_PATH)) {
  console.log('\n（跳过桌面端 app.asar 布局：' + ASAR_PATH + ' 不存在）')
} else {
  const pkgNames = readAsarPackageNames(ASAR_PATH)
  // corePackageNames 只收 bare name 以 dsh/cordis 开头的目录
  const hostRelevant = [...pkgNames].filter((n) => /^(?:dsh|cordis)/.test(n))
  const simRoot = join(tmpdir(), 'runcat-asar-host-' + process.pid)
  rmSync(simRoot, { recursive: true, force: true })
  const aiDir = join(simRoot, 'node_modules', '@deepseek-ai')
  mkdirSync(join(aiDir, 'dsh'), { recursive: true })
  writeFileSync(join(aiDir, 'dsh', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: host.version, private: true }))
  for (const n of hostRelevant) {
    mkdirSync(join(aiDir, n), { recursive: true })
    writeFileSync(join(aiDir, n, 'package.json'), JSON.stringify({ name: '@deepseek-ai/' + n, version: host.version }))
  }
  const asarPackages = corePackageNames(join(aiDir, 'dsh'))
  const asarVerdict = deriveHostCompatibility(facts, host.version, asarPackages)
  console.log('\n桌面端 app.asar 布局：' + ASAR_PATH)
  console.log('  @deepseek-ai/* 目录：' + pkgNames.size + ' 个（其中 ' + hostRelevant.length + ' 个计入清单）')
  console.log('  判定：' + asarVerdict.status + '   计入的声明：' + asarVerdict.declarations.length + ' 条'
    + (asarVerdict.declarations.length > 0 ? '（' + asarVerdict.declarations.map((d) => d.package).join('; ') + '）' : ''))
  check('桌面端 asar 清单下同样 compatible', () => {
    if (asarVerdict.status !== 'compatible') {
      throw new Error('status=' + asarVerdict.status + '（该布局下计入 ' + asarVerdict.declarations.length + ' 条）')
    }
  })
  check('该布局下 1.2.1 的旧声明确实是 unknown（证明判定真的随布局变）', () => {
    const oldVerdict = deriveHostCompatibility({
      version: '1.2.1',
      enginesDsh: null,
      peerDependencies: { '@deepseek-ai/dsh-client-runtime': '^0.1.0-rc.6 || ^0.2.0-rc.1' },
    }, host.version, asarPackages)
    if (oldVerdict.status !== 'unknown' || oldVerdict.declarations.length !== 0) {
      throw new Error('旧声明在这里竟判成 ' + oldVerdict.status + '（' + oldVerdict.declarations.length + ' 条）——'
        + '那说明这份 asar 清单里存在 dsh-client-runtime，缺陷 2 的复现前提不成立')
    }
  })
  rmSync(simRoot, { recursive: true, force: true })
}

console.log('\n结果：' + passed + ' 通过，' + failed + ' 失败')
process.exit(failed === 0 ? 0 : 1)

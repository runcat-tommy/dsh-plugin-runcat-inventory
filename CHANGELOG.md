# 更新记录 (Changelog)

**中文** | [English](CHANGELOG.en.md)

本文件记录 `dsh-plugin-runcat-inventory`（逃咪-插件总览 / Runcat Plugin Overview）的版本变更。

## [0.3.6] - 2026-08-27

### 文档

- **新增英文版更新记录 `CHANGELOG.en.md`**：完整英文翻译；两份 CHANGELOG
  顶部互加语言切换链接（`中文 | English`）。
- 英文 README 的更新记录链接指向英文 CHANGELOG。

---

## [0.3.5] - 2026-08-27

### 文档

- **安装新增"方法 B：GitHub 源直接安装"**：
  `dsh plugin --profile web add github:runcat-tommy/dsh-plugin-runcat-inventory`
  （与方法 A 本地克隆安装并列，均注明差异：link: 本地开发 / 直接拉取）。
- **新增英文说明 `README.en.md`**：完整英文版文档（功能/结构/前置条件/
  安装 A/B/原理/卸载/限制/更新摘要），中英文文档顶部互加语言切换链接
  （`中文 | English`）。

---

## [0.3.4] - 2026-08-27

### 文档

- **文件夹名统一**：使用说明中的目录名由 `runcat-inventory` 改为
  `dsh-plugin-runcat-inventory`（与 GitHub 仓库
  `https://github.com/runcat-tommy/dsh-plugin-runcat-inventory` 克隆后的
  本地文件夹名一致）；结构树、安装步骤同步更新。
- **新增"前置条件"章节**：明确 Node.js（DSH 为 Node 程序，必需）、
  pnpm（`dsh plugin` 为 pnpm 转发器，必需）、Git（克隆/GitHub 源安装时
  需要）、网络（访问 GitHub，必要时配置代理）；并说明本插件自身零依赖。
- 验证段落澄清 loader 条目：id 为 `runcat-inventory`、name 为
  `dsh-plugin-runcat-inventory`，避免与文件夹名混淆。

---

## [0.3.3] - 2026-08-27

### 变更

- **本插件自身的描述随界面语言切换**：zh/en 字典新增 `selfDescription`
  键（中文/英文各一套），"详情"展开行的 Description 内容对本插件按当前
  语言显示；其余插件仍显示其 package.json 的 `description` 原文（作者
  单一语言，无法通用翻译）。

---

## [0.3.2] - 2026-08-27

### 修复

- **来源列仅本插件显示仓库地址**：上一版错误地让所有带 `repository`
  字段的插件都显示仓库 URL，已纠正——只有 `dsh-plugin-runcat-inventory`
  显示 `https://github.com/runcat-tommy/dsh-plugin-runcat-inventory`，
  其余插件恢复按安装方式显示（link/file/github/npm/builtin）。
- **来源列内容溢出修复**：长 URL 可能溢出到相邻"操作"列——来源内容
  增加 `word-break: break-all` + `overflow-wrap: anywhere` 强制断行，
  内容始终在 21% 列内换行。

### 测试

- mock 测试更新：hello 恢复 `link` 来源断言；新增本插件条目
  （`sourceKind='repo'` + URL 清理断言）。5 用例全部通过。

---

## [0.3.1] - 2026-08-27

### 变更

- **列宽改为固定比例**（`table-layout: fixed` + `<colgroup>`）：
  名称 36% / 状态 15% / 来源 21% / 操作 28%（名称最重要、占比最大）；
  状态、操作列设最小宽度保护徽章与按钮不挤压。
- **来源列优先显示仓库地址**：host 读取各包 `package.json` 的
  `repository` 字段（自动清理 `git+` 前缀与 `.git` 后缀），有仓库即显示
  仓库 URL；无仓库才回退到安装方式（link/file/github/npm/builtin）。
- 本插件 `package.json` 补充 `repository` 字段 →
  `https://github.com/runcat-tommy/dsh-plugin-runcat-inventory`。

### 测试

- mock 测试更新：`dsh-plugin-hello` 假包加 `repository`，断言
  `sourceKind='repo'` 与 URL 清理结果；其余用例不变。5 用例全部通过。

---

## [0.3.0] - 2026-08-27

### 国际化（界面语言随 DSH 环境自动切换）

- **双语字典**：通过 DSH 内置 locale 服务（`@deepseek-ai/dsh-client-locale`）
  注册简体中文 / English 两套字典，界面语言跟随 DSH 环境（设置 → 通用 →
  Language 或浏览器语言）自动切换，无需重启。
- **选项卡名**：中文"逃咪-插件总览"，英文 **Runcat Plugin Overview**
  （label 改为 locale 函数，语言切换时自动重渲染）。
- **全部界面文案走字典**：搜索/筛选/排序/按钮/徽章/提示/空状态等 40+ 项
  全部 `t('key')` 化。
- **host 彻底国际化**：
  - 错误消息改为**错误码**（`MISSING_PARAMS`、`PATCH_READ_FAILED`、
    `PATCH_PARSE_FAILED`、`PATCH_WRITE_FAILED` 等 13 个），由客户端字典翻译；
  - 来源字段改为 `sourceKind`（link/file/github/npm/builtin/other）+
    `sourceSpec`（原始 spec），显示文案由客户端翻译。
- 终端日志（host logger）与 README/CHANGELOG 文档保持中文（运维惯例）。

### 测试

- mock 单元测试同步更新：来源断言改为 `sourceKind`/`sourceSpec`，
  错误断言改为错误码；403 断言错误码 `FORBIDDEN`。5 用例全部通过。

---

## [0.2.1] - 2026-08-27

### 变更

- 插件中文名由"**逃猫**-插件总览"改为"**逃咪**-插件总览"（选项卡显示名、
  package.json 描述与关键词、README/CHANGELOG/代码注释同步更新）。

---

## [0.2.0] - 2026-08-27

### 界面重构（表格全面瘦身）

- **表格改为固定 4 列**：`名称（含 id + 版本）/ 状态 / 来源 / 操作`，
  删除"描述"列——描述全文移入"详情"展开行查看，列表整体变窄，
  常规窗口宽度下基本无需横向滚动。
- **移除粘性固定列**：名称、操作两列不再固定，极端窄窗口下随内容
  滚动（之前保留的粘性列效果已去掉）。
- **"详情"按钮显示规则**：有描述（非空）或 有配置（非空）才显示；
  两者皆空不显示。空对象 `{}` / 空数组 `[]` 视为无内容。
- **详情展开行**：colSpan 随列数调整（5→4），仍展示描述全文 +
  配置 JSON + "复制配置"按钮。

### 交互改进

- **搜索**：确认采用单一联合搜索（名称 + id + 描述 + 来源 + 版本），
  不引入字段选择器；id 在名称列下方有展示，搜索 id 可直接定位条目。
- **描述**：保留悬浮显示全文（原生 title），移除点击描述展开
  （该入口由"详情"按钮统一承担）。
- **排序**：新增名称排序——`配置顺序`（默认）/ `名称 ↑` / `名称 ↓`
  （中文 localeCompare）。
- **键盘滚动**：表格容器聚焦后可用 ←/→ 横向滚动，Home/End 到头/尾。
- **窄屏适配**：窗口宽度 < 900px 时自动隐藏"来源"列。

### 技术修复

- 修复 `node:fs` 回调版 `readFile` 误传 `'utf8'` 导致读取失败的问题
  （改用 `node:fs/promises`）。
- 修复 Windows 下 `require.resolve` 返回盘符路径无法直接 `import()`
  的问题（转 file URL）。
- 新增 `hasConfigContent` 判断，统一"配置是否有内容"的语义。

### 测试

- host 半端 mock 单元测试 5 用例全部通过
  （`node test/mock-test.mjs`）：路由注册、清单采集、启用/停用写入与
  恢复、安全校验、参数校验。

---

## [0.1.0] - 2026-08-27

### 初始版本

- 首个可用版本：7 列表格（名称 / 状态 / 版本 / 来源 / 描述 / 配置 / 操作）。
- 数据来自 host 端 `ctx.loader.entries()` 实时采集 + 各包 `package.json`
  补充描述/版本 + profile 清单判定来源。
- 启用/停用：编辑 profile 的 `cordis.patch.yml`（用户覆盖层），
  DSH 通过 HMR 热生效，无需重启 Web UI。
- 通信：浏览器半端同源 fetch → host `/runcat-api` 路由，带 loopback
  信任校验（防 CSRF）。
- 配置查看/复制、复制插件名/模块名、搜索框 + 状态过滤。
- 安装方式：`dsh plugin --profile web add .`

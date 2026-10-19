# 更新记录 (Changelog)

**中文** | [English](CHANGELOG.en.md)

本文件记录 `dsh-plugin-runcat-inventory`（逃咪-插件总览 / Runcat Plugin Overview）的版本变更。

## [1.3.2] - 2026-10-19

### 交互（用户实测反馈）

- **启用/停用的结果提示改到该插件行下面**：以前它显示在**整个面板最底下**，
  列表一长就完全看不见。现在"⏳ 启用中… / ✅ 已启用 X / ❌ 切换失败"都作为
  **紧贴该插件的一整行**显示（跨列），长文案也有地方放；失败同样带「原因」可展开。
- **文案改为**：`已启用 <name>（热生效中，请点击右上角刷新按钮）`
  （英文：`Enabled: <name> (applying live — click Refresh at the top right to confirm)`）。
- 提示不会一闪而过：至少保留 5 秒可读；状态确实翻转后由后续刷新自动收掉，
  若没生效则一直留着（不会让人误以为成功）。点「刷新」也会立即收掉已生效的提示。

### 修复：宿主版本声明补上 0.2.1 线

- 之前 peer 范围是 `^0.1.0-rc.6 || ^0.2.0-rc.1`。按 semver 的预发布规则，
  `^0.2.0-rc.1` **不包含** `0.2.1-rc.2`（预发布比较按 `major.minor.patch` 三元组
  逐段判断），所以本机宿主升到 **0.2.1-rc.2** 后，严格校验会判成不兼容
  （市场侧因为用 `includePrerelease` 才没报错）。现在改为四段：
  **`^0.1.0-rc.6 || ^0.1.1-rc.1 || ^0.2.0-rc.1 || ^0.2.1-alpha.1`**，
  三条 peer 一致；实测严格/宽松两种判定都覆盖
  `0.1.0-rc.6 / 0.1.0-rc.8 / 0.1.1-rc.2 / 0.2.0-rc.2 / 0.2.1-alpha.4 / 0.2.1-rc.2`。

### 文档

- 按 git 提交日期修正历史条目：`1.2.0`/`1.1.0`/`0.4.1`/`0.4.0`/`0.3.8` → `2026-09-01`，
  `0.3.5`–`0.3.7` → `2026-08-28`（此前被复制粘贴成统一的 `2026-08-27`）。

### 测试

- 全量 **35 用例通过**；客户端冒烟通过，zh/en 各 **131** 键成对。

### 发布

- npm：`dsh-plugin-runcat-inventory@1.3.2`
- GitHub：https://github.com/runcat-tommy/dsh-plugin-runcat-inventory

## [1.3.1] - 2026-10-19

### 修复：点"启用/停用"完全没反应

- **现象**（用户实测）：点"启用"或"停用"后，行里的"已启用/已停用"完全不变。
- **根因**：`POST /runcat-api/set-enabled` 返回的其实是
  `{"ok":false,"code":"YAML_UNAVAILABLE","detail":"js-yaml 不可用（无法解析）"}`
  —— **宿主里根本解析不到 js-yaml**，于是补丁文件一个字节都没写，界面自然毫无变化。
  旧实现把"解析器缺失/解析失败"直接当成这次操作的失败，而界面只显示一句笼统提示。
- **修法**：启用/停用改成**纯文本编辑**，不再解析/重排 YAML：
  - 停用 = 在 `cordis.patch.yml` 末尾追加一个带标记注释的顶层项
    `- id: … / name: … / disabled: true`（文件只有 `[]` 时替换掉这一行）；
  - 启用 = 精确删除带标记的那一段（兼容旧版写入的无标记项），删到一项不剩时补回 `[]`；
  - 其余字节（用户的注释、`!!js`、排版、结尾换行）**原样保留**，幂等、可重复点。
  - 顺带解决了旧实现的另一类破坏：js-yaml 4.x 重序列化会重排整个文件、丢注释。
- 移除对 js-yaml 的依赖（连同 `getYaml` / `!!js` 占位符往返那一整套），
  也避免了"解析失败被永久缓存"这种一次失败、后面全失败的坑。

### 验证

- 新增用例：**没有 js-yaml 的 profile 也能写停用补丁**（正是本次故障场景）、
  停用/启用幂等、文件末尾换行保留；全量 **35 用例通过**。
- 真机实测（桌面端 0.2.1-rc.2）：调用 `set-enabled` 停用 `dsh-view-manager` →
  响应 `{"ok":true}`、行状态变为"已停用"；再启用 → 恢复"已启用/已挂载"；
  `cordis.patch.yml` 已逐字节还原，无残留。

## [1.3.0] - 2026-10-19

### 交互（用户实测反馈）

- **弹窗不再占用界面**：点"确认更新/确认卸载"后弹窗**立刻关闭**，进度改在**列表行内**显示；
  弹窗任何时候都能点遮罩/取消关掉，操作进行中也不会再挡住整个 DSH。
- **行内显示结果与下一步**（不再是一句会被忽略的提示）：
  - 成功且已生效 → `✅ 已更新到 vX，已生效`
  - 成功但需重启 → `✅ 已更新到 vX，重启 DSH 后使用`
  - 已是最新 → `✅ 已是最新版本（vX）`
  - 失败 → `❌ 更新失败` + 右侧「原因」按钮，点开显示错误码、详细原因、执行的命令、
    退出码、stderr 尾巴（最多 1200 字符）
  - 卸载同理：`✅ 已卸载 X` / `✅ 已卸载 X，重启 DSH 后移除` / `❌ 卸载失败 + 原因`
- **启用/停用保持原样**（按钮变"启用中…/停用中…" + 顶部一句提示）。

### 新功能

- **顶部横幅两个按钮**：
  - **「更新全部插件（N）」**：串行逐个更新，每行独立显示进度与结果，完成后自动
    尝试热应用并汇总（`N/M 个已更新 · 已生效，无需重启` / `… 重启 DSH 后生效`；
    有失败时补一句"X 个失败，点行内『原因』查看"）。
  - **「重启 DSH」**：二次确认后重启宿主。**CLI 宿主**（`dsh web`）由脱离父进程的
    助手等端口释放后用同一 CLI 重新拉起，页面自动轮询等服务回来后刷新；
    **桌面端**由 Electron 外壳管理宿主，插件内杀进程会让界面进入故障页，因此返回
    明确提示（`DESKTOP_RESTART_UNSUPPORTED`）并指引退出后重开，而不是假装成功。
- **热应用（HMR）**：更新/卸载成功后调用 DSH 自带的 `hmr.reconcileProfile(ids)`
  （官方插件管理器用的同一个服务）就地应用补丁层与依赖变更——**能应用就不用重启**，
  返回体带 `applied` / `need_restart` / `apply_reason`；界面据此显示"已生效"或"重启后使用"。
  新增 `POST /runcat-api/apply-changes`（手动触发热应用）。

### 说明

- 桌面端限制来自实测（读 `app.asar/lib/main.js`）：外壳只认 `ready` /
  `shutdown-complete` / `platform-session` 三种宿主事件，没有任何"请求重启"的通道，
  且宿主退出会被判成故障，所以插件无法安全地自动重启桌面端宿主。

### 测试

- update 9 → 13 用例：新增 HMR 热应用成功、HMR 表示需重启、`apply-changes` 无 HMR
  时返回 `HMR_UNAVAILABLE`、桌面端 `/restart` 返回 `DESKTOP_RESTART_UNSUPPORTED`
  且**不当场退出**。
- 全量：mock 7 + update 13 + patch 8 + compat 6 = **34 用例通过**；
  客户端冒烟（skill 脚本）通过，zh/en 各 **130** 键成对。

## [1.2.3] - 2026-10-19

### 修复（DSH Desktop 0.2.1-rc.2 实测，与"版本不兼容"无关）

- **更新 / 卸载必然失败：`dsh` 根本不在宿主进程的 PATH 里**。旧实现直接
  `spawn('dsh', …)`，而桌面端只把 CLI 装在
  `<resources>\runtime\cli\bin\dsh.cmd`，既不在系统 PATH、也不在
  `%APPDATA%\npm`（实测 `where dsh` 无结果）。于是每次点击都拿到
  `'dsh' 不是内部或外部命令`，被笼统报成"更新失败 / 卸载失败"。
  - 新增 `resolveDshCli()`：按 **`RUNCAT_DSH_CLI` 覆盖 → 宿主可执行文件 +
    asar 内 `dsh-desktop-host/lib/cli.js`（`shell:false`，不依赖 PATH）→
    PATH 里的 `dsh.cmd`/`dsh` → 平台常见安装位置** 的顺序解析，并缓存；
    启动时把选中的入口记进日志。
  - 完全找不到时返回新错误码 **`DSH_CLI_NOT_FOUND`** 并给出可操作提示
    （设置 `RUNCAT_DSH_CLI`），不再伪装成普通失败。
- **启用/停用会把补丁层写成坏 YAML**：只要 `cordis.patch.yml` 里有一句
  `!!js`（DSH 补丁层本就允许），`yaml.load()` 就抛
  `unknown tag !<tag:yaml.org,2002:js>` → `PATCH_PARSE_FAILED`，**整片启用/停用失败**。
  - 注册 `!!js` 自定义类型（读成字符串），并做**占位符往返**：写回时把原始代码
    一字不改地还原成 `!!js "<code>"`。实测 3 处 `!!js` 往返后逐字一致。
- **写回时静默删掉用户注释**：js-yaml 4.x 不保存注释，旧实现只留住文件头。
  实测 47 行注释里只有 3 行活下来。现在把原文所有注释行按顺序收在文件头并
  加一行说明，**不再丢内容**。

### 交互优化

- **"启用"→"启用中…"、"停用"→"停用中…"**：点击立刻换文案并禁用按钮，
  同时顶部显示 `启用中… <插件名>`，不用再猜有没有点上。
- **"更新"→"更新中…"、"卸载"→"卸载中…"**：确认后按钮与行内按钮立即进入
  进行中文案，且期间**其它操作按钮一并禁用**（不再可能重复点）。
- **卸载按钮只在可能成功的行上出现**：内置负载/非 profile 依赖
  （`sourceKind=other`）不再显示"卸载"——点了必然 `NOT_INSTALLED`。
- 新增字典项（zh/en 各 105 键）：`enabling` / `disabling` / `uninstalling` /
  `errCliNotFound`。

### 测试

- 新增 `test/patch-test.mjs`（8 用例）：`!!js` 能读且写回**逐字保真**、
  用户注释保留、写回结果仍可解析、再启用同样保真、桌面端 CLI 解析
  （`<exe>` + asar 内 cli.js、`shell:false`）、`RUNCAT_DSH_CLI` 指定 `.cmd`
  时走 shell、找不到 CLI → `DSH_CLI_NOT_FOUND`。
- 全量：mock 7 + update 9 + patch 8 + compat 6 = **30 用例通过**。

### 已知的"不是本插件问题"

- 桌面 DSH **0.2.1-rc.2** 会对 `@michengai/dsh-archive-manager@1.0.19` 报
  "incompatible，profile startup denies it"——那是该插件的 peer 范围没覆盖
  0.2.1，与总览插件无关，`dsh plugin` 每次运行都会打印这条警告。
- 若 profile 的供应链年龄策略拒绝某个**已锁定的**包，`dsh plugin add/remove`
  整体会失败（`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`），这次更新会被挡在
  pnpm 那一层，错误原文会显示在界面提示里。

## [1.2.2] - 2026-10-16

### 修复

- **更新按钮对任何依赖都不可能真正生效**（1.2.0 起就存在）。执行的是
  `dsh plugin --profile <p> add <name>`，**不带版本**；pnpm 的语义是"已装了
  任意满足 specifier 的版本就不再动作"——打印 `Already up to date`、exit 0、
  版本不动，精确版本与范围版本都一样。紧接着的"安装后校验"于是把这次空转
  判成 `VERSION_MISMATCH`，界面显示"更新失败"，detail 还把原因推给"npm 镜像
  同步延迟"，方向指错。
  - 现在先查 `latest`、把版本带进命令：`add <name>@<latest>`（`fetchLatestVersion`
    从"仅自检"改成"先取目标再装"，成功后仅用于复核）。
  - **跳过 `link:` / `file:` / `workspace:` 依赖**：带版本的 `add` 会把本地
    开发链接**静默替换成 registry 安装**，这类依赖现在返回新错误码
    `NOT_UPDATABLE`，**根本不 spawn 任何命令**。
  - **区分"没有更新"与"更新失败"**：本地版本已 ≥ npm `latest`（含镜像回退、
    预发布线）时返回 `ALREADY_LATEST`（`ok: true`、`need_restart: false`），
    界面显示"已是最新版本"而不是失败；`VERSION_MISMATCH` 收窄为"确实比目标
    旧"，文案改成"npm 源可能尚未同步，请稍后重试"。
  - 返回体新增 `from_version` / `to_version`（例如 `2.0.2 → 2.0.4`），
    "重启生效"提示能显示真实跨版本；`latest` 查不到时会记一条 warn 日志。
- **1.2.1 的 peer 声明不生效，市场仍判 `unknown`**。市场只统计「既在宿主包
  清单内、又匹配 `@deepseek-ai/dsh*`」的 peer
  （`dshmarket/lib/discovery-compatibility.js` 的 `deriveHostCompatibility`），
  而 1.2.1 声明的唯一一条 `@deepseek-ai/dsh-client-runtime` **恰好是桌面端
  app.asar 宿主清单里不存在的那一个**（284 个包里有 `dsh-client-locale`、
  `dsh-client-ui-settings`，没有 `dsh-client-runtime`）→ 一条都不计入。
  - `package.json` 两处同步补齐为三件套（与 `dsh-skill-mini-manager` 同构）：
    `dsh.client.inject` 与 `peerDependencies` 都加上
    `@deepseek-ai/dsh-client-locale`、`@deepseek-ai/dsh-client-ui-settings`，
    范围同为 `^0.1.0-rc.6 || ^0.2.0-rc.1`。补上后上述两条计入 → `compatible`。

### 测试

- 新增 `test/update-test.mjs`（9 用例，串行、离线、不 spawn 真进程）：
  ① 断言实际 argv 带 `name@<latest>`（范围与精确 specifier 各一）；② 假命令
  exit 0 但版本不变 → `VERSION_MISMATCH`，不静默成功；③ `link:`/`file:`/
  `workspace:` → 不执行任何命令（且不先打 registry）；④ 已扫描到
  `latest == 已装版本` → `ALREADY_LATEST`；⑤ 非 0 退出 → `UPDATE_FAILED`；
  ⑥ registry 不可达 → 不谎报版本。
- 新增 `test/compat-test.mjs`：直接调用市场的 `corePackageNames` +
  `deriveHostCompatibility`（不用 HOST_FALLBACK 兜底，避免假绿），断言
  `status === 'compatible'`、`declarations.length >= 1`、`peerDependencies`
  与 `dsh.client.inject` 双向同步；并从 `app.asar` 头部索引重建桌面端布局的
  清单复核（该布局下旧声明确实判 `unknown`，新声明判 `compatible`）。
- `test/mock-test.mjs` 不再硬编码某台机器的安装路径（改为定位本仓库源码 +
  自动查找 js-yaml），`npm test` 串联三个测试文件。
- 实测：mock 7 + update 9 + compat 6 = **22 用例全部通过**；宿主
  `0.2.0-rc.2`。

### 发布

- npm：`dsh-plugin-runcat-inventory@1.2.2`
- GitHub：https://github.com/runcat-tommy/dsh-plugin-runcat-inventory

## [1.2.1] - 2026-10-16

### 修复

- **补上宿主版本要求（peer 声明）**：本包此前没有 `peerDependencies`，社区市场只能把它判为 `unknown`。市场只认三类声明——`engines.dsh`，以及 `peerDependencies` 里既在**宿主包清单**内、又匹配 `@deepseek-ai/dsh*` 的项（`dshmarket/lib/discovery-compatibility.js` 的 `deriveHostCompatibility`）；一条都没有，插件就无法声明「我支持 0.2.x」。
  - 现补 1 条，正是 `dsh.client.inject` 已声明的那个包：`@deepseek-ai/dsh-client-runtime`，范围为 **`^0.1.0-rc.6 || ^0.2.0-rc.1`**。
  - 为什么是两段式：只写 `^0.2.0-rc.1` 会把仍在 0.1.x 宿主上的用户判成 `incompatible`；两段式同时覆盖 `0.1.0-rc.6` / `0.1.0-rc.8` / `0.1.1-rc.2` / `0.2.0-rc.2` / `0.2.1-alpha.4`。**日后两条线若不可兼得，以 0.2.x 为准，放弃 0.1.x。**

### 说明

- 运行时代码零改动：`lib/` 与 1.2.0 逐字节相同（本包版本号只出现在 `package.json` 与文档里）。
- 实测证据（宿主 `0.2.0-rc.2`，验收工具为仓库外的 `verify-compat.mjs`，判定直接复用 dshmarket 自己的函数）：改前 `unknown` → 改后 `compatible`；`profiles/web` 体检本插件无 peer 警告；插件在 0.2.0-rc.2 上正常加载。
- 遗留（本次未动）：仓库缺 `screenshots.json`，按市场规则会退化为从 README 抽图，过滤较严，详情页可能没有 UI 预览图。

### 发布

- npm：`dsh-plugin-runcat-inventory@1.2.1`
- GitHub：https://github.com/runcat-tommy/dsh-plugin-runcat-inventory

## [1.2.0] - 2026-09-01

### 新功能：更新提醒

- **版本检测**：host 查询 `registry.npmjs.org/<pkg>/latest`，与本地版本做
  极简 semver 比较；**分批扫描**（每批 4 个、批间 200ms、并发 4、单包 8s
  超时、成功缓存 1h / 失败冷却 30s）；本插件自身排第一批。
- **本插件自更新卡片**：自身有新版本时在**面板最上方**显示醒目卡片
  （当前版本 → 最新版本 + 更新日志链接 + "立即更新 / 暂时不用"）；
  更新后卡片变为"重启生效"提示。
- **其他插件更新**：版本列 `vX → vY` 高亮（新版本蓝色）+ 操作列主色
  "更新"按钮 + 顶部横幅（计数与名称）。
- **更新执行**：确认弹窗 → host 串行执行 `dsh plugin --profile <p> add <name>`
  （并发进行中返回 `BUSY`）→ **安装后版本校验**（命令成功但版本未变 →
  `VERSION_MISMATCH`，提示 npm 镜像同步延迟）→ 成功标记"重启生效"
  （`pendingRestart`，整行琥珀色徽章 + 操作置灰）。
- **来源语义**：仅 profile 依赖且非 link/file/builtin 的包参与检测；
  github 源更新时弹窗提示"将切换为 npm 源"。
- **开关**：环境变量 `RUNCAT_SKIP_UPDATE_SCAN=1` 可关闭扫描（离线/测试）。
- 新增错误码：`BUSY / UPDATE_FAILED / VERSION_MISMATCH`（客户端字典翻译，
  zh/en）。

### 测试

- mock 新增 update 守卫用例（MISSING_PARAMS / NOT_INSTALLED，不触发真实
  进程）；测试环境关闭版本扫描保持离线。7 用例全部通过。

---

## [1.1.0] - 2026-09-01

### 里程碑

- **版本线提升至 1.x**：自 0.4.x 以来的全部功能随本版发布——卸载（二次确认、
  防自卸/内置包、已卸载标记）、入口迁移至设置左侧导航、中英双语界面、
  npm 一键安装等。
- **发布到 npm**：https://www.npmjs.com/package/dsh-plugin-runcat-inventory
  （1.1.0，MIT，零依赖）。

---

## [0.4.1] - 2026-09-01

### 改进

- **列表标记已卸载插件**：host 在进程内记录卸载成功的插件名，inventory 行
  带 `uninstalled` 标记；已卸载的行在列表中显示红色"**已卸载**"徽章、
  整行置灰、操作列按钮全部替换为置灰提示——用户一眼可知哪些已卸载，
  不会重复点击。
- **自愈**：若某插件后来重新成为 profile 依赖，标记自动清除。

---

## [0.4.0] - 2026-09-01

### 新功能

- **卸载**：操作列新增"卸载"按钮 + 二次确认弹窗；host 执行
  `dsh plugin --profile <当前 profile> remove <包名>`，从 profile 移除
  依赖与 bundle 层（pnpm remove + reconcile），**重启 Web UI 生效**。
  守卫：禁止卸载本插件自身（`SELF_UNINSTALL_DENIED`）；非 profile 依赖
  （内置包等）不可卸载（`NOT_INSTALLED`）。

### 变更

- **入口迁移**：从"设置 → 插件 → 逃咪-插件总览"（`settings.plugins.tab`
  选项卡）迁移到**设置左侧导航**（`settings.section`，order 16，紧跟
  "插件"之后）——入口直接显示在 **设置 → 逃咪-插件总览**。原选项卡
  已移除。

### 测试

- mock 新增卸载守卫用例（MISSING_PARAMS / SELF_UNINSTALL_DENIED /
  NOT_INSTALLED，均不触发真实进程）。6 用例全部通过。

---

## [0.3.8] - 2026-09-01

### 变更

- **安装新增"方法 A：npm 安装"**（最简，推荐）：
  `dsh plugin --profile web add dsh-plugin-runcat-inventory`；原"本地目录
  安装"和"GitHub 源安装"顺延为方法 C / B；中英文 README 同步。
- **`package.json` 增加 `dsh.marketplace` 声明**：
  `{profiles: ["web"], requiresBuildApproval: false, requiresRestart: true, manualSteps: false}`，
  供 dsh-plugin-marketplace 扫描器正确分类（纯 JS、无构建、web 平台）。

---

## [0.3.7] - 2026-08-28

### 发布

- **已发布到 npm**：https://www.npmjs.com/package/dsh-plugin-runcat-inventory
  （v0.3.7，MIT，零依赖）。此后可直接 `dsh plugin --profile web add
  dsh-plugin-runcat-inventory` 从 npm 安装。
- 发布前补全包元信息：`author` / `homepage` / `bugs` / `publishConfig`
  （registry 固定为官方源）/ `files` 扩展（含文档与效果图）/ `keywords`
  新增 `dsh-plugin`；新增 MIT `LICENSE`（Copyright runcat-tommy）。
- **npm 页面 README 为英文**：npm 只渲染 `README.md`，发布时临时用
  `README.en.md` 内容替换 `README.md`，发布后恢复中文。**未来每次发布
  需重复此步骤**（或改回中文页面，见 README 说明）。

### 文档

- **新增效果预览图**：`assets/preview-zh.png`（中文界面）、
  `assets/preview-en.png`（英文界面）；中文 README 新增"效果预览"章节
  展示中文截图，英文 README 新增 "Screenshot" 章节展示英文截图。

---

## [0.3.6] - 2026-08-28

### 文档

- **新增英文版更新记录 `CHANGELOG.en.md`**：完整英文翻译；两份 CHANGELOG
  顶部互加语言切换链接（`中文 | English`）。
- 英文 README 的更新记录链接指向英文 CHANGELOG。

---

## [0.3.5] - 2026-08-28

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

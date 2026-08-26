# dsh-plugin-runcat-inventory（逃猫-插件总览）

一个更好用的 DSH 插件列表：**表格视图、状态过滤、启用/停用开关（热生效）、配置查看与复制**。
与官方"插件列表"并存，注册在 设置 → 插件 → 逃猫-插件总览。

## 功能

| 能力 | 说明 |
|---|---|
| 表格视图 | 名称 / 状态 / 版本 / 来源 / 描述 / 配置 / 操作 七列 |
| 运行状态 | 已启用/已停用 + Cordis 状态（已挂载 / 等待依赖 / 加载中 / 挂载失败 / 未挂载 / 卸载中） |
| 描述 / 版本 | 从各包 `package.json` 读取 |
| 来源 | 本地链接 (link) / 本地路径 (file) / GitHub 安装 / npm 包 / 内置 |
| 配置内容 | 行内展开查看 JSON + 一键复制 |
| 启用 / 停用 | 编辑 profile 的 `cordis.patch.yml`（用户覆盖层），**HMR 热生效，无需重启** |
| 搜索过滤 | 关键字（名称/id/描述/来源/版本）+ 状态筛选 |
| 排序 | 按 loader 配置顺序（bundle 层顺序） |

## 结构

```
runcat-inventory/
├── package.json      # dsh.bundle.patch + dsh.client 声明
├── cordis.patch.yml  # 补丁层：把本插件条目 insert 进根 entry 列表
├── lib/
│   ├── index.js      # Host 半端：loader 清单 + /runcat-api 路由 + patch 文件编辑
│   └── client.js     # 浏览器半端：ModuleLoader bundle，表格 UI
└── README.md
```

## 安装

```sh
cd runcat-inventory
dsh plugin --profile web add .
```

验证：`dsh --profile web --dump-config` 末尾应出现 `runcat-inventory` 条目。
然后**重启 Web UI**，进入 设置 → 插件 → 逃猫-插件总览。

## 工作原理

- **数据**：Host 端遍历 `ctx.loader.entries()`（与官方 inventory 相同），
  fiber 状态映射自 FiberState；描述/版本读各包 package.json；来源读
  profile 的 `package.json` 依赖声明。
- **启用/停用**：向 `~/.dsh/profiles/web/cordis.patch.yml` 写入
  `{id, name, disabled: true}` 补丁（停用）或移除该补丁（启用）。
  该文件被 DSH 通过 HMR 监听（`watchUserPatches`），改动自动热应用到
  loader —— 插件立即停用/启用，无需重启。
- **通信**：浏览器半端同源 fetch → `/runcat-api` 路由；路由带 loopback
  信任校验（防远程网站 CSRF）。
- **js-yaml 惰性解析**：插件以 link: 安装时真实路径在工作区（无
  node_modules），因此运行时锚定 profile 目录解析 js-yaml。

## 卸载

```sh
dsh plugin --profile web remove dsh-plugin-runcat-inventory
```

## 已知限制

- 若 `cordis.patch.yml` 含 `!!js` 表达式，启用/停用开关会提示失败（不
  会破坏文件，仅无法自动编辑）。
- 停用补丁按 `{id, name, disabled: true}` 精确匹配移除；与用户手写内容
  冲突时以"恰好三个键"为准。

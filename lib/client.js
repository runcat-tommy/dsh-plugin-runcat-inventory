/**
 * dsh-plugin-runcat-inventory —— 浏览器半端（逃咪-插件总览 / Runcat Plugin Overview）
 *
 * 手写 ModuleLoader bundle（无构建步骤，与 dsh-plugins-market 同款写法）：
 *   - 入口直接注册到设置页左侧导航（settings.section），不再作为
 *     “设置 → 插件”里的选项卡；
 *   - 国际化：通过 DSH 内置 locale 服务注册 zh/en 字典，界面语言跟随
 *     DSH 环境（浏览器语言 + 设置 → 通用 → Language）自动切换；
 *   - 数据全部来自同源 fetch → host 半端的 /runcat-api 路由（host 返回
 *     错误码与来源 kind，显示文案由本端字典翻译）；
 *   - 表格视图（4 列）：名称(含 id+版本) / 状态 / 来源 / 操作；
 *   - 操作：启用/停用（热生效）、复制名称、详情（展开描述+配置）、复制配置、
 *     卸载（二次确认，需重启生效；不可卸载自身与内置包）；
 *   - 搜索框（联合搜索）+ 状态过滤 + 排序（配置顺序/名称↑↓）；
 *   - 键盘 ←/→ 横向滚动；窄屏隐藏"来源"列。
 */

window.__ModuleLoader__.load({
  id: "dsh-plugin-runcat-inventory",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var React = require("react");

    // ── 字典命名空间（locale 服务按此注册/绑定）──────────────────────
    var NS = "settings.runcatInventory";

    // ── 样式：注入 <style>，全部走主题 CSS 变量 ────────────────────────
    var CSS = [
      ".rci-panel{display:flex;flex-direction:column;gap:10px;padding:2px 0 24px}",
      ".rci-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
      ".rci-search{flex:1;min-width:160px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);border-radius:6px;padding:6px 10px;font-size:12px}",
      ".rci-search:focus{border-color:var(--dsw-alias-brand-primary);outline:none}",
      ".rci-select{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);border-radius:6px;padding:5px 8px;font-size:12px;cursor:pointer}",
      ".rci-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;white-space:nowrap}",
      ".rci-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}",
      ".rci-btn:disabled{opacity:.5;cursor:default}",
      ".rci-btn.primary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-label-primary));color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-layer-3));border-color:transparent}",
      ".rci-btn.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-button-primary-fill))}",
      ".rci-btn.danger:hover:not(:disabled){border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}",
      ".rci-status{color:var(--dsw-alias-label-tertiary);font-size:12px}",
      ".rci-error{color:var(--dsw-alias-state-error-primary);font-size:12px}",
      ".rci-ok{color:var(--dsw-alias-state-success-primary);font-size:12px}",
      ".rci-info{color:var(--dsw-alias-label-secondary);font-size:12px}",
      // 表格容器：可横向滚动 + 键盘聚焦样式
      ".rci-tablewrap{overflow-x:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-3)}",
      ".rci-tablewrap:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:10px}",
      // 表格：固定布局 + 比例列宽（colgroup：名称36% / 状态15% / 来源21% / 操作28%）
      ".rci-table{width:100%;table-layout:fixed;border-collapse:separate;border-spacing:0;font-size:12px;min-width:560px}",
      ".rci-table th{color:var(--dsw-alias-label-tertiary);font-weight:500;text-align:left;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);white-space:nowrap;font-size:11px;background:var(--dsw-alias-bg-layer-3)}",
      ".rci-table td{padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top;background:var(--dsw-alias-bg-layer-3)}",
      ".rci-table tr:last-child td{border-bottom:none}",
      ".rci-table tr:hover td{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}",
      // 展开行：底色区分（无粘性列，无需特殊定位）
      ".rci-table td.rci-expandcell{background:var(--dsw-alias-bg-layer-2)}",
      ".rci-table tr.rci-expandrow:hover td.rci-expandcell{background:var(--dsw-alias-bg-layer-2)}",
      ".rci-name{color:var(--dsw-alias-label-primary);font-weight:600;word-break:break-all}",
      ".rci-id{color:var(--dsw-alias-label-tertiary);font-size:11px;word-break:break-all;margin-top:2px}",
      ".rci-version{color:var(--dsw-alias-label-tertiary);font-size:11px;word-break:break-all;margin-top:2px}",
      ".rci-muted{color:var(--dsw-alias-label-tertiary)}",
      // 来源内容：强制断行，避免长 URL 溢出到相邻列
      ".rci-source{word-break:break-all;overflow-wrap:anywhere}",
      ".rci-badge{display:inline-block;font-size:10px;line-height:1;padding:3px 6px;border-radius:4px;white-space:nowrap}",
      ".rci-badge.on{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);color:var(--dsw-alias-state-success-primary)}",
      ".rci-badge.off{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent);color:var(--dsw-alias-state-warn-primary)}",
      ".rci-badge.active{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);color:var(--dsw-alias-state-success-primary)}",
      ".rci-badge.pending,.rci-badge.loading{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent);color:var(--dsw-alias-state-warn-primary)}",
      ".rci-badge.failed{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:var(--dsw-alias-state-error-primary)}",
      ".rci-badge.muted{background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-tertiary)}",
      ".rci-badge.uninstalled{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:var(--dsw-alias-state-error-primary)}",
      ".rci-badge.updated{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent);color:var(--dsw-alias-state-warn-primary)}",
      ".rci-row-uninstalled .rci-name{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}",
      ".rci-row-uninstalled td{opacity:.72}",
      ".rci-row-updated .rci-name{color:var(--dsw-alias-label-primary)}",
      ".rci-row-updated td{opacity:.85}",
      // 自更新卡片（最上方）
      ".rci-selfcard{display:flex;flex-direction:column;gap:8px;border:1px solid var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 8%,transparent);border-radius:10px;padding:12px 14px}",
      ".rci-selfcard.ok{border-color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 8%,transparent)}",
      ".rci-selfcard-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}",
      ".rci-selfcard-meta{font-size:12px;color:var(--dsw-alias-label-secondary)}",
      ".rci-selfcard-meta a{color:var(--dsw-alias-state-business-primary)}",
      ".rci-selfcard-actions{display:flex;gap:8px;align-items:center}",
      // 更新横幅
      ".rci-banner{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:space-between;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 8%,transparent);border:1px solid var(--dsw-alias-state-business-primary);border-radius:8px;padding:8px 12px;font-size:12px;color:var(--dsw-alias-label-primary)}",
      ".rci-banner-text{display:flex;flex-direction:column;gap:4px;flex:1;min-width:220px;word-break:break-all}",
      ".rci-banner-status{color:var(--dsw-alias-label-secondary);font-size:11px}",
      ".rci-banner-status.err{color:var(--dsw-alias-state-error-primary)}",
      ".rci-banner-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
      // 行内操作结果（进行中/成功/失败）：不进弹窗
      ".rci-op{display:inline-flex;align-items:center;gap:6px;font-size:11px;padding:3px 8px;border-radius:999px;line-height:1.4;max-width:100%}",
      ".rci-op.running{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary)}",
      ".rci-op.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);color:var(--dsw-alias-state-success-primary)}",
      ".rci-op.err{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary)}",
      ".rci-op-detail{color:var(--dsw-alias-label-secondary);font-size:11px;white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;max-height:200px;overflow:auto;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:8px;margin-top:6px}",
      // 操作结果行：紧贴在对应插件行下面，占满整行
      ".rci-oprow>td{padding:0 10px 8px;border-top:0}",
      ".rci-opcell{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
      ".rci-opcell .rci-op-detail{flex-basis:100%;margin-top:2px}",
      // 新版本高亮
      ".rci-new-version{color:var(--dsw-alias-state-business-primary);font-weight:600}",
      ".rci-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}",
      ".rci-exp-sec{display:flex;flex-direction:column;gap:6px;margin:4px 0}",
      ".rci-exp-title{color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600}",
      ".rci-exp-text{color:var(--dsw-alias-label-secondary);font-size:12px;white-space:pre-wrap;word-break:break-all}",
      ".rci-config{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:8px;margin:0;font-size:11px;overflow:auto;max-height:220px;white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace}",
      ".rci-empty{color:var(--dsw-alias-label-tertiary);font-size:12px;padding:16px;text-align:center}",
      // 确认弹窗（卸载）
      ".rci-modal-mask{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:1000}",
      ".rci-modal{background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:14px 16px;max-width:480px;width:calc(100% - 40px);display:flex;flex-direction:column;gap:10px}",
      ".rci-modal-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}",
      ".rci-warn{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-state-warn-primary);border-radius:8px;padding:10px 12px;font-size:12px;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-all}",
      ".rci-footer{display:flex;gap:8px;align-items:center;justify-content:flex-end}",
      // 窄屏：隐藏"来源"列
      "@media (max-width:900px){.rci-hide-narrow{display:none}}",
    ].join("");
    var tagId = "dsh-plugin-runcat-inventory/styles";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-plugin-runcat-inventory";
      tag.dataset.pluginCss = tagId;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    // ── 双语字典 ───────────────────────────────────────────────────────
    /** 简体中文（键值对即 key 源）。 */
    var zh = {
      tab: "逃咪-插件总览",
      colName: "名称",
      colStatus: "状态",
      colSource: "来源",
      colActions: "操作",
      searchPlaceholder: "搜索名称 / id / 描述 / 来源…",
      filterAll: "全部状态",
      filterEnabled: "已启用",
      filterDisabled: "已停用",
      filterActive: "已挂载",
      filterWaiting: "等待/加载中",
      filterFailed: "挂载失败",
      sortConfig: "配置顺序",
      sortNameAsc: "名称 ↑",
      sortNameDesc: "名称 ↓",
      refresh: "刷新",
      count: "共 {total} 个插件",
      countMatched: "，匹配 {matched}",
      loading: "正在读取插件…",
      loadFailed: "读取失败：{msg}",
      emptyNone: "暂无插件。",
      emptyNoMatch: "没有匹配的插件。",
      enabled: "已启用",
      disabled: "已停用",
      phaseTitle: "Cordis 状态",
      phaseActive: "已挂载",
      phasePending: "等待依赖",
      phaseLoading: "加载中",
      phaseFailed: "挂载失败",
      phaseUnloading: "卸载中",
      phaseUnobserved: "未挂载",
      toggleOn: "停用",
      toggleOff: "启用",
      toggling: "处理中…",
      copyName: "复制名称",
      copied: "已复制",
      details: "详情",
      collapse: "收起",
      descTitle: "描述",
      configTitle: "配置",
      copyConfig: "复制配置",
      // 本插件自身的描述（随界面语言切换；package.json description 保持中文作为 npm 元数据）
      selfDescription: "逃咪-插件总览：更好用的 DSH 插件列表 —— 表格视图、状态过滤、启用/停用开关（热生效）、配置查看与复制。",
      none: "—",
      ariaScroll: "插件列表（可用左右方向键横向滚动）",
      toggleOk: "已{action} {name}（热生效中，请点击右上角刷新按钮）",
      toggleDisable: "停用",
      toggleEnable: "启用",
      toggleFail: "切换失败：{msg}",
      toggleFailed: "切换失败",
      sourceLink: "本地链接 (link)",
      sourceFile: "本地路径 (file)",
      sourceGithub: "GitHub 安装",
      sourceNpm: "npm 包",
      sourceBuiltin: "内置（随 DSH 安装）",
      sourceOther: "其他",
      errMissingParams: "缺少 id 或 name",
      errProfileDir: "无法定位 profile 目录",
      errPatchRead: "无法读取 cordis.patch.yml",
      errPatchParse: "无法解析 cordis.patch.yml（可能含 !!js 表达式，请手动处理）",
      errPatchNotArray: "cordis.patch.yml 顶层必须是数组",
      errYamlUnavailable: "js-yaml 不可用",
      errYamlDump: "序列化失败",
      errPatchWrite: "写入失败",
      errBadRequest: "请求不合法",
      errBadJson: "请求体不是合法 JSON",
      errInventory: "读取插件清单失败",
      errForbidden: "请求被拒绝",
      errInternal: "内部错误",
      errUnknown: "未知错误",
      uninstallBtn: "卸载",
      uninstallTitle: "确认卸载",
      uninstallWarn: "将从当前 profile 移除依赖与 bundle 层，重启 Web UI 后生效。\n插件：{name}\n\n此操作不可撤销。",
      uninstallCancel: "取消",
      uninstallConfirm: "确认卸载",
      uninstallOk: "已卸载 {name}，重启 Web UI 后生效",
      uninstallFail: "卸载失败：{msg}",
      errSelfUninstall: "不允许卸载本插件自身",
      errNotInstalled: "该插件不是 profile 依赖，无法卸载",
      errRunFailed: "执行卸载命令失败",
      errUninstallFailed: "卸载失败",
      uninstalledTag: "已卸载",
      uninstalledHint: "重启 Web UI 后生效移除",
      updateBtn: "更新",
      updating: "更新中…",
      updateTitle: "更新插件",
      updateWarn: "将从 npm 更新 {name}：v{old} → v{new}。\n更新完成后需重启 DSH 生效。",
      updateGithubNote: "当前为 GitHub 源安装，更新后将切换为 npm 源。",
      updateCancel: "取消",
      updateConfirm: "确认更新",
      updateOk: "已更新到 v{version}，重启 DSH 后生效",
      updateSkip: "{name} 已是最新版本（v{version}），无需更新",
      updateFail: "更新失败：{msg}",
      updatedTag: "重启生效",
      updatedHint: "已更新 · 重启 DSH 后生效",
      selfUpdateTitle: "有新版本",
      selfUpdateLater: "暂时不用",
      selfUpdateLog: "查看更新日志",
      bannerText: "发现 {count} 个插件有新版本：",
      errBusy: "已有更新任务进行中，请稍候",
      errUpdateFailed: "更新失败",
      errVersionMismatch: "npm 源可能尚未同步，实际安装的仍是旧版本，请稍后重试",
      errNotUpdatable: "该插件是本地链接（link/file/workspace）安装，不能用更新按钮改用 npm 版本，请手动维护链接目录",
      // 进行中的按钮文案：点了就要立刻看到反馈，且不允许重复点
      enabling: "启用中…",
      disabling: "停用中…",
      uninstalling: "卸载中…",
      errCliNotFound: "找不到 dsh 命令：桌面端请设置环境变量 RUNCAT_DSH_CLI 指向 dsh.cmd 后重启 DSH",
      // 列表内的操作结果（不进弹窗）
      opUpdateFailed: "更新失败",
      opUninstallFailed: "卸载失败",
      opUpdatedApplied: "已更新到 v{version}，已生效",
      opUpdatedRestart: "已更新到 v{version}，重启 DSH 后使用",
      opAlreadyLatest: "已是最新版本（v{version}）",
      opUninstalledApplied: "已卸载 {name}",
      opUninstalledRestart: "已卸载 {name}，重启 DSH 后移除",
      opDetailCommand: "命令：{cmd}",
      opDetailExit: "退出码：{code}",
      opDetailShow: "原因",
      opDetailHide: "收起",
      // 顶部批量操作
      updateAllBtn: "更新全部插件（{count}）",
      updateAllNone: "所有插件都是最新版本",
      updateAllRunning: "正在更新 {done}/{total}…",
      updateAllDone: "{ok}/{total} 个已更新 · 已生效，无需重启",
      updateAllDoneRestart: "{ok}/{total} 个已更新 · 重启 DSH 后生效",
      updateAllFailed: "{failed} 个失败，点行内“原因”查看",
      restartBtn: "重启 DSH",
      restarting: "正在重启 DSH…",
      restartConfirmTitle: "重启 DSH",
      restartConfirmWarn: "将重新启动 DSH 宿主进程。正在运行的会话/任务会中断，重启后本页自动恢复。",
      restartConfirmOk: "确认重启",
      restartFailed: "重启失败：{msg}",
      restartTimeout: "重启后等待超时，请手动刷新页面",
      restartDesktopUnsupported: "桌面端由 Electron 外壳管理宿主进程，插件内无法自动重启；请关闭并重新打开 DeepSeek Harness（插件变更已写入，重启后生效）",
    };

    /** English dictionary checked against the Chinese key set. */
    var en = {
      tab: "Runcat Plugin Overview",
      colName: "Name",
      colStatus: "Status",
      colSource: "Source",
      colActions: "Actions",
      searchPlaceholder: "Search name / id / description / source…",
      filterAll: "All states",
      filterEnabled: "Enabled",
      filterDisabled: "Disabled",
      filterActive: "Mounted",
      filterWaiting: "Waiting / loading",
      filterFailed: "Mount failed",
      sortConfig: "Config order",
      sortNameAsc: "Name ↑",
      sortNameDesc: "Name ↓",
      refresh: "Refresh",
      count: "{total} plugins",
      countMatched: " ({matched} matched)",
      loading: "Loading plugins…",
      loadFailed: "Failed to load: {msg}",
      emptyNone: "No plugins.",
      emptyNoMatch: "No matching plugins.",
      enabled: "Enabled",
      disabled: "Disabled",
      phaseTitle: "Cordis status",
      phaseActive: "Mounted",
      phasePending: "Waiting for deps",
      phaseLoading: "Loading",
      phaseFailed: "Mount failed",
      phaseUnloading: "Unloading",
      phaseUnobserved: "Not mounted",
      toggleOn: "Disable",
      toggleOff: "Enable",
      toggling: "Working…",
      copyName: "Copy name",
      copied: "Copied",
      details: "Details",
      collapse: "Collapse",
      descTitle: "Description",
      configTitle: "Config",
      copyConfig: "Copy config",
      selfDescription: "Runcat Plugin Overview: a better DSH plugin list — table view, status filters, enable/disable switches (hot-applied), config viewer and copy.",
      none: "—",
      ariaScroll: "Plugin list (use ←/→ arrow keys to scroll)",
      toggleOk: "{action}: {name} (applying live — click Refresh at the top right to confirm)",
      toggleDisable: "Disabled",
      toggleEnable: "Enabled",
      toggleFail: "Toggle failed: {msg}",
      toggleFailed: "Toggle failed",
      sourceLink: "Local link",
      sourceFile: "Local path",
      sourceGithub: "GitHub install",
      sourceNpm: "npm package",
      sourceBuiltin: "Built-in (ships with DSH)",
      sourceOther: "Other",
      errMissingParams: "Missing id or name",
      errProfileDir: "Cannot locate the profile directory",
      errPatchRead: "Cannot read cordis.patch.yml",
      errPatchParse: "Cannot parse cordis.patch.yml (may contain !!js expressions; edit manually)",
      errPatchNotArray: "cordis.patch.yml top level must be an array",
      errYamlUnavailable: "js-yaml is unavailable",
      errYamlDump: "Serialization failed",
      errPatchWrite: "Write failed",
      errBadRequest: "Bad request",
      errBadJson: "Request body is not valid JSON",
      errInventory: "Failed to read the plugin inventory",
      errForbidden: "Request rejected",
      errInternal: "Internal error",
      errUnknown: "Unknown error",
      uninstallBtn: "Uninstall",
      uninstallTitle: "Confirm uninstall",
      uninstallWarn: "Removes the dependency and bundle layer from the current profile; takes effect after restarting the Web UI.\nPlugin: {name}\n\nThis action cannot be undone.",
      uninstallCancel: "Cancel",
      uninstallConfirm: "Uninstall",
      uninstallOk: "Uninstalled {name}; takes effect after restarting the Web UI",
      uninstallFail: "Uninstall failed: {msg}",
      errSelfUninstall: "Cannot uninstall this plugin itself",
      errNotInstalled: "Not a profile dependency; cannot uninstall",
      errRunFailed: "Failed to run the uninstall command",
      errUninstallFailed: "Uninstall failed",
      uninstalledTag: "Uninstalled",
      uninstalledHint: "Removed after restarting the Web UI",
      updateBtn: "Update",
      updating: "Updating…",
      updateTitle: "Update plugin",
      updateWarn: "Will update {name} from npm: v{old} → v{new}.\nTakes effect after restarting DSH.",
      updateGithubNote: "Installed from the GitHub source; this update switches it to the npm source.",
      updateCancel: "Cancel",
      updateConfirm: "Update",
      updateOk: "Updated to v{version}; takes effect after restarting DSH",
      updateSkip: "{name} is already up to date (v{version})",
      updateFail: "Update failed: {msg}",
      updatedTag: "Restart to apply",
      updatedHint: "Updated — restart DSH to apply",
      selfUpdateTitle: "Update available",
      selfUpdateLater: "Not now",
      selfUpdateLog: "View changelog",
      bannerText: "{count} plugin(s) have updates: ",
      errBusy: "An update is already in progress; please wait",
      errUpdateFailed: "Update failed",
      errVersionMismatch: "The npm source may not have synced yet — the installed version is still the old one; try again later",
      errNotUpdatable: "Installed from a local link (link/file/workspace); the update button cannot switch it to the npm release — maintain the linked directory instead",
      enabling: "Enabling…",
      disabling: "Disabling…",
      uninstalling: "Uninstalling…",
      errCliNotFound: "The dsh command was not found. On Desktop, set RUNCAT_DSH_CLI to the dsh.cmd path and restart DSH.",
      opUpdateFailed: "Update failed",
      opUninstallFailed: "Uninstall failed",
      opUpdatedApplied: "Updated to v{version} — applied",
      opUpdatedRestart: "Updated to v{version} — restart DSH to use it",
      opAlreadyLatest: "Already up to date (v{version})",
      opUninstalledApplied: "Uninstalled {name}",
      opUninstalledRestart: "Uninstalled {name} — removed after restarting DSH",
      opDetailCommand: "Command: {cmd}",
      opDetailExit: "Exit code: {code}",
      opDetailShow: "Reason",
      opDetailHide: "Hide",
      updateAllBtn: "Update all ({count})",
      updateAllNone: "Every plugin is up to date",
      updateAllRunning: "Updating {done}/{total}…",
      updateAllDone: "{ok}/{total} updated · applied, no restart needed",
      updateAllDoneRestart: "{ok}/{total} updated · restart DSH to apply",
      updateAllFailed: "{failed} failed — open “Reason” on the row",
      restartBtn: "Restart DSH",
      restarting: "Restarting DSH…",
      restartConfirmTitle: "Restart DSH",
      restartConfirmWarn: "This restarts the DSH host process. Running sessions/tasks are interrupted and this page reconnects automatically.",
      restartConfirmOk: "Restart",
      restartFailed: "Restart failed: {msg}",
      restartTimeout: "Timed out waiting for DSH to come back — refresh the page",
      restartDesktopUnsupported: "On Desktop the Electron shell owns the host process, so a plugin cannot restart it. Quit and reopen DeepSeek Harness (your changes are already on disk and take effect then).",
    };

    // ── React 小工具 ───────────────────────────────────────────────────
    function el(type, props) {
      var children = Array.prototype.slice.call(arguments, 2);
      return React.createElement.apply(React, [type, props].concat(children));
    }

    /** 简易模板替换：tr(t, "count", {total: 3}) → "共 3 个插件"。 */
    function tr(t, key, vars) {
      var s = t(key);
      if (!vars) return s;
      for (var k in vars) s = s.replace("{" + k + "}", String(vars[k]));
      return s;
    }

    function api(path, options) {
      return window.fetch(path, options).then(function (res) {
        return res.json().catch(function () {
          return { ok: false, code: "BAD_RESPONSE", detail: "HTTP " + res.status };
        });
      });
    }

    var PHASE_KEY = {
      active: "phaseActive",
      pending: "phasePending",
      loading: "phaseLoading",
      failed: "phaseFailed",
      unloading: "phaseUnloading",
    };

    var SORTS = [
      ["config", "sortConfig"],
      ["name-asc", "sortNameAsc"],
      ["name-desc", "sortNameDesc"],
    ];

    /** host 错误码 → 字典 key。 */
    var ERR_KEY = {
      MISSING_PARAMS: "errMissingParams",
      PROFILE_DIR_NOT_FOUND: "errProfileDir",
      PATCH_READ_FAILED: "errPatchRead",
      PATCH_PARSE_FAILED: "errPatchParse",
      PATCH_NOT_ARRAY: "errPatchNotArray",
      YAML_UNAVAILABLE: "errYamlUnavailable",
      YAML_DUMP_FAILED: "errYamlDump",
      PATCH_WRITE_FAILED: "errPatchWrite",
      BAD_REQUEST: "errBadRequest",
      BAD_JSON: "errBadJson",
      INVENTORY_FAILED: "errInventory",
      FORBIDDEN: "errForbidden",
      INTERNAL: "errInternal",
      BAD_RESPONSE: "errUnknown",
      SELF_UNINSTALL_DENIED: "errSelfUninstall",
      NOT_INSTALLED: "errNotInstalled",
      RUN_FAILED: "errRunFailed",
      UNINSTALL_FAILED: "errUninstallFailed",
      BUSY: "errBusy",
      UPDATE_FAILED: "errUpdateFailed",
      VERSION_MISMATCH: "errVersionMismatch",
      NOT_UPDATABLE: "errNotUpdatable",
      DSH_CLI_NOT_FOUND: "errCliNotFound",
      YAML_UNAVAILABLE: "errYamlUnavailable",
    };

    /** 判断配置是否"有内容"：null/undefined/空对象/空数组都算没有。 */
    function hasConfigContent(config) {
      if (config === null || config === undefined) return false;
      if (Array.isArray(config)) return config.length > 0;
      if (typeof config === "object") return Object.keys(config).length > 0;
      return true; // 标量（字符串/数字/布尔）也算有内容
    }

    function copyText(text, done) {
      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true) }, function () { done(false) });
        return;
      }
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand && document.execCommand("copy");
        document.body.removeChild(ta);
        done(Boolean(ok));
      } catch (e) {
        done(false);
      }
    }

    // ── 主面板（t 由槽位 inject 传入，见 apply）────────────────────────
    function InventoryPanel(props) {
      var t = (props && props.t) || function (key) { return key; };
      var _state = React.useState({ loading: true, error: null, rows: [] });
      var state = _state[0];
      var setState = _state[1];
      var _q = React.useState("");
      var q = _q[0];
      var setQ = _q[1];
      var _filter = React.useState("all");
      var filter = _filter[0];
      var setFilter = _filter[1];
      var _sort = React.useState("config");
      var sort = _sort[0];
      var setSort = _sort[1];
      var _expanded = React.useState({});
      var expanded = _expanded[0];
      var setExpanded = _expanded[1];
      var _copied = React.useState(null); // 复制反馈：'name:<id>' | 'config:<id>'
      var copied = _copied[0];
      var setCopied = _copied[1];
      var _toggleId = React.useState(null); // 正在切换的 patchId
      var toggleId = _toggleId[0];
      var setToggleId = _toggleId[1];
      var _msg = React.useState(null); // 操作结果反馈 {kind, text}
      var msg = _msg[0];
      var setMsg = _msg[1];
      var _confirming = React.useState(null); // 待确认操作 { row, action: 'uninstall' | 'update' }
      var confirming = _confirming[0];
      var setConfirming = _confirming[1];
      var _busy = React.useState(null); // 进行中的操作：'uninstall:<id>' | 'update:<name>' | 'batch'
      var busy = _busy[0];
      var setBusy = _busy[1];
      var _selfDismissed = React.useState(false); // 本插件自更新卡片"暂时不用"（会话内）
      var selfDismissed = _selfDismissed[0];
      var setSelfDismissed = _selfDismissed[1];
      // 每行的操作结果（显示在列表里，不进弹窗）：
      // { [rowKey]: { phase: 'running'|'ok'|'err', text, detail } }
      var _opStates = React.useState({});
      var opStates = _opStates[0];
      var setOpStates = _opStates[1];
      // 展开了"失败原因"的行
      var _opOpen = React.useState({});
      var opOpen = _opOpen[0];
      var setOpOpen = _opOpen[1];
      // 批量更新的整体进度 { running, done, total, ok, failed } | null
      var _batch = React.useState(null);
      var batch = _batch[0];
      var setBatch = _batch[1];
      // 重启状态：null | 'restarting' | { ok:false, text }
      var _restart = React.useState(null);
      var restart = _restart[0];
      var setRestart = _restart[1];

      var setOp = function (rowKey, value) {
        setOpStates(function (prev) {
          var next = Object.assign({}, prev);
          if (value === null) delete next[rowKey];
          else next[rowKey] = value;
          return next;
        });
      };

      var toggleOpDetail = function (rowKey) {
        setOpOpen(function (prev) {
          var next = Object.assign({}, prev);
          next[rowKey] = !prev[rowKey];
          return next;
        });
      };

      var load = function () {
        setState(function (prev) { return { loading: true, error: null, rows: prev.rows }; });
        api("/runcat-api/inventory").then(function (res) {
          if (!res.ok) {
            setState({ loading: false, error: tr(t, ERR_KEY[res.code] || "errUnknown"), rows: [] });
            return;
          }
          setState({ loading: false, error: null, rows: res.entries || [] });
          // 只有"启用/停用"真的生效了才清掉那行提示；没生效就留着，别让用户以为成功了
          var fresh = res.entries || [];
          setOpStates(function (prev) {
            var next = Object.assign({}, prev);
            var changed = false;
            for (var key in next) {
              var item = next[key];
              if (!item || item.kind !== "toggle" || item.phase === "running") continue;
              // 至少让那条提示留 5 秒可读，之后状态确实生效了才收掉
              if (Date.now() - (item.at ?? 0) < 5000) continue;
              var row = null;
              for (var i = 0; i < fresh.length; i++) { if (fresh[i].id === key) { row = fresh[i]; break; } }
              if (row && row.enabled === item.expectedEnabled) { delete next[key]; changed = true; }
            }
            return changed ? next : prev;
          });
        }).catch(function (err) {
          setState({ loading: false, error: tr(t, "loadFailed", { msg: String(err && err.message || err) }), rows: [] });
        });
      };

      React.useEffect(function () { load(); }, []);

      var toggle = function (row) {
        if (toggleId !== null || busy !== null) return // 已有操作在跑，别重复点
        setToggleId(row.patchId);
        // 进行中/结果都挂在这一行下面（不再塞面板最底下，那里用户看不见）
        setOp(row.id, { kind: "toggle", phase: "running", text: t(row.enabled ? "disabling" : "enabling") });
        api("/runcat-api/set-enabled", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: row.patchId, name: row.name, enabled: !row.enabled }),
        }).then(function (res) {
          setToggleId(null);
          if (res.ok) {
            var action = row.enabled ? tr(t, "toggleDisable") : tr(t, "toggleEnable");
            setOp(row.id, {
              kind: "toggle",
              phase: "ok",
              text: tr(t, "toggleOk", { action: action, name: row.name }),
              expectedEnabled: !row.enabled,
              at: Date.now(),
            });
            // 稍等 HMR 结算再刷新：1.2s 先刷一次状态，6.5s 再刷一次把提示收掉
            setTimeout(load, 1200);
            setTimeout(load, 6500);
          } else {
            setOp(row.id, {
              kind: "toggle",
              phase: "err",
              text: t("toggleFailed"),
              detail: failureDetail(res),
            });
          }
        }).catch(function (err) {
          setToggleId(null);
          setOp(row.id, {
            kind: "toggle",
            phase: "err",
            text: t("toggleFailed"),
            detail: String(err && err.message || err),
          });
        });
      };

      var copyName = function (row) {
        copyText(row.name, function (ok) {
          setCopied(ok ? "name:" + row.id : null);
          setTimeout(function () { setCopied(null); }, 1500);
        });
      };

      var copyConfig = function (row) {
        copyText(JSON.stringify(row.config, null, 2), function (ok) {
          setCopied(ok ? "config:" + row.id : null);
          setTimeout(function () { setCopied(null); }, 1500);
        });
      };

      var toggleExpand = function (row) {
        setExpanded(function (prev) {
          var next = {};
          next[row.id] = !prev[row.id];
          return Object.assign({}, prev, next);
        });
      };

      /** 把 host 的失败响应拼成可读的原因（列表里点 ⓘ 展开）。 */
      var failureDetail = function (res) {
        var parts = [];
        var known = ERR_KEY[res && res.code];
        if (known) parts.push(tr(t, known));
        if (res && res.detail) parts.push(String(res.detail));
        if (res && res.command) parts.push(tr(t, "opDetailCommand", { cmd: String(res.command) }));
        if (res && res.exit_code !== undefined && res.exit_code !== null) parts.push(tr(t, "opDetailExit", { code: String(res.exit_code) }));
        var tail = res && (res.stderr_tail || res.stdout_tail);
        if (tail) parts.push(String(tail).trim().slice(-1200));
        return parts.filter(Boolean).join("\n") || String((res && res.code) || "unknown");
      };

      // 卸载：确认后**立即关闭弹窗**，进度与结果都显示在列表里
      var doUninstall = function (row) {
        setConfirming(null);
        setBusy("uninstall:" + row.id);
        setOp(row.id, { phase: "running", text: t("uninstalling") });
        api("/runcat-api/uninstall", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: row.name }),
        }).then(function (res) {
          setBusy(null);
          if (res.ok) {
            setOp(row.id, {
              phase: "ok",
              text: res.applied === true
                ? tr(t, "opUninstalledApplied", { name: row.name })
                : tr(t, "opUninstalledRestart", { name: row.name }),
            });
            setTimeout(load, 800);
          } else {
            setOp(row.id, { phase: "err", text: t("opUninstallFailed"), detail: failureDetail(res) });
          }
        }).catch(function (err) {
          setBusy(null);
          setOp(row.id, { phase: "err", text: t("opUninstallFailed"), detail: String(err && err.message || err) });
        });
      };

      // 更新：确认后立即关闭弹窗；进度/结果在列表里，失败可展开看原因
      var doUpdate = function (row, quiet) {
        setConfirming(null);
        setBusy("update:" + row.name);
        setOp(row.id, { phase: "running", text: tr(t, "updating") });
        return api("/runcat-api/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: row.name }),
        }).then(function (res) {
          setBusy(null);
          if (res.ok) {
            // host 判断"已经是最新"（含本地版本已高于 npm latest 的情况）
            if (res.code === "ALREADY_LATEST") {
              setOp(row.id, {
                phase: "ok",
                text: tr(t, "opAlreadyLatest", { version: res.to_version || res.installed_version || row.version }),
              });
              return res;
            }
            var version = res.to_version || res.installed_version || row.latestVersion || "";
            // applied=true 表示 DSH 已热应用（不需要重启）
            setOp(row.id, res.applied === true
              ? { phase: "ok", text: tr(t, "opUpdatedApplied", { version: version }) }
              : { phase: "ok", text: tr(t, "opUpdatedRestart", { version: version }) });
            if (!quiet) setTimeout(load, 900);
          } else {
            setOp(row.id, { phase: "err", text: t("opUpdateFailed"), detail: failureDetail(res) });
          }
          return res;
        }).catch(function (err) {
          setBusy(null);
          setOp(row.id, { phase: "err", text: t("opUpdateFailed"), detail: String(err && err.message || err) });
          return { ok: false, code: "NETWORK", detail: String(err && err.message || err) };
        });
      };

      /** 批量更新：串行执行（host 侧本身也只允许一个），每行独立显示进度/结果。 */
      var updateAll = function (targets) {
        if (targets.length === 0 || busy !== null) return;
        setMsg(null);
        var total = targets.length;
        var done = 0;
        var failedCount = 0;
        setBatch({ running: true, done: 0, total: total, failed: 0, applied: false });
        var step = function () {
          if (done >= total) {
            setBusy(null);
            // 全部装完后让 DSH 自己热应用一次，能应用就不用重启
            api("/runcat-api/apply-changes", { method: "POST" }).then(function (res) {
              setBatch({ running: false, done: total, total: total, failed: failedCount, applied: res && res.applied === true });
              setTimeout(load, 800);
            }).catch(function () {
              setBatch({ running: false, done: total, total: total, failed: failedCount, applied: false });
              setTimeout(load, 800);
            });
            return;
          }
          var row = targets[done];
          setBusy("update:" + row.name);
          setOp(row.id, { phase: "running", text: tr(t, "updating") });
          api("/runcat-api/update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: row.name }),
          }).then(function (res) {
            if (res.ok && res.code !== "ALREADY_LATEST") {
              setOp(row.id, res.applied === true
                ? { phase: "ok", text: tr(t, "opUpdatedApplied", { version: res.to_version || "" }) }
                : { phase: "ok", text: tr(t, "opUpdatedRestart", { version: res.to_version || "" }) });
            } else if (res.ok) {
              setOp(row.id, { phase: "ok", text: tr(t, "opAlreadyLatest", { version: res.to_version || row.version }) });
            } else {
              failedCount += 1;
              setOp(row.id, { phase: "err", text: t("opUpdateFailed"), detail: failureDetail(res) });
            }
          }).catch(function (err) {
            failedCount += 1;
            setOp(row.id, { phase: "err", text: t("opUpdateFailed"), detail: String(err && err.message || err) });
          }).then(function () {
            done += 1;
            setBatch(function (prev) {
              return Object.assign({}, prev, { done: done, failed: failedCount });
            });
            step();
          });
        };
        step();
      };

      /** 重启 DSH：能重启就重启并等它回来；桌面端不支持则给出明确指引。 */
      var doRestart = function () {
        setConfirming(null);
        setRestart("restarting");
        api("/runcat-api/restart", { method: "POST" }).then(function (res) {
          if (res && res.ok) {
            var tries = 0;
            var poll = function () {
              tries += 1;
              api("/runcat-api/inventory").then(function () {
                window.location.reload();
              }).catch(function () {
                if (tries < 60) setTimeout(poll, 1200);
                else setRestart({ ok: false, text: t("restartTimeout") });
              });
            };
            setTimeout(poll, 1500);
            return;
          }
          var code = res && res.code;
          if (code === "DESKTOP_RESTART_UNSUPPORTED") {
            setRestart({ ok: false, text: t("restartDesktopUnsupported") });
          } else {
            setRestart({ ok: false, text: tr(t, "restartFailed", { msg: tr(t, ERR_KEY[code] || "errUnknown") }) });
          }
        }).catch(function (err) {
          setRestart({ ok: false, text: String(err && err.message || err) });
        });
      };

      // 过滤：关键字（名称/id/描述/来源/版本）+ 状态
      var keyword = q.trim().toLowerCase();
      var filtered = state.rows.filter(function (row) {
        if (filter === "enabled" && !row.enabled) return false;
        if (filter === "disabled" && row.enabled) return false;
        if (filter === "failed" && row.fiberPhase !== "failed") return false;
        if (filter === "waiting" && row.fiberPhase !== "pending" && row.fiberPhase !== "loading") return false;
        if (filter === "active" && row.fiberPhase !== "active") return false;
        if (keyword === "") return true;
        var hay = [row.name, row.id, row.description, row.sourceKind, row.sourceSpec, row.version].join("\n").toLowerCase();
        return hay.indexOf(keyword) !== -1;
      });

      // 排序：默认配置顺序；可选按名称
      var rows = filtered.slice();
      if (sort === "name-asc") {
        rows.sort(function (a, b) { return a.name.localeCompare(b.name, "zh") });
      } else if (sort === "name-desc") {
        rows.sort(function (a, b) { return b.name.localeCompare(a.name, "zh") });
      }

      var phaseBadge = function (row) {
        var key = row.fiberPhase === null ? "phaseUnobserved" : (PHASE_KEY[row.fiberPhase] || "phaseUnobserved");
        var cls = row.fiberPhase === null ? "muted" : (PHASE_KEY[row.fiberPhase] ? (row.fiberPhase === "active" ? "active" : (row.fiberPhase === "failed" ? "failed" : (row.fiberPhase === "pending" || row.fiberPhase === "loading" ? row.fiberPhase : "muted"))) : "muted");
        return el("span", { className: "rci-badge " + cls, title: t("phaseTitle") }, t(key));
      };

      var toggleBtn = function (row) {
        var rowBusy = toggleId === row.patchId;
        var anyBusy = toggleId !== null || busy !== null;
        var label = rowBusy
          ? t(row.enabled ? "disabling" : "enabling")
          : t(row.enabled ? "toggleOn" : "toggleOff");
        return el("button", {
          className: "rci-btn" + (row.enabled ? " danger" : " primary"),
          disabled: anyBusy,
          title: rowBusy ? label : t(row.enabled ? "toggleOn" : "toggleOff"),
          onClick: function () { toggle(row); },
        }, label);
      };

      var sourceText = function (row) {
        // kind='repo'：直接显示仓库 URL（无需标签前缀）
        if (row.sourceKind === "repo") return row.sourceSpec || t("none");
        var base = "";
        if (row.sourceKind) {
          base = t("source" + row.sourceKind.charAt(0).toUpperCase() + row.sourceKind.slice(1));
        }
        if (row.sourceSpec) base += " (" + row.sourceSpec + ")";
        return base;
      };

      // 键盘 ←/→ 横向滚动（表格聚焦后）
      var onTableKeyDown = function (ev) {
        var box = ev.currentTarget;
        if (ev.key === "ArrowRight") { box.scrollLeft += 120; ev.preventDefault(); }
        else if (ev.key === "ArrowLeft") { box.scrollLeft -= 120; ev.preventDefault(); }
        else if (ev.key === "Home") { box.scrollLeft = 0; ev.preventDefault(); }
        else if (ev.key === "End") { box.scrollLeft = box.scrollWidth; ev.preventDefault(); }
      };

      var countText = tr(t, "count", { total: state.rows.length });
      if (rows.length !== state.rows.length) countText += tr(t, "countMatched", { matched: rows.length });

      // 本插件自更新卡片（最上方）：自身有新版本且未忽略
      var selfRow = null;
      for (var si = 0; si < state.rows.length; si++) {
        if (state.rows[si].name === "dsh-plugin-runcat-inventory") { selfRow = state.rows[si]; break; }
      }
      var selfUpdatable = selfRow !== null && selfRow.updateAvailable && !selfRow.pendingRestart && !selfDismissed;
      var selfUpdated = selfRow !== null && selfRow.pendingRestart;
      var selfCard = selfUpdatable
        ? el("div", { className: "rci-selfcard" },
            el("div", { className: "rci-selfcard-title" }, "⭐ " + t("tab") + " · " + t("selfUpdateTitle")),
            el("div", { className: "rci-selfcard-meta" },
              "v" + selfRow.version + " → v" + selfRow.latestVersion,
              " · ",
              el("a", { href: "https://github.com/runcat-tommy/dsh-plugin-runcat-inventory/blob/main/CHANGELOG.md", target: "_blank", rel: "noreferrer" }, t("selfUpdateLog")),
            ),
            el("div", { className: "rci-selfcard-actions" },
              el("button", { className: "rci-btn primary", disabled: busy !== null, onClick: function () { setConfirming({ row: selfRow, action: "update" }); } }, t("updateBtn")),
              el("button", { className: "rci-btn", onClick: function () { setSelfDismissed(true); } }, t("selfUpdateLater")),
            ),
          )
        : selfUpdated
          ? el("div", { className: "rci-selfcard ok" },
              el("div", { className: "rci-selfcard-title" }, t("tab") + " · " + t("updatedTag")),
              el("div", { className: "rci-selfcard-meta" }, tr(t, "updateOk", { version: selfRow.latestVersion || selfRow.version })),
            )
          : null;

      // 其他插件更新横幅（顶部）：带「更新全部插件」「重启 DSH」两个按钮
      var othersUpdated = [];
      for (var oi = 0; oi < state.rows.length; oi++) {
        var r = state.rows[oi];
        if (r.name !== "dsh-plugin-runcat-inventory" && r.updateAvailable && !r.pendingRestart) othersUpdated.push(r);
      }
      var batchText = null;
      if (batch !== null && batch.running) {
        batchText = tr(t, "updateAllRunning", { done: batch.done, total: batch.total });
      } else if (batch !== null) {
        if (batch.applied) batchText = tr(t, "updateAllDone", { ok: batch.total - batch.failed, total: batch.total });
        else batchText = tr(t, "updateAllDoneRestart", { ok: batch.total - batch.failed, total: batch.total });
        if (batch.failed > 0) batchText += " · " + tr(t, "updateAllFailed", { failed: batch.failed });
      }
      var anyBusy = busy !== null || toggleId !== null || (batch !== null && batch.running);
      var banner = el("div", { className: "rci-banner" },
        el("div", { className: "rci-banner-text" },
          othersUpdated.length > 0
            ? "🔄 " + tr(t, "bannerText", { count: othersUpdated.length }) +
              othersUpdated.map(function (r) { return r.name + " (v" + r.version + " → v" + r.latestVersion + ")"; }).join(" · ")
            : "✅ " + t("updateAllNone"),
          batchText ? el("div", { className: "rci-banner-status" }, batchText) : null,
          restart === "restarting"
            ? el("div", { className: "rci-banner-status" }, t("restarting"))
            : restart !== null
              ? el("div", { className: "rci-banner-status err" }, restart.text)
              : null,
        ),
        el("div", { className: "rci-banner-actions" },
          el("button", {
            className: "rci-btn primary",
            disabled: anyBusy || othersUpdated.length === 0,
            onClick: function () { updateAll(othersUpdated); },
          }, batch !== null && batch.running
            ? tr(t, "updateAllRunning", { done: batch.done, total: batch.total })
            : tr(t, "updateAllBtn", { count: othersUpdated.length })),
          el("button", {
            className: "rci-btn",
            disabled: anyBusy || restart === "restarting",
            onClick: function () { setConfirming({ action: "restart" }); },
          }, t("restartBtn")),
        ),
      );

      return el("div", { className: "rci-panel" },
        selfCard,
        banner,
        el("div", { className: "rci-toolbar" },
          el("input", {
            className: "rci-search",
            placeholder: t("searchPlaceholder"),
            value: q,
            onChange: function (ev) { setQ(ev.target.value); },
          }),
          el("select", {
            className: "rci-select",
            value: filter,
            onChange: function (ev) { setFilter(ev.target.value); },
          },
            el("option", { value: "all" }, t("filterAll")),
            el("option", { value: "enabled" }, t("filterEnabled")),
            el("option", { value: "disabled" }, t("filterDisabled")),
            el("option", { value: "active" }, t("filterActive")),
            el("option", { value: "waiting" }, t("filterWaiting")),
            el("option", { value: "failed" }, t("filterFailed")),
          ),
          el("select", {
            className: "rci-select",
            value: sort,
            onChange: function (ev) { setSort(ev.target.value); },
          }, SORTS.map(function (s) {
            return el("option", { value: s[0], key: s[0] }, t(s[1]));
          })),
          el("button", { className: "rci-btn", onClick: load, disabled: state.loading }, t("refresh")),
          el("span", { className: "rci-status" }, countText),
        ),
        state.loading && state.rows.length === 0
          ? el("div", { className: "rci-status" }, t("loading"))
          : state.error
            ? el("div", { className: "rci-error" }, state.error)
            : rows.length === 0
              ? el("div", { className: "rci-empty" }, state.rows.length === 0 ? t("emptyNone") : t("emptyNoMatch"))
              : el("div", {
                  className: "rci-tablewrap",
                  tabIndex: 0,
                  onKeyDown: onTableKeyDown,
                  "aria-label": t("ariaScroll"),
                },
                  el("table", { className: "rci-table" },
                    el("colgroup", null,
                      el("col", { style: { width: "36%" } }),
                      el("col", { style: { width: "15%", minWidth: "100px" } }),
                      el("col", { style: { width: "21%" } }),
                      el("col", { style: { width: "28%", minWidth: "170px" } }),
                    ),
                    el("thead", null,
                      el("tr", null,
                        el("th", null, t("colName")),
                        el("th", null, t("colStatus")),
                        el("th", { className: "rci-hide-narrow" }, t("colSource")),
                        el("th", null, t("colActions")),
                      ),
                    ),
                    el("tbody", null, rows.map(function (row) {
                      var isOpen = Boolean(expanded[row.id]);
                      var hasConfig = hasConfigContent(row.config);
                      var configText = hasConfig ? JSON.stringify(row.config, null, 2) : "";
                      // 本插件的描述随界面语言切换（字典里的 selfDescription）；其余插件显示 package.json 原文
                      var descText = row.name === "dsh-plugin-runcat-inventory" ? t("selfDescription") : row.description;
                      var expandable = descText !== "" || hasConfig;
                      var src = sourceText(row);
                      var isUninstalled = Boolean(row.uninstalled);
                      var isPendingRestart = Boolean(row.pendingRestart);
                      var opState = opStates[row.id] || null;
                      return [
                        el("tr", {
                          key: row.id,
                          className: isUninstalled ? "rci-row-uninstalled" : (isPendingRestart ? "rci-row-updated" : null),
                        },
                          el("td", null,
                            el("div", { className: "rci-name" }, row.name),
                            el("div", { className: "rci-id" }, row.id),
                            el("div", { className: "rci-version" },
                              row.version ? "v" + row.version : t("none"),
                              row.updateAvailable && row.latestVersion
                                ? el("span", { className: "rci-new-version" }, " → v" + row.latestVersion)
                                : null,
                            ),
                          ),
                          el("td", null,
                            isUninstalled
                              ? el("span", { className: "rci-badge uninstalled", title: t("uninstalledHint") }, t("uninstalledTag"))
                              : isPendingRestart
                                ? el("span", { className: "rci-badge updated", title: t("updatedHint") }, t("updatedTag"))
                                : el("div", null,
                                    el("div", null, el("span", { className: "rci-badge " + (row.enabled ? "on" : "off") }, t(row.enabled ? "enabled" : "disabled"))),
                                    el("div", { style: { marginTop: 4 } }, phaseBadge(row)),
                                  ),
                          ),
                          el("td", { className: "rci-hide-narrow" }, src ? el("span", { className: "rci-source" }, src) : el("span", { className: "rci-muted" }, t("none"))),
                          el("td", null,
                            isUninstalled
                              ? el("span", { className: "rci-muted" }, t("uninstalledTag") + " · " + t("uninstalledHint"))
                              : isPendingRestart
                                ? el("span", { className: "rci-muted" }, t("updatedTag") + " · " + t("updatedHint"))
                                : el("div", null,
                                    el("div", { className: "rci-actions" },
                                      toggleBtn(row),
                                      // 更新：有新版本且非待重启 → 主色"更新"按钮
                                      row.updateAvailable && row.latestVersion
                                        ? el("button", { className: "rci-btn primary", disabled: busy !== null || toggleId !== null, onClick: function () { setConfirming({ row: row, action: "update" }); } }, t("updateBtn"))
                                        : null,
                                      el("button", { className: "rci-btn", onClick: function () { copyName(row); } }, copied === "name:" + row.id ? t("copied") : t("copyName")),
                                      expandable
                                        ? el("button", { className: "rci-btn", onClick: function () { toggleExpand(row); } }, isOpen ? t("collapse") : t("details"))
                                        : null,
                                      // 卸载：禁止卸载自身；只有"由 profile 依赖声明"的条目才可能卸载
                                      // （内置包 sourceKind='other' 不是依赖，点了必然失败，索性不显示）
                                      row.name !== "dsh-plugin-runcat-inventory" && row.sourceKind !== "builtin" && row.sourceKind !== "other"
                                        ? el("button", { className: "rci-btn danger", disabled: busy !== null || toggleId !== null, onClick: function () { setConfirming({ row: row, action: "uninstall" }); } }, t("uninstallBtn"))
                                        : null,
                                    ),
                                  ),
                          ),
                        ),
                        // 操作结果单独占一整行，紧贴在这个插件下面（用户要求：
                        // 放在列表最底下根本看不见）；长文案也有地方显示。
                        opState
                          ? el("tr", { key: row.id + "-op", className: "rci-oprow" },
                              el("td", { colSpan: 4, className: "rci-opcell" },
                                el("span", { className: "rci-op " + opState.phase },
                                  opState.phase === "running" ? "⏳ " : (opState.phase === "ok" ? "✅ " : "❌ "),
                                  opState.text,
                                ),
                                opState.detail
                                  ? el("button", {
                                      className: "rci-btn",
                                      style: { marginLeft: 8 },
                                      onClick: function () { toggleOpDetail(row.id); },
                                    }, opOpen[row.id] ? t("opDetailHide") : t("opDetailShow"))
                                  : null,
                                opState.detail && opOpen[row.id]
                                  ? el("div", { className: "rci-op-detail" }, opState.detail)
                                  : null,
                              ),
                            )
                          : null,
                        isOpen && expandable
                          ? el("tr", { key: row.id + "-exp", className: "rci-expandrow" },
                              el("td", { colSpan: 4, className: "rci-expandcell" },
                                descText
                                  ? el("div", { className: "rci-exp-sec" },
                                      el("div", { className: "rci-exp-title" }, t("descTitle")),
                                      el("div", { className: "rci-exp-text" }, descText),
                                    )
                                  : null,
                                hasConfig
                                  ? el("div", { className: "rci-exp-sec" },
                                      el("div", { className: "rci-exp-title" }, t("configTitle")),
                                      el("div", { className: "rci-actions" },
                                        el("button", { className: "rci-btn", onClick: function () { copyConfig(row); } }, copied === "config:" + row.id ? t("copied") : t("copyConfig")),
                                      ),
                                      el("pre", { className: "rci-config" }, configText),
                                    )
                                  : null,
                              ),
                            )
                          : null,
                      ];
                    })),
                  ),
                ),
        msg ? el("div", { className: msg.kind === "ok" ? "rci-ok" : (msg.kind === "info" ? "rci-info" : "rci-error") }, msg.text) : null,
        confirming
          ? el("div", {
              className: "rci-modal-mask",
              // 弹窗任何时候都能关掉：操作一旦开始就关窗，进度显示在列表里，
              // 不再让一个"进行中"的弹窗把整个界面挡住（用户实测反馈）。
              onClick: function () { setConfirming(null); },
            },
              el("div", { className: "rci-modal", onClick: function (ev) { ev.stopPropagation(); } },
                confirming.action === "update"
                  ? el("div", null,
                      el("div", { className: "rci-modal-title" }, t("updateTitle")),
                      el("div", { className: "rci-warn" },
                        tr(t, "updateWarn", {
                          name: confirming.row.name,
                          old: confirming.row.version,
                          new: confirming.row.latestVersion,
                        }),
                        confirming.row.sourceKind === "github" ? "\n" + t("updateGithubNote") : "",
                      ),
                      el("div", { className: "rci-footer" },
                        el("button", { className: "rci-btn", onClick: function () { setConfirming(null); } }, t("updateCancel")),
                        el("button", { className: "rci-btn primary", onClick: function () { doUpdate(confirming.row); } }, t("updateConfirm")),
                      ),
                    )
                  : confirming.action === "restart"
                    ? el("div", null,
                        el("div", { className: "rci-modal-title" }, t("restartConfirmTitle")),
                        el("div", { className: "rci-warn" }, t("restartConfirmWarn")),
                        el("div", { className: "rci-footer" },
                          el("button", { className: "rci-btn", onClick: function () { setConfirming(null); } }, t("updateCancel")),
                          el("button", { className: "rci-btn primary", onClick: function () { doRestart(); } }, t("restartConfirmOk")),
                        ),
                      )
                    : el("div", null,
                        el("div", { className: "rci-modal-title" }, t("uninstallTitle")),
                        el("div", { className: "rci-warn" }, tr(t, "uninstallWarn", { name: confirming.row.name })),
                        el("div", { className: "rci-footer" },
                          el("button", { className: "rci-btn", onClick: function () { setConfirming(null); } }, t("uninstallCancel")),
                          el("button", { className: "rci-btn primary", onClick: function () { doUninstall(confirming.row); } }, t("uninstallConfirm")),
                        ),
                      ),
              ),
            )
          : null,
      );
    }

    // ── 注册选项卡（locale 双语 + 官方同款扩展点）─────────────────────
    function apply(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, "runcat-inventory: dictionaries");
      var t = ctx.locale.bind(NS);
      // 入口：直接注册到设置页左侧导航（settings.section），不再作为
      // “设置 → 插件”里的选项卡
      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register(
          {
            name: "settings.section",
            id: "runcat-inventory",
            order: 16,
            locale: NS,
            label: function () { return t("tab"); },
            inject: function () { return { t: ctx.locale.bind(NS) }; },
          },
          function (props) { return el(InventoryPanel, props); },
        );
      });
    }

    var inject = ["slots", "locale"];
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});

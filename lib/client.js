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
      ".rci-row-uninstalled .rci-name{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}",
      ".rci-row-uninstalled td{opacity:.72}",
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
      toggleOk: "已{action} {name}（热生效中，刷新后确认状态）",
      toggleDisable: "停用",
      toggleEnable: "启用",
      toggleFail: "切换失败：{msg}",
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
      toggleOk: "{action} {name} (applying live; refresh to confirm)",
      toggleDisable: "Disabled",
      toggleEnable: "Enabled",
      toggleFail: "Toggle failed: {msg}",
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
      var _confirming = React.useState(null); // 待确认卸载的行
      var confirming = _confirming[0];
      var setConfirming = _confirming[1];
      var _uninstalling = React.useState(false);
      var uninstalling = _uninstalling[0];
      var setUninstalling = _uninstalling[1];

      var load = function () {
        setState(function (prev) { return { loading: true, error: null, rows: prev.rows }; });
        api("/runcat-api/inventory").then(function (res) {
          if (!res.ok) {
            setState({ loading: false, error: tr(t, ERR_KEY[res.code] || "errUnknown"), rows: [] });
            return;
          }
          setState({ loading: false, error: null, rows: res.entries || [] });
        }).catch(function (err) {
          setState({ loading: false, error: tr(t, "loadFailed", { msg: String(err && err.message || err) }), rows: [] });
        });
      };

      React.useEffect(function () { load(); }, []);

      var toggle = function (row) {
        setToggleId(row.patchId);
        setMsg(null);
        api("/runcat-api/set-enabled", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: row.patchId, name: row.name, enabled: !row.enabled }),
        }).then(function (res) {
          setToggleId(null);
          if (res.ok) {
            var action = row.enabled ? tr(t, "toggleDisable") : tr(t, "toggleEnable");
            setMsg({ kind: "ok", text: tr(t, "toggleOk", { action: action, name: row.name }) });
            setTimeout(load, 600); // 稍等 HMR 结算后刷新
          } else {
            setMsg({ kind: "err", text: tr(t, "toggleFail", { msg: tr(t, ERR_KEY[res.code] || "errUnknown") }) });
          }
        }).catch(function (err) {
          setToggleId(null);
          setMsg({ kind: "err", text: tr(t, "toggleFail", { msg: String(err && err.message || err) }) });
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

      // 卸载：二次确认后调 host 执行 dsh plugin remove（需重启生效）
      var doUninstall = function (row) {
        setUninstalling(true);
        setMsg(null);
        api("/runcat-api/uninstall", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: row.name }),
        }).then(function (res) {
          setUninstalling(false);
          setConfirming(null);
          if (res.ok) {
            setMsg({ kind: "ok", text: tr(t, "uninstallOk", { name: row.name }) });
            setTimeout(load, 800);
          } else {
            setMsg({ kind: "err", text: tr(t, "uninstallFail", { msg: tr(t, ERR_KEY[res.code] || "errUnknown") }) });
          }
        }).catch(function (err) {
          setUninstalling(false);
          setConfirming(null);
          setMsg({ kind: "err", text: tr(t, "uninstallFail", { msg: String(err && err.message || err) }) });
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
        var busy = toggleId === row.patchId;
        return el("button", {
          className: "rci-btn" + (row.enabled ? " danger" : " primary"),
          disabled: busy,
          onClick: function () { toggle(row); },
        }, busy ? t("toggling") : t(row.enabled ? "toggleOn" : "toggleOff"));
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

      return el("div", { className: "rci-panel" },
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
                      return [
                        el("tr", { key: row.id, className: isUninstalled ? "rci-row-uninstalled" : null },
                          el("td", null,
                            el("div", { className: "rci-name" }, row.name),
                            el("div", { className: "rci-id" }, row.id),
                            el("div", { className: "rci-version" }, row.version ? "v" + row.version : t("none")),
                          ),
                          el("td", null,
                            isUninstalled
                              ? el("span", { className: "rci-badge uninstalled", title: t("uninstalledHint") }, t("uninstalledTag"))
                              : el("div", null,
                                  el("div", null, el("span", { className: "rci-badge " + (row.enabled ? "on" : "off") }, t(row.enabled ? "enabled" : "disabled"))),
                                  el("div", { style: { marginTop: 4 } }, phaseBadge(row)),
                                ),
                          ),
                          el("td", { className: "rci-hide-narrow" }, src ? el("span", { className: "rci-source" }, src) : el("span", { className: "rci-muted" }, t("none"))),
                          el("td", null,
                            isUninstalled
                              ? el("span", { className: "rci-muted" }, t("uninstalledTag") + " · " + t("uninstalledHint"))
                              : el("div", { className: "rci-actions" },
                                  toggleBtn(row),
                                  el("button", { className: "rci-btn", onClick: function () { copyName(row); } }, copied === "name:" + row.id ? t("copied") : t("copyName")),
                                  expandable
                                    ? el("button", { className: "rci-btn", onClick: function () { toggleExpand(row); } }, isOpen ? t("collapse") : t("details"))
                                    : null,
                                  // 卸载：禁止卸载自身；内置包（非 profile 依赖）不可卸载
                                  row.name !== "dsh-plugin-runcat-inventory" && row.sourceKind !== "builtin"
                                    ? el("button", { className: "rci-btn danger", onClick: function () { setConfirming(row); } }, t("uninstallBtn"))
                                    : null,
                                ),
                          ),
                        ),
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
        msg ? el("div", { className: msg.kind === "ok" ? "rci-ok" : "rci-error" }, msg.text) : null,
        confirming
          ? el("div", {
              className: "rci-modal-mask",
              onClick: function () { if (!uninstalling) setConfirming(null); },
            },
              el("div", { className: "rci-modal", onClick: function (ev) { ev.stopPropagation(); } },
                el("div", { className: "rci-modal-title" }, t("uninstallTitle")),
                el("div", { className: "rci-warn" }, tr(t, "uninstallWarn", { name: confirming.name })),
                el("div", { className: "rci-footer" },
                  el("button", { className: "rci-btn", disabled: uninstalling, onClick: function () { setConfirming(null); } }, t("uninstallCancel")),
                  el("button", { className: "rci-btn primary", disabled: uninstalling, onClick: function () { doUninstall(confirming); } }, uninstalling ? t("toggling") : t("uninstallConfirm")),
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

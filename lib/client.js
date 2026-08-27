/**
 * dsh-plugin-runcat-inventory —— 浏览器半端（逃咪-插件总览）
 *
 * 手写 ModuleLoader bundle（无构建步骤，与 dsh-plugins-market 同款写法）：
 *   - 在 设置 → 插件 的 settings.plugins.tab 槽位注册一个选项卡；
 *   - 数据全部来自同源 fetch → host 半端的 /runcat-api 路由；
 *   - 表格视图（4 列）：名称(含 id+版本) / 状态 / 来源 / 操作；
 *   - 宽度优化：无粘性固定列；键盘 ←/→ 横向滚动；窄屏自动隐藏"来源"列；
 *     描述与配置全文在展开行内查看（点"详情"）；
 *   - 操作：启用/停用（热生效）、复制名称、详情（展开描述+配置）、复制配置；
 *   - 搜索框（联合搜索名称+id+描述+来源+版本）+ 状态过滤；
 *   - 排序：配置顺序（默认）/ 名称 ↑ / 名称 ↓。
 */

window.__ModuleLoader__.load({
  id: "dsh-plugin-runcat-inventory",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var React = require("react");

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
      ".rci-table{width:100%;border-collapse:separate;border-spacing:0;font-size:12px;min-width:560px}",
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
      ".rci-badge{display:inline-block;font-size:10px;line-height:1;padding:3px 6px;border-radius:4px;white-space:nowrap}",
      ".rci-badge.on{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);color:var(--dsw-alias-state-success-primary)}",
      ".rci-badge.off{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent);color:var(--dsw-alias-state-warn-primary)}",
      ".rci-badge.active{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);color:var(--dsw-alias-state-success-primary)}",
      ".rci-badge.pending,.rci-badge.loading{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent);color:var(--dsw-alias-state-warn-primary)}",
      ".rci-badge.failed{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:var(--dsw-alias-state-error-primary)}",
      ".rci-badge.muted{background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-tertiary)}",
      ".rci-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}",
      ".rci-exp-sec{display:flex;flex-direction:column;gap:6px;margin:4px 0}",
      ".rci-exp-title{color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:600}",
      ".rci-exp-text{color:var(--dsw-alias-label-secondary);font-size:12px;white-space:pre-wrap;word-break:break-all}",
      ".rci-config{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:8px;margin:0;font-size:11px;overflow:auto;max-height:220px;white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace}",
      ".rci-empty{color:var(--dsw-alias-label-tertiary);font-size:12px;padding:16px;text-align:center}",
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

    // ── React 小工具 ───────────────────────────────────────────────────
    function el(type, props) {
      var children = Array.prototype.slice.call(arguments, 2);
      return React.createElement.apply(React, [type, props].concat(children));
    }

    function api(path, options) {
      return window.fetch(path, options).then(function (res) {
        return res.json().catch(function () {
          return { ok: false, error: "非 JSON 响应 (" + res.status + ")" };
        });
      });
    }

    var PHASE_LABEL = {
      active: "已挂载",
      pending: "等待依赖",
      loading: "加载中",
      failed: "挂载失败",
      unloading: "卸载中",
    };
    var PHASE_CLASS = {
      active: "active",
      pending: "pending",
      loading: "loading",
      failed: "failed",
      unloading: "muted",
    };

    var SORTS = [
      ["config", "配置顺序"],
      ["name-asc", "名称 ↑"],
      ["name-desc", "名称 ↓"],
    ];

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

    // ── 主面板 ─────────────────────────────────────────────────────────
    function InventoryPanel() {
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
      var _msg = React.useState(null); // 操作结果反馈
      var msg = _msg[0];
      var setMsg = _msg[1];

      var load = function () {
        setState(function (prev) { return { loading: true, error: null, rows: prev.rows }; });
        api("/runcat-api/inventory").then(function (res) {
          if (!res.ok) {
            setState({ loading: false, error: res.error || "读取失败", rows: [] });
            return;
          }
          setState({ loading: false, error: null, rows: res.entries || [] });
        }).catch(function (err) {
          setState({ loading: false, error: String(err && err.message || err), rows: [] });
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
            setMsg({ kind: "ok", text: "已" + (row.enabled ? "停用" : "启用") + " " + row.name + "（热生效中，刷新后确认状态）" });
            setTimeout(load, 600); // 稍等 HMR 结算后刷新
          } else {
            setMsg({ kind: "err", text: "切换失败：" + (res.error || "未知错误") });
          }
        }).catch(function (err) {
          setToggleId(null);
          setMsg({ kind: "err", text: "切换失败：" + String(err && err.message || err) });
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

      // 过滤：关键字（名称/id/描述/来源/版本）+ 状态
      var keyword = q.trim().toLowerCase();
      var filtered = state.rows.filter(function (row) {
        if (filter === "enabled" && !row.enabled) return false;
        if (filter === "disabled" && row.enabled) return false;
        if (filter === "failed" && row.fiberPhase !== "failed") return false;
        if (filter === "waiting" && row.fiberPhase !== "pending" && row.fiberPhase !== "loading") return false;
        if (filter === "active" && row.fiberPhase !== "active") return false;
        if (keyword === "") return true;
        var hay = [row.name, row.id, row.description, row.source, row.version].join("\n").toLowerCase();
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
        var cls = row.fiberPhase === null ? "muted" : (PHASE_CLASS[row.fiberPhase] || "muted");
        var label = row.fiberPhase === null ? "未挂载" : (PHASE_LABEL[row.fiberPhase] || row.fiberPhase);
        return el("span", { className: "rci-badge " + cls, title: "Cordis 状态" }, label);
      };

      var toggleBtn = function (row) {
        var busy = toggleId === row.patchId;
        return el("button", {
          className: "rci-btn" + (row.enabled ? " danger" : " primary"),
          disabled: busy,
          onClick: function () { toggle(row); },
        }, busy ? "处理中…" : (row.enabled ? "停用" : "启用"));
      };

      // 键盘 ←/→ 横向滚动（表格聚焦后）
      var onTableKeyDown = function (ev) {
        var box = ev.currentTarget;
        if (ev.key === "ArrowRight") { box.scrollLeft += 120; ev.preventDefault(); }
        else if (ev.key === "ArrowLeft") { box.scrollLeft -= 120; ev.preventDefault(); }
        else if (ev.key === "Home") { box.scrollLeft = 0; ev.preventDefault(); }
        else if (ev.key === "End") { box.scrollLeft = box.scrollWidth; ev.preventDefault(); }
      };

      return el("div", { className: "rci-panel" },
        el("div", { className: "rci-toolbar" },
          el("input", {
            className: "rci-search",
            placeholder: "搜索名称 / id / 描述 / 来源…",
            value: q,
            onChange: function (ev) { setQ(ev.target.value); },
          }),
          el("select", {
            className: "rci-select",
            value: filter,
            onChange: function (ev) { setFilter(ev.target.value); },
          },
            el("option", { value: "all" }, "全部状态"),
            el("option", { value: "enabled" }, "已启用"),
            el("option", { value: "disabled" }, "已停用"),
            el("option", { value: "active" }, "已挂载"),
            el("option", { value: "waiting" }, "等待/加载中"),
            el("option", { value: "failed" }, "挂载失败"),
          ),
          el("select", {
            className: "rci-select",
            value: sort,
            onChange: function (ev) { setSort(ev.target.value); },
          }, SORTS.map(function (s) {
            return el("option", { value: s[0], key: s[0] }, s[1]);
          })),
          el("button", { className: "rci-btn", onClick: load, disabled: state.loading }, "刷新"),
          el("span", { className: "rci-status" }, "共 " + state.rows.length + " 个插件" + (rows.length !== state.rows.length ? "，匹配 " + rows.length : "")),
        ),
        state.loading && state.rows.length === 0
          ? el("div", { className: "rci-status" }, "正在读取插件…")
          : state.error
            ? el("div", { className: "rci-error" }, "读取失败：" + state.error)
            : rows.length === 0
              ? el("div", { className: "rci-empty" }, state.rows.length === 0 ? "暂无插件。" : "没有匹配的插件。")
              : el("div", {
                  className: "rci-tablewrap",
                  tabIndex: 0,
                  onKeyDown: onTableKeyDown,
                  "aria-label": "插件列表（可用左右方向键横向滚动）",
                },
                  el("table", { className: "rci-table" },
                    el("thead", null,
                      el("tr", null,
                        el("th", null, "名称"),
                        el("th", null, "状态"),
                        el("th", { className: "rci-hide-narrow" }, "来源"),
                        el("th", null, "操作"),
                      ),
                    ),
                    el("tbody", null, rows.map(function (row) {
                      var isOpen = Boolean(expanded[row.id]);
                      var hasConfig = hasConfigContent(row.config);
                      var configText = hasConfig ? JSON.stringify(row.config, null, 2) : "";
                      var expandable = row.description !== "" || hasConfig;
                      return [
                        el("tr", { key: row.id },
                          el("td", null,
                            el("div", { className: "rci-name" }, row.name),
                            el("div", { className: "rci-id" }, row.id),
                            el("div", { className: "rci-version" }, row.version ? "v" + row.version : "—"),
                          ),
                          el("td", null,
                            el("div", null, el("span", { className: "rci-badge " + (row.enabled ? "on" : "off") }, row.enabled ? "已启用" : "已停用")),
                            el("div", { style: { marginTop: 4 } }, phaseBadge(row)),
                          ),
                          el("td", { className: "rci-hide-narrow" }, row.source ? el("span", null, row.source) : el("span", { className: "rci-muted" }, "—")),
                          el("td", null,
                            el("div", { className: "rci-actions" },
                              toggleBtn(row),
                              el("button", { className: "rci-btn", onClick: function () { copyName(row); } }, copied === "name:" + row.id ? "已复制" : "复制名称"),
                              expandable
                                ? el("button", { className: "rci-btn", onClick: function () { toggleExpand(row); } }, isOpen ? "收起" : "详情")
                                : null,
                            ),
                          ),
                        ),
                        isOpen && expandable
                          ? el("tr", { key: row.id + "-exp", className: "rci-expandrow" },
                              el("td", { colSpan: 4, className: "rci-expandcell" },
                                row.description
                                  ? el("div", { className: "rci-exp-sec" },
                                      el("div", { className: "rci-exp-title" }, "描述"),
                                      el("div", { className: "rci-exp-text" }, row.description),
                                    )
                                  : null,
                                hasConfig
                                  ? el("div", { className: "rci-exp-sec" },
                                      el("div", { className: "rci-exp-title" }, "配置"),
                                      el("div", { className: "rci-actions" },
                                        el("button", { className: "rci-btn", onClick: function () { copyConfig(row); } }, copied === "config:" + row.id ? "已复制" : "复制配置"),
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
      );
    }

    // ── 注册选项卡（与官方/市场同款扩展点）───────────────────────────
    function apply(ctx) {
      ctx.slots.inject("settings.plugins.tab", function () {
        return ctx.slots.register(
          { name: "settings.plugins.tab", id: "runcat-inventory", order: 15, label: "逃咪-插件总览" },
          function () { return el(InventoryPanel); },
        );
      });
    }

    var inject = ["slots"];
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});

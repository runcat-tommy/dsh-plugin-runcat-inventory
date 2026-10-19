# Changelog

[中文](CHANGELOG.md) | **English**

This file records the version history of `dsh-plugin-runcat-inventory` (Runcat Plugin Overview / 逃咪-插件总览).

## [1.3.2] - 2026-10-19

### UX (from user testing)

- **The enable/disable result now appears under that plugin's own row.** It used to render at the very bottom of the panel, invisible in a long list. "⏳ Enabling… / ✅ Enabled: X / ❌ Toggle failed" is now a **full-width line directly beneath the plugin row** (long text has room), and failures keep the expandable **Reason**.
- **Wording changed** to `Enabled: <name> (applying live — click Refresh at the top right to confirm)` (zh: `已启用 <name>（热生效中，请点击右上角刷新按钮）`).
- The message is readable: it stays for at least 5 seconds and is retired automatically once the state actually flips; if it does not flip, it stays put so success is never implied falsely. Clicking Refresh also clears already-applied notices.

### Fixed: the host requirement now covers the 0.2.1 line

- The peer range used to be `^0.1.0-rc.6 || ^0.2.0-rc.1`. Under semver's prerelease rules `^0.2.0-rc.1` does **not** include `0.2.1-rc.2` (prereleases are compared per `major.minor.patch` tuple), so once the host moved to **0.2.1-rc.2** a strict check would call this package incompatible — the market only passed because it uses `includePrerelease`. All three peers now read
  **`^0.1.0-rc.6 || ^0.1.1-rc.1 || ^0.2.0-rc.1 || ^0.2.1-alpha.1`**, verified against both strict and prerelease-inclusive semantics for
  `0.1.0-rc.6 / 0.1.0-rc.8 / 0.1.1-rc.2 / 0.2.0-rc.2 / 0.2.1-alpha.4 / 0.2.1-rc.2`.

### Docs

- Historical entries re-dated from `git log`: `1.2.0`/`1.1.0`/`0.4.1`/`0.4.0`/`0.3.8` → `2026-09-01`, `0.3.5`–`0.3.7` → `2026-08-28` (they had all been copy-pasted as `2026-08-27`).

### Tests

- Full suite **35 cases passing**; the client smoke check passes with **131** locale keys on each side.

### Release

- npm: `dsh-plugin-runcat-inventory@1.3.2`
- GitHub: https://github.com/runcat-tommy/dsh-plugin-runcat-inventory

## [1.3.1] - 2026-10-19

### Fixed: clicking Enable/Disable did nothing

- **Symptom** (user report): clicking "Enable" or "Disable" left the row's "Enabled/Disabled" badge unchanged.
- **Cause**: the route actually answered `{"ok":false,"code":"YAML_UNAVAILABLE","detail":"js-yaml 不可用（无法解析）"}` — **js-yaml could not be resolved inside the host process**, so not a single byte of the patch file was written and the UI had nothing to show. The old code treated a missing/unparseable YAML library as a failed operation, and the UI only surfaced a generic message.
- **Fix**: enable/disable is now **plain text editing** — no YAML parse, no re-serialisation:
  - disable = append one marked top-level item (`- id: … / name: … / disabled: true`) to `cordis.patch.yml` (replacing a lone `[]` line when present);
  - enable = remove exactly that marked block (older unmarked blocks are recognised too), restoring `[]` when no items remain;
  - everything else — the user's comments, `!!js` tags, layout and trailing newline — is preserved byte for byte; the operation is idempotent.
  - this also removes the old collateral damage where js-yaml 4.x re-serialised the whole file and dropped comments.
- The js-yaml dependency (and the whole `getYaml` / `!!js` placeholder round-trip) is gone, which also removes the "a failed parse is cached forever" trap.

### Verification

- New cases: **a profile with no js-yaml still writes the disable patch** (exactly this failure), disable/enable idempotency, trailing newline preserved; full suite **35 cases passing**.
- Measured on Desktop 0.2.1-rc.2: disabling `dsh-view-manager` returned `{"ok":true}` and the row switched to "Disabled"; re-enabling restored "Enabled / mounted"; `cordis.patch.yml` was restored byte for byte.

## [1.3.0] - 2026-10-19

### UX (from user testing)

- **The confirm dialog no longer blocks the UI**: after "Confirm update / Confirm uninstall" the dialog **closes immediately** and progress moves **into the row**; the dialog can always be dismissed (backdrop or Cancel), so a running operation can never trap the whole DSH interface.
- **Results and next step are shown in the list**:
  - applied right away → `✅ Updated to vX — applied`
  - updated but a restart is needed → `✅ Updated to vX — restart DSH to use it`
  - already current → `✅ Already up to date (vX)`
  - failure → `❌ Update failed` plus a **Reason** button that opens the error code, detail, the command that ran, its exit code and the stderr tail (up to 1200 chars)
  - uninstall follows the same pattern.
- **Enable/disable keeps its current behaviour** (button label switches to "Enabling…/Disabling…" plus one toast line).

### Features

- **Two buttons in the top banner**:
  - **"Update all (N)"** — sequentially updates every plugin with a pending update, per-row progress and per-row results, then tries to hot-apply and summarises (`N/M updated · applied, no restart needed` / `… restart DSH to apply`, plus `X failed — open “Reason” on the row`).
  - **"Restart DSH"** — confirmed restart of the host. On a **CLI host** (`dsh web`) a detached helper waits for the port to be released, relaunches the same CLI, and the page polls until the server is back and reloads. On **Desktop** the Electron shell owns the host process and a plugin killing it would throw the UI into a failure page, so the route answers `DESKTOP_RESTART_UNSUPPORTED` with instructions instead of pretending to work.
- **Hot apply (HMR)**: after update/uninstall the plugin calls DSH's own `hmr.reconcileProfile(ids)` (the same service the official plugin manager uses) to apply profile changes in place — **no restart when it can be applied**. Responses carry `applied` / `need_restart` / `apply_reason`, and the UI says "applied" or "restart to use it" accordingly. New `POST /runcat-api/apply-changes` triggers it manually.

### Notes

- The Desktop limitation is measured, not assumed (read from `app.asar/lib/main.js`): the shell accepts only `ready` / `shutdown-complete` / `platform-session` events from the host, has no "please restart" channel, and treats host exit as a failure — so a plugin cannot safely restart the Desktop host.

### Tests

- update 9 → 13 cases: HMR apply succeeds, HMR reports a restart is still required, `apply-changes` returns `HMR_UNAVAILABLE` without the service, Desktop `/restart` returns `DESKTOP_RESTART_UNSUPPORTED` **without exiting**.
- Full suite: mock 7 + update 13 + patch 8 + compat 6 = **34 cases passing**; the client smoke check passes with **130** locale keys on each side.

## [1.2.3] - 2026-10-19

### Fixed (measured on DSH Desktop 0.2.1-rc.2 — **not** a version incompatibility)

- **Update / uninstall always failed because `dsh` is not on the host process's PATH at all.** The old code called `spawn('dsh', …)`, but Desktop only installs the CLI at `<resources>\runtime\cli\bin\dsh.cmd` — not on the system PATH, not in `%APPDATA%\npm` (measured: `where dsh` returns nothing). Every click therefore got `'dsh' is not recognized as an internal or external command`, reported generically as "update failed / uninstall failed".
  - New `resolveDshCli()` resolves in this order: **`RUNCAT_DSH_CLI` override → host executable + `dsh-desktop-host/lib/cli.js` inside the asar (`shell:false`, no PATH dependency) → `dsh.cmd`/`dsh` on PATH → platform install locations**, then caches it and logs the chosen entry at startup.
  - When nothing is found it returns the new error code **`DSH_CLI_NOT_FOUND`** with actionable guidance (set `RUNCAT_DSH_CLI`) instead of masquerading as a generic failure.
- **Enable/disable could corrupt the patch layer**: if `cordis.patch.yml` contains a single `!!js` (which DSH's patch layer explicitly allows), `yaml.load()` throws `unknown tag !<tag:yaml.org,2002:js>` → `PATCH_PARSE_FAILED`, so **enable/disable failed entirely**.
  - A `!!js` custom type is now registered (loaded as a string) with **placeholder round-trip**: on write the original code is restored byte-for-byte as `!!js "<code>"`. Verified: 3 `!!js` occurrences survive the round-trip unchanged.
- **Comments were silently deleted on write**: js-yaml 4.x does not keep comments and the old code only preserved the file header — measured, only 3 of 47 comment lines survived. All comment lines are now collected in original order at the top with an explanatory line, so **nothing is lost**.

### UX

- **"Enable" → "Enabling…", "Disable" → "Disabling…"**: the label flips immediately on click and the button is disabled; the panel also shows `Enabling… <plugin>`, so there is no doubt the click registered.
- **"Update" → "Updating…", "Uninstall" → "Uninstalling…"**: after confirming, the dialog/row buttons switch to the in-progress label immediately, and **all other action buttons are disabled** while the operation runs (no double clicks).
- **The uninstall button now only appears where it can work**: built-in loads / non-profile dependencies (`sourceKind=other`) no longer offer "Uninstall" — those could only ever return `NOT_INSTALLED`.
- New dictionary entries (105 keys each in zh/en): `enabling` / `disabling` / `uninstalling` / `errCliNotFound`.

### Tests

- New `test/patch-test.mjs` (8 cases): `!!js` loads and is written back **byte-for-byte**, user comments preserved, output still parseable, re-enable equally faithful, Desktop CLI resolution (`<exe>` + asar `cli.js`, `shell:false`), `RUNCAT_DSH_CLI` pointing at a `.cmd` goes through the shell, and a missing CLI yields `DSH_CLI_NOT_FOUND`.
- Full suite: mock 7 + update 9 + patch 8 + compat 6 = **30 cases passing**.

### Known issues that are NOT this plugin

- Desktop DSH **0.2.1-rc.2** reports `@michengai/dsh-archive-manager@1.0.19` as incompatible ("profile startup denies it") — that plugin's peer range does not cover 0.2.1; every `dsh plugin` run prints that warning.
- If the profile's supply-chain age policy rejects an **already-locked** package, `dsh plugin add/remove` fails wholesale (`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`); the update is then blocked inside pnpm and the original error text is shown in the UI.

## [1.2.2] - 2026-10-16

### Fixed

- **The update button could never actually update anything** (present since 1.2.0). It ran `dsh plugin --profile <p> add <name>` **without a version**; pnpm's semantics are "if any version satisfying the specifier is already installed, do nothing" — it prints `Already up to date`, exits 0, and leaves the version untouched, for exact and range specifiers alike. The post-install check then read that no-op as `VERSION_MISMATCH`, the UI reported "update failed", and the detail blamed "npm mirror sync delay", pointing at the wrong cause.
  - `latest` is now resolved first and pinned into the command: `add <name>@<latest>` (the lookup moved from "verification only" to "target first, then verify").
  - **`link:` / `file:` / `workspace:` dependencies are skipped**: a pinned `add` would silently replace a local development link with a registry install. They now return the new error code `NOT_UPDATABLE` and **no command is spawned at all**.
  - **"Nothing to update" is no longer reported as a failure**: when the local version already is ≥ npm `latest` (mirror fallback, prerelease lines), the response is `ALREADY_LATEST` (`ok: true`, `need_restart: false`) and the UI says "already up to date". `VERSION_MISMATCH` is narrowed to "genuinely older than the target" and now reads "the npm source may not have synced yet; try again later".
  - New `from_version` / `to_version` fields (e.g. `2.0.2 → 2.0.4`) so "restart to apply" can show the real jump; an unresolvable `latest` now logs a warning.
- **The 1.2.1 peer declaration did not take effect — the market still read `unknown`.** The market only counts `peerDependencies` entries that are both in the **host package inventory** and match `@deepseek-ai/dsh*` (`deriveHostCompatibility` in `dshmarket/lib/discovery-compatibility.js`), and 1.2.1's only entry, `@deepseek-ai/dsh-client-runtime`, **is precisely the one missing from the Desktop `app.asar` inventory** (284 packages include `dsh-client-locale` and `dsh-client-ui-settings`, not `dsh-client-runtime`) — so nothing was counted.
  - `package.json` now carries the full trio in both places (same shape as `dsh-skill-mini-manager`): `dsh.client.inject` and `peerDependencies` both add `@deepseek-ai/dsh-client-locale` and `@deepseek-ai/dsh-client-ui-settings`, ranged `^0.1.0-rc.6 || ^0.2.0-rc.1`. Those two are counted → `compatible`.

### Tests

- New `test/update-test.mjs` (9 cases, serial, offline, no real process spawned): ① the argv actually carries `name@<latest>` (range and exact specifiers); ② a stub that exits 0 without changing the version yields `VERSION_MISMATCH` rather than a silent success; ③ `link:`/`file:`/`workspace:` spawn nothing (and never hit the registry); ④ `latest == installed` after a scan yields `ALREADY_LATEST`; ⑤ a non-zero exit yields `UPDATE_FAILED`; ⑥ an unreachable registry never fabricates a version.
- New `test/compat-test.mjs`: calls the market's own `corePackageNames` + `deriveHostCompatibility` (no `HOST_FALLBACK` seed, to avoid false green) and asserts `status === 'compatible'`, `declarations.length >= 1`, and that `peerDependencies` and `dsh.client.inject` stay in sync; it also rebuilds the Desktop layout from the `app.asar` header index and re-checks (the old declaration is `unknown` there, the new one `compatible`).
- `test/mock-test.mjs` no longer hard-codes one machine's install paths (it now locates this repo's source and finds js-yaml itself), and `npm test` chains all three files.
- Measured: mock 7 + update 9 + compat 6 = **22 cases, all passing** on host `0.2.0-rc.2`.

### Release

- npm: `dsh-plugin-runcat-inventory@1.2.2`
- GitHub: https://github.com/runcat-tommy/dsh-plugin-runcat-inventory

## [1.2.1] - 2026-10-16

### Fixed

- **The package declared no host requirement at all, so the marketplace could only read it as `unknown`**: there were no `peerDependencies`, and the market's verdict only considers three kinds of declaration — `engines.dsh`, plus any `peerDependencies` entry that is both in the **host package inventory** and matches `@deepseek-ai/dsh*` (`deriveHostCompatibility` in `dshmarket/lib/discovery-compatibility.js`). With none of them, the plugin cannot say "I support 0.2.x".
  - Added 1 host peer — exactly the package `dsh.client.inject` already lists: `@deepseek-ai/dsh-client-runtime`, ranged **`^0.1.0-rc.6 || ^0.2.0-rc.1`**.
  - Why two segments instead of `^0.2.0-rc.1` alone: declaring only 0.2.x would mark users still on a 0.1.x host as `incompatible`. The two-segment range covers `0.1.0-rc.6` / `0.1.0-rc.8` / `0.1.1-rc.2` / `0.2.0-rc.2` / `0.2.1-alpha.4`. **If the two lines ever cannot coexist, 0.2.x wins and 0.1.x is dropped.**

### Notes

- No runtime change: `lib/` is byte-identical to 1.2.0 (this package's version number appears only in `package.json` and the docs).
- Evidence (host `0.2.0-rc.2`, using an out-of-tree `verify-compat.mjs` that calls dshmarket's own functions): `unknown` → `compatible`; the `profiles/web` health check reports no peer warning; the plugin loads normally on 0.2.0-rc.2.
- Left as-is deliberately: the repo has no `screenshots.json`, so the market falls back to scraping the README, which filters aggressively — the detail page may show no UI preview.

### Release

- npm: `dsh-plugin-runcat-inventory@1.2.1`
- GitHub: https://github.com/runcat-tommy/dsh-plugin-runcat-inventory

## [1.2.0] - 2026-09-01

### New feature: update reminders

- **Version checks**: the host queries `registry.npmjs.org/<pkg>/latest` and
  compares with the installed version using a minimal semver comparator;
  **batched scanning** (4 per batch, 200ms gap, concurrency 4, 8s per-package
  timeout, 1h success cache / 30s failure cooldown); the plugin itself is
  checked in the first batch.
- **Self-update card**: when this plugin has a new version, a prominent card
  appears at the **top of the panel** (current → latest + changelog link +
  "Update now / Not now"); after updating it becomes a "Restart to apply"
  notice.
- **Other plugins**: the version column highlights `vX → vY` (new version in
  blue) + a primary "Update" button in the Actions column + a top banner
  (count and names).
- **Update execution**: confirm dialog → the host serially runs
  `dsh plugin --profile <p> add <name>` (concurrent runs return `BUSY`) →
  **post-install version verification** (command succeeded but version
  unchanged → `VERSION_MISMATCH`, hinting at npm mirror sync delay) → success
  marks "Restart to apply" (`pendingRestart`, amber badge + disabled actions).
- **Source semantics**: only profile dependencies that are not link/file/builtin
  participate; GitHub-source updates show a "switches to the npm source" note.
- **Toggle**: `RUNCAT_SKIP_UPDATE_SCAN=1` disables scanning (offline/tests).
- New error codes: `BUSY / UPDATE_FAILED / VERSION_MISMATCH` (translated
  client-side, zh/en).

### Tests

- mock suite gained update guard cases (MISSING_PARAMS / NOT_INSTALLED, none
  spawn a real process); scanning is disabled in the test environment to stay
  offline. All 7 cases pass.

---

## [1.1.0] - 2026-09-01

### Milestone

- **Version line moved to 1.x**: everything since 0.4.x ships in this
  release — uninstall (confirm dialog, cannot uninstall itself/built-ins,
  "Uninstalled" markers), entry point moved to the Settings left navigation,
  zh/en UI, one-command npm install, etc.
- **Published to npm**: https://www.npmjs.com/package/dsh-plugin-runcat-inventory
  (1.1.0, MIT, zero dependencies).

---

## [0.4.1] - 2026-09-01

### Improvements

- **Mark uninstalled plugins in the list**: the host records successfully
  uninstalled package names in-process and the inventory rows carry an
  `uninstalled` flag; such rows show a red "**Uninstalled**" badge, are
  dimmed, and their Actions column is replaced with a muted hint — users
  can see at a glance which plugins were uninstalled and won't click again.
- **Self-healing**: if a plugin later becomes a profile dependency again,
  the marker is cleared automatically.

---

## [0.4.0] - 2026-09-01

### Features

- **Uninstall**: a new "Uninstall" button in the Actions column with a
  confirm dialog; the host runs
  `dsh plugin --profile <current profile> remove <package>`, removing the
  dependency and bundle layer from the profile (pnpm remove + reconcile),
  **effective after restarting the Web UI**. Guards: cannot uninstall the
  plugin itself (`SELF_UNINSTALL_DENIED`); packages that are not profile
  dependencies (built-ins, etc.) cannot be uninstalled (`NOT_INSTALLED`).

### Changes

- **Entry point moved**: from the "Settings → Plugins → Runcat Plugin
  Overview" tab (`settings.plugins.tab`) to the **Settings left navigation**
  (`settings.section`, order 16, right after "Plugins") — the entry now
  appears directly at **Settings → Runcat Plugin Overview**. The old tab
  was removed.

### Tests

- mock suite gained uninstall guard cases (MISSING_PARAMS /
  SELF_UNINSTALL_DENIED / NOT_INSTALLED, none spawn a real process).
  All 6 cases pass.

---

## [0.3.8] - 2026-09-01

### Changes

- **Installation gained "Method A: npm install"** (simplest, recommended):
  `dsh plugin --profile web add dsh-plugin-runcat-inventory`; the previous
  "local folder" and "GitHub source" methods became C / B; both READMEs
  updated.
- **`package.json` gained a `dsh.marketplace` declaration**:
  `{profiles: ["web"], requiresBuildApproval: false, requiresRestart: true, manualSteps: false}`,
  so the dsh-plugin-marketplace scanner can classify it correctly
  (pure JS, no build, web platform).

---

## [0.3.7] - 2026-08-28

### Release

- **Published to npm**: https://www.npmjs.com/package/dsh-plugin-runcat-inventory
  (v0.3.7, MIT, zero dependencies). It can now be installed directly with
  `dsh plugin --profile web add dsh-plugin-runcat-inventory`.
- Pre-publish metadata: `author` / `homepage` / `bugs` / `publishConfig`
  (registry pinned to the official source) / `files` extended (docs and
  screenshots included) / `keywords` gained `dsh-plugin`; added an MIT
  `LICENSE` (Copyright runcat-tommy).
- **The npm page README is English**: npm only renders `README.md`, so at
  publish time the content of `README.en.md` temporarily replaces
  `README.md`, then the Chinese version is restored. **Repeat this step on
  every future publish** (or switch back to a Chinese page — see the README).

### Docs

- **Added preview screenshots**: `assets/preview-zh.png` (Chinese UI) and
  `assets/preview-en.png` (English UI); the Chinese README gained a
  "效果预览" section showing the Chinese screenshot, and the English README
  gained a "Screenshot" section showing the English one.

---

## [0.3.6] - 2026-08-28

### Docs

- **Added `CHANGELOG.en.md`** (this file): full English translation of the
  changelog; both changelogs link to each other via the language switcher at
  the top (`中文 | English`).
- The English README now links to the English changelog.

---

## [0.3.5] - 2026-08-28

### Docs

- **Installation gained "Method B: install directly from the GitHub source"**:
  `dsh plugin --profile web add github:runcat-tommy/dsh-plugin-runcat-inventory`
  (listed alongside Method A — local clone; both note their differences:
  `link:` for local development / direct fetch).
- **Added `README.en.md`**: a complete English documentation
  (features / structure / prerequisites / installation A & B / how it works /
  uninstall / limitations / changelog summary); both READMEs link to each
  other via the language switcher (`中文 | English`).

---

## [0.3.4] - 2026-08-27

### Docs

- **Folder name unified**: the directory name in the usage instructions was
  changed from `runcat-inventory` to `dsh-plugin-runcat-inventory` (matching
  the local folder name after cloning
  `https://github.com/runcat-tommy/dsh-plugin-runcat-inventory`); the
  structure tree and install steps were updated accordingly.
- **Added a "Prerequisites" section**: clarifies Node.js (DSH is a Node
  program, required), pnpm (`dsh plugin` forwards to pnpm, required), Git
  (needed for cloning or GitHub-source installs), and network (GitHub access,
  configure a proxy if needed); also notes that the plugin itself has zero
  dependencies.
- Clarified the loader entry in the verification paragraph: id is
  `runcat-inventory`, name is `dsh-plugin-runcat-inventory`, to avoid
  confusion with the folder name.

---

## [0.3.3] - 2026-08-27

### Changes

- **The plugin's own description now follows the UI language**: the zh/en
  dictionaries gained a `selfDescription` key (one per language); in the
  "Details" expanded row, this plugin's Description is shown in the current
  language. Other plugins still show their package.json `description` verbatim
  (a single language chosen by the author; no generic translation possible).

---

## [0.3.2] - 2026-08-27

### Fixes

- **Only this plugin shows the repo URL in the Source column**: the previous
  version wrongly showed the repo URL for every plugin carrying a
  `repository` field; corrected — only `dsh-plugin-runcat-inventory` shows
  `https://github.com/runcat-tommy/dsh-plugin-runcat-inventory`, the rest
  fall back to their install method (link/file/github/npm/builtin).
- **Source-column overflow fix**: long URLs could spill into the adjacent
  "Actions" column — the Source content now forces line breaking with
  `word-break: break-all` + `overflow-wrap: anywhere`, so content always
  wraps inside the 21% column.

### Tests

- mock tests updated: `hello` restored to its `link` source assertion; a new
  entry for this plugin added (`sourceKind='repo'` + URL-cleanup assertion).
  All 5 cases pass.

---

## [0.3.1] - 2026-08-27

### Changes

- **Fixed column ratios** (`table-layout: fixed` + `<colgroup>`):
  Name 36% / Status 15% / Source 21% / Actions 28% (name is the most
  important and takes the largest share); the Status and Actions columns have
  minimum widths to protect badges and buttons from being squeezed.
- **Source column prefers the repo URL**: the host reads the `repository`
  field of each package's `package.json` (cleaning the `git+` prefix and
  `.git` suffix), showing the repo URL when present; otherwise falls back to
  the install method (link/file/github/npm/builtin).
- This plugin's `package.json` gained a `repository` field →
  `https://github.com/runcat-tommy/dsh-plugin-runcat-inventory`.

### Tests

- mock tests updated: the fake `dsh-plugin-hello` package gained a
  `repository`; assertions for `sourceKind='repo'` and URL cleaning added;
  other cases unchanged. All 5 cases pass.

---

## [0.3.0] - 2026-08-27

### Internationalization (UI language follows the DSH environment)

- **Bilingual dictionaries**: registered Simplified Chinese / English
  dictionaries through DSH's built-in locale service
  (`@deepseek-ai/dsh-client-locale`); the UI follows the DSH environment
  (Settings → General → Language or the browser language) without restart.
- **Tab name**: 逃咪-插件总览 in Chinese, **Runcat Plugin Overview** in
  English (the label became a locale function, re-rendered on language
  switch).
- **All UI copy goes through dictionaries**: 40+ items — search / filters /
  sorting / buttons / badges / hints / empty states — all `t('key')`-based.
- **Full host i18n**:
  - Error messages became **error codes** (`MISSING_PARAMS`,
    `PATCH_READ_FAILED`, `PATCH_PARSE_FAILED`, `PATCH_WRITE_FAILED`, and 9
    more — 13 in total), translated client-side from dictionaries;
  - The source field became `sourceKind`
    (link/file/github/npm/builtin/other) + `sourceSpec` (raw spec); display
    copy is translated client-side.
- Terminal logs (host logger) and README/CHANGELOG docs stay Chinese
  (operational convention).

### Tests

- mock unit tests updated in sync: source assertions now use
  `sourceKind`/`sourceSpec`, error assertions use error codes; the 403 test
  asserts code `FORBIDDEN`. All 5 cases pass.

---

## [0.2.1] - 2026-08-27

### Changes

- The plugin's Chinese name changed from "**逃猫**-插件总览" to
  "**逃咪**-插件总览" (tab label, package.json description and keywords,
  README/CHANGELOG and code comments updated together).

---

## [0.2.0] - 2026-08-27

### UI redesign (a slimmer table)

- **Fixed 4-column table**: `Name (incl. id + version) / Status / Source /
  Actions`; the "Description" column was removed — the full description moved
  into the "Details" expanded row; the list got noticeably narrower and
  generally needs no horizontal scrolling at normal widths.
- **Sticky columns removed**: the Name and Actions columns are no longer
  fixed; at extremely narrow widths they scroll with the content.
- **"Details" button rule**: shown when there is a description (non-empty)
  or a config (non-empty); hidden when both are empty. Empty objects `{}` /
  empty arrays `[]` count as no content.
- **Details expanded row**: colSpan adjusted (5→4); still shows the full
  description + config JSON + a "Copy config" button.

### Interaction improvements

- **Search**: confirmed a single combined search (name + id + description +
  source + version); no field selector. The id is displayed under the name
  column, so searching by id locates entries directly.
- **Description**: kept the full-text hover tooltip (native title); removed
  click-to-expand on the description itself (that entry point is now the
  unified "Details" button).
- **Sorting**: added name sorting — `Config order` (default) / `Name ↑` /
  `Name ↓` (Chinese localeCompare).
- **Keyboard scrolling**: after focusing the table container, ←/→ scroll
  horizontally; Home/End jump to the start/end.
- **Narrow screens**: the Source column hides automatically below 900px.

### Technical fixes

- Fixed the `node:fs` callback-style `readFile` being passed `'utf8'` as the
  callback (switched to `node:fs/promises`).
- Fixed Windows `require.resolve` returning a drive-letter path that could not
  be passed straight to `import()` (converted to a file URL).
- Added `hasConfigContent` to unify the "does the config have content"
  semantics.

### Tests

- All 5 host-half mock unit tests pass (`node test/mock-test.mjs`): route
  registration, inventory collection, enable/disable write & restore,
  security check, parameter validation.

---

## [0.1.0] - 2026-08-27

### Initial release

- First usable version: a 7-column table (Name / Status / Version / Source /
  Description / Config / Actions).
- Data collected live from the host's `ctx.loader.entries()` + description /
  version from each package's `package.json` + source derived from the
  profile manifest.
- Enable/Disable: edits the profile's `cordis.patch.yml` (user override
  layer); DSH hot-applies it via HMR — no Web UI restart needed.
- Communication: the browser half fetches same-origin `/runcat-api` routes
  with a loopback trust check (CSRF protection).
- Config view/copy, copy plugin name/module name, search box + status filter.
- Install: `dsh plugin --profile web add .`

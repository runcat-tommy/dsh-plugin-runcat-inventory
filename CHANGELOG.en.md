# Changelog

[中文](CHANGELOG.md) | **English**

This file records the version history of `dsh-plugin-runcat-inventory` (Runcat Plugin Overview / 逃咪-插件总览).

## [0.3.7] - 2026-08-27

### Docs

- **Added preview screenshots**: `assets/preview-zh.png` (Chinese UI) and
  `assets/preview-en.png` (English UI); the Chinese README gained a
  "效果预览" section showing the Chinese screenshot, and the English README
  gained a "Screenshot" section showing the English one.

---

## [0.3.6] - 2026-08-27

### Docs

- **Added `CHANGELOG.en.md`** (this file): full English translation of the
  changelog; both changelogs link to each other via the language switcher at
  the top (`中文 | English`).
- The English README now links to the English changelog.

---

## [0.3.5] - 2026-08-27

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

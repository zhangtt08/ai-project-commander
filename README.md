# AI Project Commander

**AI 项目管理中枢** — the control plane for AI coding projects.

Commander manages the projects that Codex, Claude Code, Cursor, Gemini CLI and other
coding agents are building. It answers the questions that are impossible to answer after
a week of agent sessions:

- What stage is this project actually at?
- Does the build still pass? Do the tests still pass?
- What changed since the last snapshot? Was anything *regressed*?
- Is the project drifting away from its specification?
- What should the next agent do, exactly — and what should its prompt say?

It is **not** a Jira clone, a todo app, or a git GUI. Every conclusion it shows is derived
from real engineering evidence gathered on your disk.

---

## What is Project Commander

A local-first desktop application that:

1. **Discovers** the coding projects already on your machine and **registers** them.
2. **Classifies** each one (AI 智能体 / Web 应用 / 浏览器插件 / 桌面应用 / 数据与自动化 …)
   and states the evidence behind the label.
3. **Identifies its purpose** from its own README, `package.json` or spec — and says so when
   the repository declares nothing instead of inventing a purpose.
4. **Scans** stack, structure, specs, TODO markers and sensitive files.
5. **Runs** the detected build / test commands inside strict safety rails.
6. **Snapshots** the result and **detects regressions** between snapshots.
7. **Derives** stages, tasks, acceptance criteria, health, risk and progress.
8. **Proposes optimisations** — every one quoting the number it came from.
9. **Recommends** the next action and **generates** a ready-to-paste agent prompt.
10. **Publishes** the project to your own **private** GitHub repository on import, if you
    enable it.
11. **Tracks** every prompt → execution → evidence → acceptance link.

The **analysis pipeline is read-only**: scanning, building and testing never modify your
projects. Two operations do write, and only when you explicitly ask for them — deleting a
project's source files, and publishing it to GitHub. See [Security Model](#security-model).

## Core Features

| Area | What you get |
| --- | --- |
| Dashboard | Real counts (healthy / warning / critical / blocked) and per-project cards with live build, unit, e2e, git, gate and progress data |
| Attention Center | Critical health, build failures, failing suites, regressions, blocked tasks, dirty workspaces, spec drift, pending prompt reviews |
| Project Detail | 14 tabs: Overview · Stages · Tasks · Tests · Build · Git · Changes · Prompts · Agent Sessions · Risks · Memory · Decisions · Timeline · Settings |
| Acceptance Gate | PASS / FAIL / BLOCKED / UNKNOWN **with an explanation** of every blocking check |
| Health engine | healthy / warning / critical / unknown with a transparent, inspectable reason list ("Why?") |
| Risk engine | 16 deterministic rules, each with severity, evidence and a suggested action |
| Issues | File manual issues next to computed risks — computed vs. filed is always distinguishable |
| Regression detector | build PASS→FAIL, tests PASS→FAIL, passing-count drops, test-count drops, critical-risk increases, file deletions, gate regressions |
| Task Ledger | Tasks derived from specs, markdown checkboxes, TODO/FIXME markers, agent logs, manual entry and AI — with provenance and confidence |
| Project Memory | Versioned, append-only project memory rendered for prompts and handoffs |
| Next Action | Deterministic 12-rule decision chain; the LLM may re-word it, never re-choose it |
| Prompt Generator | Ten mandatory sections, guaranteed even if the provider omits them |
| Handoff Package | A complete brief so Codex → Claude → Cursor → Gemini can continue without the original chat |
| Search | SQLite FTS5 full-text across projects, tasks, prompts, risks and decisions (LIKE fallback) |
| Demo Mode | Three demo projects with real builds/tests — healthy, warning (22/25 e2e) and critical |

## Architecture

```
Presentation   src/web/**      native ES-module SPA (no build step)
API            src/server/**   zero-dependency HTTP router
Application    src/core/**     orchestrator · engines · analyzers · queue · watcher · AI
Domain         src/domain/**   enums · schemas · errors (imports nothing)
Infra          src/db/**       node:sqlite + versioned migrations + repository
               src/core/command-runner.js  the ONLY process-spawning module
               src/core/fs-safe.js         the ONLY workspace file-reading module
```

Dependency direction is strictly downward. The full pipeline diagram and interface
contracts live in [`docs/agent/ARCHITECTURE.md`](docs/agent/ARCHITECTURE.md).

**Deterministic First, LLM Second.** Git state, file existence, build results, test
counts, package managers and progress are computed by deterministic code. The AI provider
only summarises, explains and suggests — every AI response is schema-validated, retried
once on failure, and falls back to a deterministic mock that is *labelled as mock* in the UI.

## Tech Stack

- **Runtime**: Node.js ≥ 22.5 (uses the built-in `node:sqlite` — no native modules)
- **Backend**: zero-dependency HTTP server, ESM
- **Database**: SQLite (WAL, foreign keys, versioned migrations, FTS5 when available)
- **Frontend**: vanilla ES modules + hand-written CSS (Linear-style light theme)
- **Tests**: `node:test` (133 unit + 40 integration), Playwright/Chromium for E2E (16 steps)
- **Package manager**: npm — with **zero runtime dependencies**, `npm install` is instant and fully offline

## Quick Start

**Windows 桌面方式（推荐）**：双击桌面上的 **AI Project Commander** 快捷方式，或
`desktop\AIProjectCommander.exe`。它是一个原生 WinForms 外壳（自带图标、独立任务栏身份与
托盘），负责拉起本地服务并用 Edge 应用模式打开独立窗口；服务已在运行时它只会把窗口带回前台。

**Windows 脚本方式**：双击根目录的 `启动.bat`。若 exe 尚未构建，它会自动退回"启动服务 +
打开浏览器"的方式，并提示如何构建 exe。

命令行方式：

```bash
cd AI-Project-Commander
npm install        # no-op (zero dependencies) — kept for convention
npm run dev        # → http://127.0.0.1:8787（被占用时自动 +1，横幅会打印实际地址）
```

**首次启动不需要任何准备，也不会塞演示数据**：Commander 会扫描这台电脑（主目录、桌面、
文档、source 以及 D:/E:/F: 盘），把真正的项目目录导入并完成分类与用途识别，通常 2 秒内
就能看到有内容的仪表盘。想改搜索范围：设置 → 文件夹识别（拖拽导入）→ 搜索根目录。

### Adding your own project

`+ 添加项目` opens a dialog with two tabs:

- **扫描这台电脑** — lists project folders found on disk (with ecosystem, git state and last
  modification), ticks nothing by default, marks already-managed ones so they can't be
  added twice, and lets you import several at once.
- **输入路径** — an absolute path, plus an optional name and category.

**If a folder moves or you delete it in Explorer**, Commander stops presenting verdicts about it:
the card turns into 目录已不存在, the project drops out of the health counts and becomes one
critical attention item, and 优化建议 keeps a single honest entry quoting the real path and the
time of the last successful analysis. Open 项目 → 整理 (or 设置 in the project page) and type the
new location to relink it — the stale record is cleared and the project is re-analysed, so there is
no need to delete and re-import. A relink to a path that doesn't exist, to a file, or to a folder
another project already owns is refused with a reason and changes nothing.

Each project's overview page carries a **GitHub 私有仓库自动上传** card: the last stage (已上传 /
未开启 / 缺少令牌 / 上传失败 / 未尝试), the reason verbatim, the private repo link once one exists, a
**立即上传** button, and a link to Settings. With no token stored it says plainly that nothing was
sent anywhere — the feature is never invisible, and clicking it with no token returns the reason
instead of failing silently.

### Browsing your GitHub repositories without downloading them

侧栏 **GitHub → 仓库（只读）**（`#/github`）lists the repositories on your account — name, 私有/公开,
primary language, size, last push, description — and **只读查看** opens detail assembled from four
REST reads: language breakdown, the root file listing and the README text. Nothing is cloned or
written: no `git clone`, no `fetch`, no file on disk, no database row. The token stays server-side
(the browser only ever sees `__stored__`), and each part degrades on its own, so a README that
GitHub is still generating doesn't blank the panel.

This complements the publish path: Commander manages what is on this machine, and can additionally
*look at* what is on GitHub without pulling it down.

Either way Commander then:

1. scans it (structure, stack, specs, markers, sensitive files),
2. classifies it and identifies its purpose from real evidence,
3. produces optimisation suggestions, each quoting its evidence,
4. reads its git state, and detects and runs its build/test commands,
5. produces a snapshot, health verdict, risk list and next action,
6. and — if enabled in Settings — creates your **private** GitHub repo and pushes to it in
   the background, without delaying the import.

## Demo projects (test fixtures only)

The product never seeds demo data. Three demo projects exist purely as deterministic
fixtures for the E2E suite; `scripts/run-e2e.js` seeds them into an **isolated temp data
dir** and refuses to continue if the seed reports any other directory. To seed manually:

```bash
npm run seed:demo   # honours COMMANDER_DATA_DIR; set it, or you write into your real DB
```

## Development

```bash
npm run dev            # start the server (PORT / COMMANDER_DATA_DIR env overrides)
npm run build          # static build check: every module parses, assets + agent memory present
npm run typecheck      # parse + import/binding resolution for all 65 files
npm run lint           # architecture policy: no child_process outside CommandRunner,
                       # no fs writes outside sanctioned modules, no eval, domain purity
npm test               # unit + integration
npm run test:unit      # 133 unit tests (~8s)
npm run test:integration  # 40 integration tests (~40s, spawns real builds/tests)
npm run verify         # typecheck + lint + build + unit + integration in one command
```

## Testing

- **Unit** (`tests/unit/`): schema validator, sensitive-file detection, fs guards, ignore
  engine, scanner, command classification (allowlist + deny list), git analyzer, all three
  test-reporter parsers, spec parsing, task ledger, stage manager, acceptance gate, health,
  progress, risk, regression, drift, next-action ordering, prompt contract, handoff,
  memory versioning, structured-AI retry/fallback, queue concurrency/timeouts/cancellation,
  watcher debouncing, search (FTS5 + LIKE fallback), agent adapters.
- **Integration** (`tests/integration/`): three real fixture projects are generated, scanned,
  built and tested; a regression is injected and detected; idempotency of repeated scans;
  the full HTTP API surface; and a security suite proving that sensitive content never
  reaches the database, logs or AI requests, and that a managed workspace is byte-for-byte
  untouched by a full scan.
- **E2E** (`e2e/e2e_test.py`): real Chromium against a real server — dashboard, attention,
  project detail, tests, risks, next action, prompt generation, handoff, search, settings,
  keyboard navigation. Screenshots land in `.e2e-artifacts/`.

```bash
npm run test:e2e       # ~2.5 min (seeds demo data, starts server, drives Chromium)
                       # covers: dashboard, attention, detail, tests, risks, issues, tasks,
                       # decisions, memory, transcript import, prompt, handoff, search, a11y
```

## AI Provider Setup

Default is the offline **mock** provider (deterministic, no key, clearly labelled).
To use a real model, set an OpenAI-compatible endpoint:

```bash
# via the Settings screen (stored locally, never returned to the browser), or:
export OPENAI_API_KEY=sk-...
export OPENAI_BASE_URL=https://api.openai.com/v1   # or Ollama/vLLM/OpenRouter/Groq
```

Then Settings → Provider → `openai-compatible`. Every response is validated against a
schema; invalid output is retried once with the validation errors, then falls back to the
deterministic mock — `JSON.parse` is never trusted on its own.

## Security Model

| Surface | Guarantee |
| --- | --- |
| Sensitive files | `.env`, `*.pem`, `*.key`, `id_rsa`, `credentials*`, `secrets*`, `tokens*`, `.npmrc`, `.pypirc`, cloud credential dirs… are **detected but never read** — not into the DB, logs, or AI requests (enforced by tests) |
| Managed workspaces | The **analysis pipeline** (scan / build / test / regress) is read-only — enforced by an mtime-based test. Two **user-initiated** operations are the sanctioned exceptions, both gated: ① deleting a project can also wipe its source directory, but only after `assessPurgeTarget()` rejects drive roots, your home/Desktop/Documents, shallow paths and Commander's own data dir, **and** you type the folder name back as confirmation; ② GitHub publishing writes only into the project's own `.git` and pushes to a `github.com` remote — `ensureOriginRemote()` refuses any other host so your code cannot be redirected elsewhere |
| Command execution | One `CommandRunner`; `shell: false` always; an allowlist (git read-only inspection; `npm run/test`; `npx vitest/playwright`; and `git init/add/commit/push/remote` reserved for the explicit publish action) plus a deny list (`rm`, `del`, `format`, `git reset --hard`, `git clean`, `rebase`, `push --force`, `npm install`…). The publish verbs are deliberately **not** auto-run by any scan |
| GitHub token | Kept in the local SQLite settings table, never returned to the browser, never placed in a command line, never written into the project's `.git/config` — it travels to git only via `GIT_CONFIG_*` environment variables, and every logged or returned string is scrubbed |
| AI data boundary | Only paths, counts, statistics, short excerpts and failure messages are sent; secrets are masked before transmission |
| Secrets | API keys stay in the local SQLite settings table; the API never returns them |
| Frontend | No keys, no `innerHTML` with dynamic data, no eval |

See `GET /api/security` and the in-app **Security** page.

## Known Limitations

- The frontend is a no-build vanilla SPA (see `docs/agent/DECISIONS.md` ADR-001 — the
  npm registry was unreachable in the delivery environment). The REST contract is stable,
  so a React/Vite client can be added without touching the backend.
- Real Codex / Claude Code / Cursor transcript readers are **not** implemented — those
  tools' local history formats are unverified here. `ManualImportAdapter` (paste a
  transcript) and `MockAgentAdapter` (clearly labelled) ship instead; the adapter
  interface is frozen for future implementations.
- Language/framework detection covers the JS/TS ecosystem deeply (Node, TS, React, Vite,
  Next, Vitest, Jest, Playwright, Express, Nest, Electron…). Python/Go/Rust scanners are
  an extension point (`LANGUAGE_DETECTORS`), not a delivered feature.
- `node:sqlite` prints an `ExperimentalWarning` on Node 22 — expected, harmless.
- Test-output parsing understands vitest / jest / playwright reporters; other formats are
  reported as *unparseable* rather than guessed.
- The desktop shell is a native WinForms `.exe` compiled with the in-box `csc.exe`; the
  window itself is rendered by the locally installed Edge in `--app` mode, not Electron.
  Same Chromium engine, but it is not a single self-contained installer — another machine
  needs Node 22+ and Edge. WebView2's managed assemblies are absent here and the npm
  registry was too slow for Electron, so this was the zero-dependency route (ADR-001).
- **The Playwright E2E suite has not been executed on this machine** — Chromium is not
  installed and downloading it was declined. 270 unit/integration tests pass, and the UI
  was verified by driving the running app and capturing real window pixels, but the 21-step
  E2E run is unverified.
- **GitHub publishing is verified end-to-end against real GitHub** (2026-09-30): importing a
  project created a `private: true` repository on the account and pushed to it — confirmed by
  reading the repository, its file list and its commit back from GitHub's API, not just from
  Commander's own state. The credential used is the machine's own GitHub CLI login (`gh auth
  token`, scopes `gist, read:org, repo`), piped into Settings without ever being printed; the API
  only ever echoes `__stored__`. One thing the token cannot do is delete a repository (that needs
  a `delete_repo` scope), so removing a published repo stays a manual step on GitHub's side.

## Roadmap

P2 items only — everything above is delivered, not promised:

1. Real transcript adapters for Codex CLI / Claude Code / Cursor.
2. Python / Go / Rust ecosystem detectors.
3. Cross-project dependency graph and impact analysis.
4. AST-level semantic analysis for deeper drift detection.
5. Team features: shared instances, roles, remote Commander service.

## Agent Recovery

This repository is designed to be continued by any AI agent without chat history:

- [`docs/agent/PROJECT_STATE.md`](docs/agent/PROJECT_STATE.md) — current state
- [`docs/agent/NEXT_ACTION.md`](docs/agent/NEXT_ACTION.md) — what to do next
- [`docs/agent/RECOVERY.md`](docs/agent/RECOVERY.md) — the recovery protocol
- plus `MASTER_PLAN.md`, `TEST_STATUS.md`, `KNOWN_ISSUES.md`, `DECISIONS.md`,
  `CHANGELOG_DEV.md`, `ARCHITECTURE.md`

A fresh agent should read `RECOVERY.md`, run `npm run verify`, and continue from
`NEXT_ACTION.md`.

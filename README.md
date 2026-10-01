# AI Project Commander

A local-first control plane for AI coding projects: it gathers real engineering evidence from the projects your coding agents (Codex, Claude Code, Cursor, Gemini CLI…) are building, and answers — with evidence — what stage each project is actually at, whether builds and tests still pass, what regressed since the last snapshot, and what the agent should do next.

AI 项目管理中枢 —— 汇聚 coding agent 项目的真实工程证据，判定阶段、跟踪构建与测试、检测回归漂移，并给出下一步行动与可直接粘贴的 agent 提示词。

**English** | [简体中文](README.zh-CN.md)

![License](https://img.shields.io/badge/license-MIT-blue)
![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.5-339933)
![Dependencies](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen)
![Database](https://img.shields.io/badge/db-SQLite%20(node%3Asqlite)-003B57)
![Frontend](https://img.shields.io/badge/frontend-vanilla%20ES%20modules-f7df1e)
![Platform](https://img.shields.io/badge/platform-Windows-0078D6)

## Why

A week into agent-driven development, nobody can answer simple questions anymore: what stage is this project really at, does the build still pass, did yesterday's session silently break tests, is the code drifting away from the spec? Commander scans the projects already on your machine, runs their build/test commands inside strict safety rails, snapshots the results, detects regressions between snapshots, and turns all of it into stage verdicts, risk lists, a next action and a ready-to-paste agent prompt. It is **not** a Jira clone, a todo app or a git GUI — every conclusion it shows is derived from real engineering evidence on your disk, and the analysis pipeline is read-only.

## ✨ Features

- **Decision-first dashboard & Attention Center** — the dashboard opens on the projects that need you *right now* (build failures, failing suites, regressions, blocked tasks, missing folders), each with one primary action that jumps straight to the verified reason; the remaining projects collapse into a compact list that is still one click away. Nothing is deleted or hidden behind a route — every project and every detail page stays reachable. The Attention Center keeps the full severity-sorted queue.
- **Evidence-based verdicts** — projects are classified (AI agent / web app / browser extension / desktop app / data & automation…) with the evidence stated; purpose is read from the repo's own README/package.json/spec, and reported as "declares nothing" instead of invented. Status is always a verifiable fact (a failed command, a count of open reasons), never a score, percentage or model-confidence pseudo-judgment.
- **Acceptance gate & health engine** — PASS / FAIL / BLOCKED / UNKNOWN with an explanation of every blocking check; health (healthy/warning/critical) with a transparent, inspectable "Why?" reason list.
- **Regression detector** — build PASS→FAIL, tests PASS→FAIL, passing-count drops, test-count drops, critical-risk increases, file deletions, gate regressions between snapshots.
- **Risk engine & issues** — 16 deterministic rules with severity, evidence and a suggested action; manual issues can be filed next to computed ones (always distinguishable).
- **Task Ledger** — tasks derived from specs, markdown checkboxes, TODO/FIXME markers, agent logs, manual entry and AI, each carrying its provenance.
- **Next Action & Prompt Generator** — a deterministic 12-rule decision chain (the LLM may re-word it, never re-choose it) and a prompt with ten mandatory sections; a **Handoff Package** lets Codex → Claude → Cursor → Gemini continue without the original chat.
- **Bounded background queue** — scans that run real builds/tests are enqueued with bounded concurrency, per-job timeouts, automatic retry and cancellation; the queue page auto-refreshes while a job is running and shows elapsed time against its ceiling.
- **Fill in a missing command from the UI** — when a build/test/typecheck command can't be auto-detected, add it on the project's overview and run just that command; the pinned command still passes through the same command allowlist, so it cannot bypass the safety model.
- **Project memory & search** — versioned, append-only project memory; SQLite FTS5 full-text across projects, tasks, prompts, risks and decisions (LIKE fallback).
- **Deterministic first, LLM second** — git state, file existence, build results and test counts are computed by code; the optional AI provider only summarises/explains/suggests, every response is schema-validated with one retry, and the offline mock fallback is *labelled as mock* in the UI.
- **Optional private GitHub publishing** — on import (if you enable it), creates your **private** GitHub repo and pushes in the background; the token stays in local SQLite, never returned to the browser or written to `.git/config`. Verified end-to-end against real GitHub.
- **Zero runtime dependencies** — Node.js built-ins only (`node:sqlite`, no native modules); `npm install` is instant and fully offline.

## 🚀 Quick Start

**Prerequisites**: Node.js ≥ 22.5 (uses the built-in `node:sqlite`). Windows recommended for the desktop launcher; the CLI route works anywhere Node runs. There is nothing to install — the server has zero runtime dependencies.

```bash
git clone https://github.com/zhangtt08/ai-project-commander.git
cd ai-project-commander
node src/server/cli.js start   # zero-dependency start → http://127.0.0.1:8787
                               # (port auto-increments if taken; the banner prints the real URL)
```

Equivalent npm aliases: `npm run dev` / `npm run start` both call `node src/server/cli.js`. `npm install` is a no-op (kept only for convention).

**Windows desktop (recommended on Windows)**: double-click `desktop\AIProjectCommander.exe` (or the root `启动.bat`, which falls back to "start server + open browser" if the exe isn't built). It is a native WinForms shell that starts the local server and opens an Edge app-mode window.

First launch needs no setup and seeds no demo data: Commander scans this machine (home, Desktop, Documents, `source`, and the D:/E:/F: drives), imports the real project directories it finds, and classifies them — usually within ~2 seconds you see a populated dashboard. Search roots are configurable under Settings → folder detection.

## 🔌 API overview

Every `/api/*` response is wrapped as `{ "data": … }` on success, or `{ "error": { code, message, hint } }` with an HTTP status on failure; content-type is always `application/json`. The surface is stable and consumed directly by the SPA and by coding agents.

| Area | Endpoints |
|---|---|
| Health / meta | `GET /api/health` · `GET /api/system` · `GET /api/security` · `GET /api/meta` |
| Aggregation | `GET /api/dashboard` (counts + cards) · `GET /api/attention` (severity-sorted) · `GET /api/search?q=` |
| Projects | `GET/POST /api/projects` · `GET/PATCH/DELETE /api/projects/{id}` · `GET /api/projects/{id}/detail` · `GET /api/projects/{id}/suggestions` · archive / unarchive / pause-watch / resume-watch |
| Commands | `POST /api/projects/{id}/commands` (pin build/test/typecheck) · `POST /api/projects/{id}/commands/run` (run one kind via the queue) |
| Scan / queue | `POST /api/projects/{id}/scan` · `POST /api/projects/{id}/scan-sync` · `GET /api/jobs` · `GET /api/jobs/stats` · `POST /api/jobs/{id}/cancel` |
| Evidence | `/api/projects/{id}/` + `tests` · `builds` · `git` · `changes` · `snapshots` · `risks` · `regressions` · `issues` · `stages` · `tasks` · `memory` · `decisions` · `timeline` |
| Next action / agent | `GET/POST /api/projects/{id}/next-action` · `GET/POST /api/projects/{id}/prompts` · `GET /api/projects/{id}/handoff` · `POST /api/projects/{id}/handoff/export` · sessions import |
| Discovery / import | `GET /api/discovery` · `POST /api/discovery/import` · `POST /api/workspaces/resolve` |
| GitHub | `POST /api/projects/{id}/github/publish` · `POST /api/github/verify` · `GET /api/github/remote/repos` · `GET /api/github/remote/repo` |
| Settings / AI | `GET/PATCH /api/settings` · `POST /api/projects/{id}/ai/{summary,risks,tasks,drift,enrich}` |


## 🏗️ Architecture

```
Presentation   src/web/**      native ES-module SPA (no build step)
API            src/server/**   zero-dependency HTTP router
Application    src/core/**     orchestrator · engines · analyzers · queue · watcher · AI
Domain         src/domain/**   enums · schemas · errors (imports nothing)
Infra          src/db/**       node:sqlite + versioned migrations + repository
               src/core/command-runner.js  the ONLY process-spawning module
               src/core/fs-safe.js         the ONLY workspace file-reading module
```

Dependency direction is strictly downward. The full pipeline diagram and interface contracts live in [`docs/agent/ARCHITECTURE.md`](docs/agent/ARCHITECTURE.md). Security guarantees (read-only analysis pipeline, command allow/deny lists, sensitive-file detection that never reads `.env`/`*.pem`/keys into DB, logs or AI requests, GitHub token handling) are enforced by tests — see the full [Security Model (中文)](README.zh-CN.md#安全模型) table and `GET /api/security` / the in-app Security page.

## 🧪 Verify

```bash
npm run verify            # typecheck + lint + build + unit + integration in one command
npm run test:unit         # 240 unit tests
npm run test:integration  # 77 integration tests (spawns real builds/tests, ~40s)
npm run test:e2e          # Playwright suite (seeds isolated demo fixtures) — needs Chromium
```

Honest status note (measured on the development machine): `typecheck`, `lint`, `build`, 240 unit and 77 integration tests all pass (317 total). The Playwright E2E suite was **not** executed here because Chromium is not installed on this machine; it is unverified on this host. The UI was verified against the running server (headless render + served-API checks). Real Codex/Claude/Cursor transcript readers are not implemented yet — a manual paste-import adapter and a clearly-labelled mock ship instead. The full list is in [Known Limitations (中文)](README.zh-CN.md#已知边界).

## 🗺️ Roadmap

Delivered above; planned (P2): real transcript adapters for Codex CLI / Claude Code / Cursor · Python/Go/Rust ecosystem detectors · cross-project dependency graph · AST-level drift detection · team features.

## 📄 License

[MIT](LICENSE)

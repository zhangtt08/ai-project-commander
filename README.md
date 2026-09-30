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

- **Dashboard & Attention Center** — real counts (healthy / warning / critical / blocked), per-project cards with live build, unit, e2e, git, gate and progress data, plus a queue of everything that needs you: build failures, failing suites, regressions, blocked tasks, dirty workspaces, spec drift, pending prompt reviews.
- **Evidence-based verdicts** — projects are classified (AI agent / web app / browser extension / desktop app / data & automation…) with the evidence stated; purpose is read from the repo's own README/package.json/spec, and reported as "declares nothing" instead of invented.
- **Acceptance gate & health engine** — PASS / FAIL / BLOCKED / UNKNOWN with an explanation of every blocking check; health (healthy/warning/critical) with a transparent, inspectable "Why?" reason list.
- **Regression detector** — build PASS→FAIL, tests PASS→FAIL, passing-count drops, test-count drops, critical-risk increases, file deletions, gate regressions between snapshots.
- **Risk engine & issues** — 16 deterministic rules with severity, evidence and a suggested action; manual issues can be filed next to computed ones (always distinguishable).
- **Task Ledger** — tasks derived from specs, markdown checkboxes, TODO/FIXME markers, agent logs, manual entry and AI, with provenance and confidence.
- **Next Action & Prompt Generator** — a deterministic 12-rule decision chain (the LLM may re-word it, never re-choose it) and a prompt with ten mandatory sections; a **Handoff Package** lets Codex → Claude → Cursor → Gemini continue without the original chat.
- **Project memory & search** — versioned, append-only project memory; SQLite FTS5 full-text across projects, tasks, prompts, risks and decisions (LIKE fallback).
- **Deterministic first, LLM second** — git state, file existence, build results and test counts are computed by code; the optional AI provider only summarises/explains/suggests, every response is schema-validated with one retry, and the offline mock fallback is *labelled as mock* in the UI.
- **Optional private GitHub publishing** — on import (if you enable it), creates your **private** GitHub repo and pushes in the background; the token stays in local SQLite, never returned to the browser or written to `.git/config`. Verified end-to-end against real GitHub.
- **Zero runtime dependencies** — Node.js built-ins only (`node:sqlite`, no native modules); `npm install` is instant and fully offline.

## 🚀 Quick Start

**Prerequisites**: Node.js ≥ 22.5 (uses the built-in `node:sqlite`). Windows recommended for the desktop launcher; the CLI route works anywhere Node runs.

```bash
git clone https://github.com/zhangtt08/ai-project-commander.git
cd ai-project-commander
npm install        # no-op (zero dependencies) — kept for convention
npm run dev        # → http://127.0.0.1:8787 (port auto-increments if taken; the banner prints the real URL)
```

**Windows desktop (recommended on Windows)**: double-click `desktop\AIProjectCommander.exe` (or the root `启动.bat`, which falls back to "start server + open browser" if the exe isn't built). It is a native WinForms shell that starts the local server and opens an Edge app-mode window.

First launch needs no setup and seeds no demo data: Commander scans this machine (home, Desktop, Documents, `source`, and the D:/E:/F: drives), imports the real project directories it finds, and classifies them — usually within ~2 seconds you see a populated dashboard. Search roots are configurable under Settings → folder detection.

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
npm run test:unit         # 133 unit tests (~8s)
npm run test:integration  # 40 integration tests (~40s, spawns real builds/tests)
npm run test:e2e          # ~2.5 min Playwright/Chromium run (seeds isolated demo fixtures)
```

Honest status note: 270 unit/integration tests pass; the UI was verified against the running app, but the Playwright E2E suite has not been executed on the development machine (Chromium was not installed there). Real Codex/Claude/Cursor transcript readers are not implemented yet — a manual paste-import adapter and a clearly-labelled mock ship instead. The full list is in [Known Limitations (中文)](README.zh-CN.md#已知边界).

## 🗺️ Roadmap

Delivered above; planned (P2): real transcript adapters for Codex CLI / Claude Code / Cursor · Python/Go/Rust ecosystem detectors · cross-project dependency graph · AST-level drift detection · team features.

## 📄 License

[MIT](LICENSE)

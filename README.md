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

A local-first desktop-class web application that:

1. **Registers** local workspaces (read-only — it never writes into your projects).
2. **Scans** them: stack, structure, specs, TODO markers, sensitive files.
3. **Runs** the detected build / test commands inside strict safety rails.
4. **Snapshots** the result and **detects regressions** between snapshots.
5. **Derives** stages, tasks, acceptance criteria, health, risk and progress.
6. **Recommends** the next action and **generates** a ready-to-paste agent prompt.
7. **Tracks** every prompt → execution → evidence → acceptance link.

## Core Features

| Area | What you get |
| --- | --- |
| Dashboard | Real counts (healthy / warning / critical / blocked) and per-project cards with live build, unit, e2e, git, gate and progress data |
| Attention Center | Critical health, build failures, failing suites, regressions, blocked tasks, dirty workspaces, spec drift, pending prompt reviews |
| Project Detail | 14 tabs: Overview · Stages · Tasks · Tests · Build · Git · Changes · Prompts · Agent Sessions · Risks · Memory · Decisions · Timeline · Settings |
| Acceptance Gate | PASS / FAIL / BLOCKED / UNKNOWN **with an explanation** of every blocking check |
| Health engine | healthy / warning / critical / unknown with a transparent, inspectable reason list ("Why?") |
| Risk engine | 16 deterministic rules, each with severity, evidence and a suggested action |
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
- **Tests**: `node:test` (133 unit + 40 integration), Playwright/Chromium for E2E (12 steps)
- **Package manager**: npm — with **zero runtime dependencies**, `npm install` is instant and fully offline

## Quick Start

```bash
cd AI-Project-Commander
npm install        # no-op (zero dependencies) — kept for convention
npm run dev        # → http://127.0.0.1:8787
```

On first start Commander seeds and analyses three demo projects. To re-seed:

```bash
npm run seed:demo
```

### Adding your own project

`Projects → Add project` → enter an absolute path. Commander will:

1. scan it (structure, stack, specs, markers, sensitive files),
2. read its git state,
3. detect and run its build/test commands,
4. produce a snapshot, health verdict, risk list and next action.

## Demo Mode

No API key required. The three demo projects are real repositories generated on disk
under `data/demo-projects/`, built and tested by real subprocesses:

| Demo | Health | Evidence |
| --- | --- | --- |
| ShopFlow Web | healthy · gate PASS | build pass, unit 6/6, e2e 22/22 |
| FitPlan Tracker | warning · gate FAIL | unit 2/2, **e2e 22/25** with 3 captured failures |
| Legacy Billing | critical | build fail, unit 3/5, e2e 5/6 |

Every AI-flavoured result is produced by the deterministic Mock provider and labelled
`mock (deterministic)` in the UI — nothing pretends to be a real LLM.

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
| Command execution | One `CommandRunner`; `shell: false` always; an allowlist (git read-only, `npm run/test`, `npx vitest/playwright`) plus a deny list (`rm`, `del`, `format`, `git reset --hard`, `git clean`, `rebase`, `push --force`, `npm install`…) |
| Managed workspaces | **Read-only by construction** — the codebase contains no write path into a managed workspace (verified by an mtime-based test) |
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

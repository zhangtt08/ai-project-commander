# DECISIONS.md — 架构决策记录

---

## ADR-001 — 零运行时依赖 + 无构建步骤的 MVP 技术栈

**Status:** accepted
**Date:** Stage 0

**Context**
需求推荐 React + TypeScript + Vite + Tailwind + Drizzle + Vitest + Playwright。但当前开发机到 npm registry 的网络极慢（实测 13 分钟仅解出 2 个包），且本机禁止触碰 `%LOCALAPPDATA%\ms-playwright` 浏览器缓存。若坚持该栈，MVP 无法在本环境内被真正运行与验证。

**Alternatives**
1. 完整 React/Vite/Tailwind/Drizzle/Vitest 栈 —— 网络不可行，交付物将停留在"骨架 + TODO"。
2. 只写后端，前端用静态 HTML 假数据 —— 违反"禁止 Mock UI"。
3. **零依赖 Node.js（内置 `node:sqlite`）+ 原生 ES Module 单页应用 + `node:test` 单测 + Python Playwright E2E**。

**Chosen Approach**
方案 3。

**Why**
- `node:sqlite` 是 Node 22.5+ 内置能力，提供真实 SQLite 文件、真实 SQL、真实迁移——满足"不是 mock 数据库"。
- 前端是真实的 SPA（hash 路由、真实 fetch 后端 API、真实状态机），只是不经过打包器；信息密度与交互能力不受影响。
- `node:test` 是 Node 内置测试运行器，零安装即可跑真实断言。
- E2E 使用本机已就绪的 Python Playwright + Chromium，是**真实浏览器**验证，不是 jsdom 模拟。
- 结果：`npm install`（无依赖）0 秒完成，`npm run dev` 立即可用，完全离线可复现。

**Tradeoffs**
- 放弃 JSX 组件模型与 TS 编译期类型检查（以 `tools/typecheck.js` 静态检查 + JSDoc 注解补偿）。
- 放弃 Drizzle 的类型安全查询（以 Repository 层 + 参数化 SQL 补偿，杜绝 SQL 注入）。

**Future Migration**
领域层（`src/domain`）与适配层（`src/core`）完全不依赖前端技术。
迁移路径：保留 `src/server` 的全部 API，新增 `apps/web`(React+Vite) 复用同一份 REST 契约；
ORM 层替换为 Drizzle 时，只需重写 `src/db/repositories.js`，其余代码零改动。

---

## ADR-002 — Deterministic First, LLM Second

**Status:** accepted

**Context**
产品要回答"项目做到哪了 / 测试还过吗 / 是否回归"。若这些结论来自 LLM，会产生幻觉且不可复现。

**Chosen Approach**
以下事实**只能**来自确定性代码，LLM 无权产出：
git branch / commit / diff、文件是否存在、build 是否通过、测试数量与失败数、package manager、项目路径、文件修改数量。
LLM 仅用于：项目总结、任务理解、风险解释、change 分类、drift 分析、下一步建议、Prompt 生成。
每个 AI 结论必须携带 `confidence`（high/medium/low/unknown）与 `EvidenceReference[]`。

**Tradeoffs**
部分语义判断（如"这个改动是 feature 还是 refactor"）质量低于纯 LLM；以规则优先 + AI 补充换取可复现性。

---

## ADR-003 — 所有外部命令必须经过 CommandRunner

**Status:** accepted

**Chosen Approach**
业务代码中出现任何 `child_process.spawn/exec` 都属于违规，由 `tools/lint.js` 静态检查拦截。
CommandRunner 强制：`shell: false`、allowlist 校验、超时、输出截断、危险命令拒绝、审计日志。

**Dangerous 黑名单（永远拒绝）**
`rm`、`del`、`rmdir`、`format`、`mkfs`、`git reset --hard`、`git clean`、`git rebase`、`git push --force`、`git checkout --`、`chmod`、任意 `npm install <未知包>`、`curl|sh`、`Invoke-Expression`。

**Why**
被管理的 Workspace 是用户的真实代码。任何误执行都不可逆。

---

## ADR-004 — 敏感文件"存在性可见，内容不可见"

**Status:** accepted

**Chosen Approach**
`SensitiveFileDetector` 匹配到 `.env` / `*.pem` / `*.key` / `id_rsa` / `credentials*` / `secrets*` / `tokens*` / `.npmrc` / `.pypirc` 等时：
- 允许记录：相对路径 + 匹配的规则名 + 文件大小
- 禁止：`fs.readFile`、写数据库内容字段、写日志、发送给 AI Provider、返回给前端

**Enforcement**
`src/core/fs-safe.js` 提供唯一的读文件入口，内部强制调用 `assertNotSensitive()`；
读源码的代码路径不直接使用 `node:fs`。安全测试断言敏感内容从未出现在 DB / 日志 / AI 请求中。

---

## ADR-005 — Evidence 是一等公民

**Status:** accepted

**Chosen Approach**
`evidence_refs` 表关联任意实体。`EvidenceReference` 类型：`file` / `test` / `commit` / `spec` / `command` / `diff` / `snapshot`。
Risk、Regression、Task、NextAction、AI 结论全部携带 evidence。
前端所有结论旁提供 "Why? / Evidence" 入口，可点开看到原始证据。

**Why**
产品目标之一是"防止项目偏离原始需求"。没有证据的结论无法被审计，等同于没有结论。

---

## ADR-006 — Progress 禁止由 LLM 生成

**Status:** accepted

**Chosen Approach**
Progress 只由 `StageCompletion × weight + TaskCompletion × weight + AcceptanceCriteria × weight` 计算，
三项权重为 0.4 / 0.3 / 0.3（可在 Settings 调整）。任一必要输入缺失（无 stage 且无 task），返回 `unknown` 而非猜测数字。

---

## ADR-007 — 快照而非复制源码

**Status:** accepted

**Chosen Approach**
`ProjectSnapshot` 保存 git 指纹、命令结果、测试统计、风险摘要、`fileFingerprint`（路径+大小+mtimes 的哈希）。
不保存源码内容。这样既能做回归对比，又不会把用户代码搬进 Commander 的数据库。

---

## ADR-008 — Mock Provider 是 fallback 而不是假象

**Status:** accepted

**Chosen Approach**
`MockAIProvider` 不伪装成真实模型：它输出确定性结构化结果，并在每条结果的 `provider` 字段标记 `mock`，
前端对 mock 来源的 AI 结论显示 "Mock (deterministic)" 徽章。无 API Key 时系统仍完整可用（Demo Mode）。
所有 AI 输出必须通过 Schema 校验，失败则重试一次，再失败回退 Mock——绝不 `JSON.parse` 后直接使用。

---

## ADR-009 — 被管理 Workspace 的只读保证

**Status:** accepted → **amended 2026-09-29**（原绝对表述已不成立，见下）

**Chosen Approach**
所有涉及被管理项目的文件系统调用只使用 `readFile / readdir / stat / lstat`，代码库中不存在指向被管理路径的
`writeFile / appendFile / mkdir / rm / rename / copyFile`。安全测试在 fixture 项目上记录全量文件 mtime，
执行完整分析链路后断言 mtime 无变化。
唯一例外：Commander 自己的 `data/` 目录。

### Amendment (2026-09-29) — 保证范围收窄到「分析链路」

需求新增了两项本质上必须写入/删除被管理目录的能力，因此上面那句"代码库中不存在"已经不成立。
**本 ADR 现在约束的是分析链路（扫描 / 构建 / 测试 / 回归 / 漂移），这部分仍然绝对只读，
mtime 守护测试仍然有效。** 被放行的是两条只能由用户明确动作触发的路径：

| 例外 | 文件 | 触发方式 | 守护 |
| --- | --- | --- | --- |
| 删除项目时清除源文件 | `src/core/source-purge.js` | UI 勾选"同时删除源文件" + 回显项目名 | `assessPurgeTarget()` 拒绝磁盘根目录、home、Desktop/Documents/Downloads、层级 < 2、Commander 自身数据目录；`tests/unit/source-purge.test.js` 逐条守护 |
| 发布到私有 GitHub 仓库 | `src/core/github-publisher.js` | 设置里启用并配置 PAT | 只写项目自身 `.git`；`ensureOriginRemote()` 只接受 github.com，防止代码被推往他处；令牌只经 `GIT_CONFIG_*` 环境变量传递，不进 argv / 日志 / 数据库 / `.git/config` |

这两处对应 `tools/lint.js` 的白名单豁免。**豁免的理由写在守护测试上，不要"顺手修回去"**；
`git init/add/commit/push/remote` 也只为发布动作放行，任何扫描都不会自动执行它们。
详见 KNOWN_ISSUES.md 的 DEBT-010 / BUG-014。

---

## ADR-010 — Watcher 只产生事件，不直接调 LLM

**Status:** accepted

**Chosen Approach**
`WorkspaceWatcher` 使用 `fs.watch` + 500ms debounce + 1000 个事件的窗口限流，
忽略 `node_modules` / `.git` / `dist` / `build` / `coverage`。
产生 `WorkspaceChanged` 事件写入 `project_events`，并可选入队 `quick_scan`。
是否调用 AI 由用户在 Settings 显式开启，默认关闭。

**Why**
需求明确："不要每修改一行就调用 LLM。"

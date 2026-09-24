# ARCHITECTURE.md — AI Project Commander

## 1. 定位

AI Project Commander 是 **AI Coding 项目的控制平面**。它不写代码，它回答：
"这个项目做到哪了？build 还过吗？测试还过吗？有没有回归？下一个 Agent 该做什么？"

## 2. 分层

```
┌──────────────────────────────────────────────────────────────┐
│  Presentation  src/web/**        原生 ES Module SPA          │
│  (Dashboard / Attention / Project Detail 13 tabs / Settings)  │
└───────────────▲──────────────────────────────┬───────────────┘
                │ fetch /api/*                 │ SSE /api/events
┌───────────────┴──────────────────────────────▼───────────────┐
│  API  src/server/**   零依赖 HTTP router + 参数校验 + 错误映射 │
└───────────────▲──────────────────────────────────────────────┘
                │ 只调用 Orchestrator / Engine，不写业务逻辑
┌───────────────┴──────────────────────────────────────────────┐
│  Application  src/core/**                                     │
│   orchestrator · analyzers · engines · queue · watcher · ai    │
└───────────────▲──────────────────────────────────────────────┘
                │
┌───────────────┴──────────────────────────────────────────────┐
│  Domain  src/domain/**   枚举 / Schema / 纯函数规则            │
└───────────────▲──────────────────────────────────────────────┘
                │
┌───────────────┴──────────────────────────────────────────────┐
│  Infrastructure  src/db/**  node:sqlite + Migration + Repository│
│                  src/core/command-runner.js  (唯一进程出口)    │
│                  src/core/fs-safe.js         (唯一读文件出口)  │
└──────────────────────────────────────────────────────────────┘
```

**依赖方向严格单向向下。** `domain` 不 import 任何其他层；`core` 不 import `server`；`web` 只通过 HTTP 通信。

## 3. 数据流：Full Scan Pipeline

```
addProject(path)
   │
   ├─► 1  Scanner        ProjectMetadata + fileFingerprint   [确定性]
   ├─► 2  GitAnalyzer    branch/commit/dirty/diff            [确定性]
   ├─► 3  SpecManager    goals/requirements/acceptance       [确定性]
   ├─► 4  TaskLedger     spec/checkbox/TODO/FIXME 提取       [确定性]
   ├─► 5  StageManager   从 spec+task 推断阶段               [确定性]
   ├─► 6  BuildAnalyzer  npm run build → pass/fail/timeout   [确定性]
   ├─► 7  TestAnalyzer   vitest/jest/playwright 解析         [确定性]
   ├─► 8  RiskEngine     14 条规则                           [确定性]
   ├─► 9  HealthEngine   聚合 → healthy/warning/critical     [确定性]
   ├─► 10 AcceptanceGate PASS/FAIL/BLOCKED/UNKNOWN           [确定性]
   ├─► 11 Snapshot       落库 ProjectSnapshot                [确定性]
   ├─► 12 Regression     对比上一快照                        [确定性]
   ├─► 13 Progress       stage+task+acceptance 加权          [确定性]
   ├─► 14 Drift          与 spec 对比                        [规则 + AI 可选]
   ├─► 15 AI 总结/风险解释/NextAction/Prompt                 [LLM，可 Mock]
   └─► 16 Timeline       写入 ProjectEvent
```

步骤 1–14 全部是确定性代码，**任何 LLM 都无权修改其结果**。步骤 15 的 AI 输出必须通过 Schema 校验，
且每条结论携带 `confidence` 与 evidence。

## 4. 关键接口

### 4.1 AIProvider

```js
interface AIProvider {
  name: string
  kind: 'mock' | 'openai-compatible'
  isConfigured(): boolean
  completeStructured({ schema, system, prompt, context, maxRetries }): Promise<{
    data: object, provider: string, model: string,
    confidence: 'high'|'medium'|'low'|'unknown',
    evidence: EvidenceReference[],
    attempts: number, fallbackUsed: boolean
  }>
}
```
实现：`MockAIProvider`（确定性规则）、`OpenAICompatibleProvider`（OpenAI/Anthropic-compatible endpoint）。

### 4.2 CommandRunner

```js
runner.run({ command, args, cwd, timeoutMs, purpose, class })
  → { exitCode, signal, stdout, stderr, durationMs, truncated, blocked?, blockReason? }
```
`class` ∈ `read_only | validation | potentially_mutating | dangerous`。
`dangerous` 与不在 allowlist 中的命令直接返回 `exitCode: 127, blocked: true`，不产生子进程。

### 4.3 Repository

```js
repo.insert(table, obj) · repo.update(table, id, patch) · repo.get(table, id)
repo.list(table, where?) · repo.remove(table, id) · repo.raw(sql, params)
```
所有查询参数化。JSON 字段自动序列化/反序列化。

## 5. 核心领域模型（26 张表）

`projects` `stages` `milestones` `tasks` `specifications` `acceptance_criteria`
`agent_providers` `agent_sessions` `prompts` `executions`
`git_snapshots` `project_snapshots` `build_results` `test_runs` `test_case_results`
`issues` `risks` `regressions` `health_results` `project_memory` `architecture_decisions`
`artifacts` `project_events` `evidence_refs` `analysis_jobs` `app_settings`

关系主干：

```
project 1─n stage 1─n task
project 1─n specification 1─n acceptance_criterion
project 1─n project_snapshot 1─n build_result / test_run 1─n test_case_result
project 1─n regression
project 1─n prompt 1─1 execution 1─n evidence_ref
project 1─n project_memory (versioned) 1─n architecture_decision
```

## 6. Workspace Scanner

- **IgnoreEngine** 三层：默认忽略 → `.gitignore` 解析 → 用户自定义。
- 硬限制：单文件 ≤ 2 MB、总文件 ≤ 20000、递归深度 ≤ 12、二进制检测（NUL 字节嗅探）。
- 语言/框架识别信号：`package.json`（含 deps 分析）、`tsconfig.json`、`vite.config.*`、`next.config.*`、
  `playwright.config.*`、`vitest.config.*`、`.eslintrc*`、`src/`、`tests/`、`docs/`、`SPEC.md`、`README.md`。
- 预留扩展点：`LANGUAGE_DETECTORS` 数组，加入 Python/Go/Rust 检测器即可支持新生态。

## 7. 前后端边界

- 前端零业务逻辑，不做任何统计计算（保证"数据真实"只有一处来源）。
- 前端不做 git / 文件系统访问。
- 所有 AI 调用在后端发生，API Key 永不下发前端；前端只看到 `provider: 'mock' | 'openai-compatible'`。
- 错误返回统一为 `{ error: { code, message, hint? } }`，不含堆栈。

## 8. 安全模型

| 面 | 措施 |
| --- | --- |
| 敏感文件 | 只记录存在性，内容不读不存不传（ADR-004） |
| 命令执行 | CommandRunner allowlist + 危险黑名单（ADR-003） |
| 被管理项目 | 只读，无写入路径（ADR-009） |
| AI 数据边界 | 只发送路径/统计/摘录，不发送源码全文与 secret；发送前做 secret 掩码 |
| 前端 | 无密钥、无 HTML 注入（统一 textContent 渲染）、无 eval |
| 数据库 | 参数化 SQL、外键约束、JSON 字段白名单 |

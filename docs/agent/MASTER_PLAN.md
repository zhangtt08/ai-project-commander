# MASTER_PLAN.md — 可执行任务树

Legend: `[ ]` 未开始 · `[~]` 进行中 · `[x]` 已完成 · `[!]` 阻塞

## Stage 0 — Bootstrap + Persistent Agent Memory

- [x] 初始化项目目录 / package.json / .gitignore
- [x] 建立 docs/agent/ 9 个状态文件
- [x] 建立 core 运行时（logger / errors / config）
- [x] 建立零依赖约束下的技术选型决策并写入 DECISIONS.md

## Stage 1 — Domain Model + Database

- [x] 定义领域枚举常量（ProjectStatus / Health / TaskStatus / Severity ...）
- [x] 实现零依赖 schema 校验器（Zod-like：object/string/number/array/enum/optional）
- [x] 设计 26 张表 SQL Schema（projects, stages, tasks, specs, acceptance_criteria, agent_sessions, prompts, executions, git_snapshots, project_snapshots, build_results, test_runs, test_case_results, issues, risks, regressions, project_memory, architecture_decisions, artifacts, project_events, health_results, evidence_refs, analysis_jobs, app_settings, milestones, search_index）
- [x] 实现 Migration Engine（版本化、幂等、不删库升级）
- [x] 实现 Repository 层（generic CRUD + 按表映射）
- [x] 单测：migration 幂等 / 唯一约束 / JSON 序列化往返

## Stage 2 — Workspace Registry + Scanner

- [x] Workspace Registry：add / rename / rescan / pause / archive / delete-record（不删源码）
- [x] IgnoreEngine：.gitignore + 默认忽略 + 用户自定义 + 深度/数量/大小/Binary 限制
- [x] SensitiveFileDetector：只记录"存在"，绝不读取内容
- [x] ProjectScanner：识别 TS/JS/Node/React/Vite/Next + package.json/tsconfig/vite/next/README/SPEC/docs/src/tests/e2e 配置
- [x] 输出标准化 ProjectMetadata + fileFingerprint
- [x] 单测：fixture 识别、ignore 生效、敏感文件不被读取

## Stage 3 — Git + Command Runner

- [x] CommandRunner：cwd / timeout / allowlist / stdout / stderr / exitCode / duration / cancel
- [x] 安全分级 read_only / validation / potentially_mutating / dangerous
- [x] 默认拒绝：rm / del / format / git reset --hard / git clean / rebase / force push / npm install 未知包
- [x] GitAnalyzer：isRepository / branch / commit / clean / modified / added / deleted / untracked / diffSummary / recentCommits
- [x] 非 git 目录、git 未安装 → 明确状态而非崩溃
- [x] 单测：真实临时 git 仓库上验证

## Stage 4 — Build + Test Analyzer

- [x] BuildCommandDetector：从 package.json scripts + 框架推断 build/test/lint/typecheck/e2e
- [x] BuildAnalyzer：pass/fail/timeout/unknown + 耗时 + 摘要
- [x] TestParser：vitest / jest / playwright 输出解析
- [x] TestAnalyzer：Total/Passed/Failed/Skipped/Duration + 失败用例(名称/文件/错误摘要)
- [x] Test History：不覆盖，保留趋势
- [x] Unsupported 明确返回，不伪造
- [x] 集成测试：fixture-build-failure / fixture-test-failure 真实运行

## Stage 5 — Snapshot + Regression

- [x] ProjectSnapshot：git + build + unit + integration + e2e + task/risk 摘要 + stage + health + progress + fileFingerprint
- [x] 不复制源码，仅指纹 + 证据引用
- [x] RegressionDetector：build PASS→FAIL、tests PASS→FAIL、passed 下降、总量异常下降、critical risk 增加、关键文件删除、acceptance 失效
- [x] 输出 RegressionType / Severity / Before / After / Evidence / SuggestedAction
- [x] 单测：构造两段快照序列断言

## Stage 6 — Specification / Task / Stage / Acceptance

- [x] SpecificationManager：识别 SPEC.md/PRD.md/README.md/requirements.md/docs/*.md（按内容而非仅文件名）
- [x] 解析 Goals / Requirements / Acceptance Criteria / Out of Scope / Constraints / checkbox
- [x] TaskLedger：spec / markdown checkbox / TODO / FIXME / agent log / manual / AI 六类来源 + confidence + evidence
- [x] StageManager：从 spec/task 推断阶段，无法确认 → unknown
- [x] AcceptanceGate：PASS/FAIL/BLOCKED/UNKNOWN + 原因解释
- [x] 单测：acceptance gate 各状态、task 提取

## Stage 7 — Health / Risk / Progress / Drift

- [x] ProjectHealthEngine：healthy/warning/critical/unknown + 透明理由列表（可点 Why?）
- [x] RiskEngine：16 类规则（build fail / tests fail / e2e regression / dirty files / 关键文件删除 / SPEC drift / 测试被删 / mock 泄漏 / TODO 激增 / 超大文件 / 长期 blocked / acceptance 不满足 / 未知脚本 / 敏感文件）
- [x] ProgressEngine：仅来自 stage + task + acceptance；信息不足 → unknown（禁止 LLM 编百分比）
- [x] DriftDetector：输出 "Possible Drift" + evidence，不断言
- [x] 单测：每条规则至少一个正向/反向用例

## Stage 8 — Project Memory + ADR

- [x] ProjectMemory 版本化（新版本不覆盖历史）
- [x] 内容：purpose / architecture / business rules / current stage / constraints / known issues / recent changes / decisions
- [x] ADR：title / status / context / decision / consequences + proposed→accepted→superseded
- [x] 单测：memory 版本递增

## Stage 9 — AI Provider + Structured Output

- [x] AIProvider 接口（name / available / completeStructured(schema, prompt, ctx)）
- [x] MockAIProvider：确定性规则生成，离线可用
- [x] OpenAICompatibleProvider：baseUrl + apiKey + model，超时/错误处理
- [x] 结构化输出：Zod-like 校验 + 重试 + fallback 到 Mock
- [x] Secret 不进前端、不进日志
- [x] 单测：非法 JSON / 缺字段 / 类型错误 → retry → fallback

## Stage 10 — Next Action + Prompt Generator + Handoff

- [x] NextActionEngine：Objective/Reason/Scope/RelevantFiles/Constraints/Acceptance/VerificationCommands/Risks/Priority
- [x] 决策顺序：失败 E2E → 失败单测 → Build 失败 → blocked task → acceptance 缺口 → 下一 stage task
- [x] PromptGenerator：生成可直接交给 Coding Agent 的完整 Prompt（10 个必备段落）
- [x] HandoffPackage：跨 Agent 交接包（含 context/architecture/stage/issues/tests/next action）
- [x] 单测：优先级顺序、prompt 必含段落

## Stage 11 — Dashboard + Project Detail

- [x] Dashboard：统计卡（total/healthy/warning/critical/blocked）+ 项目卡片（真实数据）
- [x] Attention Center：critical / blocked / build fail / test fail / regression / dirty / review
- [x] Project Detail 14 tabs：Overview / Stages / Tasks / Tests / Build / Git / Changes / Prompts / Sessions / Risks(+Issues) / Memory / Decisions / Timeline / Settings
- [x] Linear 风格浅色 UI，高信息密度，无廉价渐变
- [x] 完整状态处理：loading / empty / success / error
- [x] 键盘可达 + 语义化 HTML + focus 可见

## Stage 12 — Agent Session + Handoff

- [x] AgentAdapter 接口：getSessionInfo / getTranscript / getStatus / getChangedFiles / getExecutionResult
- [x] ManualImportAdapter（真实可用：导入 transcript 文本）
- [x] MockAgentAdapter（明确标记 mock，不伪造真实会话）
- [x] Prompt → Execution → Evidence → Acceptance 关系链
- [x] 单测：adapter 契约测试

## Stage 13 — Watcher + Queue

- [x] WorkspaceWatcher：debounce + 忽略 node_modules/.git/generated + 频率限制
- [x] 变化仅产生 WorkspaceChanged 事件，不直接调 LLM
- [x] AnalysisQueue：quick_scan/full_scan/git/build/test/risk/ai_analysis，含并发上限/超时/重试/取消
- [x] 单测：并发上限、取消、重试

## Stage 14 — Integration + E2E

- [x] 3 个 fixture 项目（healthy / test-failure / build-failure）真实生成并分析
- [x] 集成测试：扫描 → git → build → test → snapshot → regression → health → next action 全链路
- [x] E2E：真实 Chromium 16 步主路径（Dashboard → Attention → Detail → Tests → Risks → Issues 建单 → Next Action → Tasks → Decisions+Memory → 会话导入 → Prompt → Handoff → Search → Settings → 键盘 → 零控制台错误）
- [x] E2E 截图存档

## Stage 15 — Security + Recovery Audit

- [x] 敏感文件不读取（测试断言：内容从未出现在 DB / 日志 / AI 请求）
- [x] CommandRunner 危险命令全部拒绝（测试断言 exitCode=blocked）
- [x] 被管理 Workspace 只读保证（无写操作路径；测试断言文件 mtime 不变）
- [x] API 层校验、错误不泄漏堆栈到前端
- [x] Recovery Drill 演练并据结果修订文档

## Stage 16 — Final Polish + Documentation

- [x] README（12 节，无营销废话）
- [x] Self Review（6 个身份）并直接修复发现的问题
- [x] 最终 `npm run verify` 全绿
- [x] 最终交付报告

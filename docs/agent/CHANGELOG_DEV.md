# CHANGELOG_DEV.md — 开发里程碑

> 只记录 Stage / 重要功能 / 架构变更 / Bug 修复 / 回归修复。不记录每行代码。

## 2026-09-23 ~ 09-24

| Stage | 事件 |
| --- | --- |
| 0 | Bootstrap：目录、package.json、.gitignore、docs/agent 9 文件、零依赖技术选型（ADR-001） |
| 0 | 环境探针：确认 managed Node 22.22.2 自带 `node:sqlite`；git 2.55 可用；Python Playwright + Chromium 可用（供 E2E） |
| 1 | Domain 层：枚举常量 + 零依赖 Schema 校验器（Zod-like） |
| 1 | DB 层：26 张表 SQL Schema + 版本化 Migration Engine + 参数化 Repository |
| 2 | IgnoreEngine（默认 + .gitignore + 用户自定义 + 4 项硬限制） |
| 2 | SensitiveFileDetector（只记录存在性，内容隔离，ADR-004） |
| 2 | ProjectScanner（TS/JS/Node/React/Vite/Next 识别 + fileFingerprint） |
| 2 | Workspace Registry（add/rename/rescan/pause/archive/delete-record，不删源码，ADR-009） |
| 3 | CommandRunner（allowlist + 危险黑名单 + 超时 + 审计，ADR-003） |
| 3 | GitAnalyzer（branch/commit/dirty/diff/recent commits；非 git 与无 git 均优雅降级） |
| 4 | BuildCommandDetector + BuildAnalyzer（pass/fail/timeout/unknown） |
| 4 | TestParser（vitest / jest / playwright）+ TestAnalyzer + Test History（不覆盖） |
| 5 | ProjectSnapshot（指纹化，不复制源码，ADR-007） |
| 5 | RegressionDetector（7 类回归检测） |
| 6 | SpecificationManager（按内容识别，非仅文件名） |
| 6 | TaskLedger（6 类来源 + confidence + evidence） |
| 6 | StageManager + AcceptanceGate（PASS/FAIL/BLOCKED/UNKNOWN + 原因解释） |
| 7 | HealthEngine（透明理由列表，支持 Why?） |
| 7 | RiskEngine（14 条规则） |
| 7 | ProgressEngine（禁止 LLM 生成百分比，ADR-006） |
| 7 | DriftDetector（输出 Possible Drift，不断言） |
| 8 | ProjectMemory 版本化 + ADR 模块 |
| 9 | AIProvider 抽象 + MockAIProvider + OpenAICompatibleProvider |
| 9 | 结构化输出：Schema 校验 + 重试 + Mock 回退（ADR-008） |
| 10 | NextActionEngine（9 级优先级决策链） |
| 10 | PromptGenerator（10 个必备段落）+ HandoffPackage |
| 11 | Dashboard + Attention Center + Project Detail（13 tabs） |
| 11 | Linear 风格浅色 UI，完整 loading/empty/error 状态 |
| 12 | AgentAdapter 接口 + ManualImportAdapter + MockAgentAdapter |
| 13 | WorkspaceWatcher（debounce + 限流，不直接调 LLM，ADR-010） |
| 13 | AnalysisQueue（并发上限 / 超时 / 重试 / 取消） |
| 14 | 3 个 fixture 项目 + 全链路集成测试 |
| 14 | 真实 Chromium E2E 主路径 |
| 15 | 安全审计（敏感文件 / 命令 / 只读 / AI 边界）+ Recovery Drill |
| 16 | README + Self Review 修复 + 最终交付报告 |

## Checkpoints

- `chore: bootstrap agent memory` — Stage 0
- `feat(db): domain model + migrations` — Stage 1
- `feat(scanner): workspace registry + scanner + ignore engine` — Stage 2
- `feat(git): safe git analyzer + command runner` — Stage 3
- `feat(analysis): build + test analyzers` — Stage 4
- `feat(snapshot): snapshots + regression detector` — Stage 5
- `feat(ledger): spec + task + stage + acceptance gate` — Stage 6
- `feat(health): health + risk + progress + drift` — Stage 7
- `feat(memory): versioned project memory + adr` — Stage 8
- `feat(ai): provider abstraction + structured output` — Stage 9
- `feat(next-action): next action + prompt generator` — Stage 10
- `feat(ui): dashboard + project detail` — Stage 11
- `feat(agents): agent session + handoff` — Stage 12
- `feat(queue): watcher + analysis queue` — Stage 13
- `test(e2e): full main path` — Stage 14
- `checkpoint(verified): security audit + recovery drill` — Stage 15

## 交付阶段补充（Stage 14-16 执行中修复的真实缺陷）

| 类别 | 问题 | 修复 |
| --- | --- | --- |
| Bug | `spawnSync` 在本机沙箱返回 EBUSY | typecheck/build 全部改用异步 spawn（tools/syntax.js） |
| Bug | Node ≥18.20 在 Windows 禁止无 shell 执行 `.cmd` | CommandRunner 增加 `resolveInvocation`：npm/pnpm/yarn 经其 JS 入口以 `shell:false` 执行 |
| Bug | glob 匹配器对无斜杠目录名（node_modules/dist）不匹配其子路径 | createMatcher 增加路径分段匹配 |
| Bug | `BULLET_RE` 的复选框前缀是捕获组，导致所有 bullet 内容被丢弃 | 改为非捕获组，goals/requirements/constraints 恢复 |
| Bug | 阶段标题正则把 "Stages" 误判为名为 "s" 的阶段 | `parseStageTitle` 要求编号或分隔符 |
| Bug | playwright 汇总只统计首个匹配行（22 passed 之后的 3 failed 丢失） | 严格匹配独立汇总行并累计 |
| Bug | vitest 失败解析把文件级汇总行当作失败用例 | 跳过 `(N tests` 汇总行 |
| Bug | `SchemaMismatchError` 对字符串 details 调用 .join 崩溃 | 兼容 string/array |
| Bug | `SearchService` LIKE 回退对 projects 表引用不存在的 project_id / title 列 | 按表定义列清单 |
| Bug | `nextActionToText` 对缺失字段崩溃（handoff 500） | 全字段防御 |
| Bug | handoff 缺少 Architecture 段（无记忆时） | 始终输出完整 11 段 |
| Bug | AnalysisQueue 的 `Promise.race` 超时定时器未取消，事件循环滞留 10 分钟 | `sleepCancellable` + finally cancel |
| Bug | `ProjectMemory.render` 对部分字段缺失崩溃 | 防御式取值 |
| Bug | Demo healthy 项目因 sensitive/lockfile 风险被降级为 warning | 该两类风险改为 hygiene 信号，不降级健康 |
| 架构 | 产品代码 import 测试目录（fixture 工厂） | 迁移至 `src/demo/fixture-factory.js`，lint 白名单收敛 |
| 增强 | 全量扫描后无 NextAction（需手动生成） | 编排器自动计算确定性 NextAction（无需 API Key） |
| 迁移 | regressions 表缺 fingerprint 列 | Migration v3（增量 ALTER，不删库） |

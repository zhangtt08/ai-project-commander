# NEXT_ACTION.md — 断联恢复后第一件事

> 新 Agent 进入项目，读到这里就应该知道"现在立刻做什么"。

## Last Completed

全部 16 个 Stage。**MVP 已交付**：P0 全模块实现，`npm run verify` 5/5 通过
（typecheck / lint / build / unit 133 / integration 40），`npm run test:e2e` 12/12 步通过
（真实 Chromium）。详见 `docs/agent/TEST_STATUS.md`。

## Current Task

无。当前没有进行中的任务，也没有未完成的 P0 工作单元。

## If You Are A Fresh Agent — Do Exactly This

```bash
cd "C:\Users\Administrator\Desktop\AI-Project-Commander"
node --version            # 需 >= 22.5.0（使用内置 node:sqlite）
npm install               # 零依赖，瞬时完成
npm run verify            # typecheck + lint + build + unit(133) + integration(40)，约 70s
npm run dev               # 启动 http://127.0.0.1:8787（首启自动播种并分析 3 个 Demo 项目）
```

然后：

1. 打开 `http://127.0.0.1:8787`：Dashboard 应显示 3 个 Demo 项目
   （ShopFlow Web=healthy / FitPlan Tracker=warning / Legacy Billing=critical）。
2. `npm run test:e2e` 重跑真实 Chromium E2E（约 2.5 分钟，12 步）。
3. 若要继续开发，从下方 "Next Task After Completion" 的 P2 列表挑一项。

## Relevant Files

| 关注点 | 文件 |
| --- | --- |
| 领域模型 / 校验 | `src/domain/constants.js`, `src/domain/schema.js`, `src/domain/ai-schemas.js` |
| 数据库 / 迁移 | `src/db/migrations.js`, `src/db/database.js`, `src/db/repositories.js` |
| 扫描 / 忽略 / 敏感文件 | `src/core/scanner.js`, `src/core/ignore-engine.js`, `src/core/sensitive.js`, `src/core/fs-safe.js` |
| 命令执行（唯一出口） | `src/core/command-runner.js` |
| 分析器 | `src/core/analyzers/`（build / test / change） |
| 引擎 | `src/core/engines/`（spec / task / stage / gate / health / risk / regression / drift / memory / next-action / prompt / handoff） |
| 全链路编排 | `src/core/orchestrator.js` |
| AI 层 | `src/core/ai/`（provider / mock / openai / structured / service） |
| HTTP API | `src/server/http-server.js`, `src/server/routes.js`, `src/server/cli.js` |
| 前端 | `src/web/**`（app.js + views/*） |
| 演示数据工厂 | `src/demo/fixture-factory.js` |

## Commands To Run

```bash
npm run verify          # 一次跑完 typecheck/lint/build/unit/integration
npm run test:unit       # 仅单元（~9s）
npm run test:integration
npm run test:e2e        # 真实 Chromium（~2.5min）
npm run seed:demo       # 重建 3 个 Demo 项目（真实构建+测试）
```

## Expected Result

- `verify` 退出码 0，5/5
- Dashboard 三个 Demo：healthy / warning / critical 各一
- Project Detail 的 Gate 卡片给出可读原因（如 "Foundations cannot advance. 1 blocking check(s): E2E tests PASS → 3 of 25 e2e tests failed"）

## Known Risks

- 本机 npm registry 网络极慢，因此项目**零运行时依赖**（ADR-001）。引入 React/Vite 前先解决网络。
- Node 22 下 `node:sqlite` 会输出 ExperimentalWarning，属预期。
- E2E 依赖 managed Python 的 Playwright Chromium；若缓存被清，`run-e2e.js` 会明确报错。

## Do Not Break

1. 被管理的 Workspace **只读**——不得新增任何写入被管理项目文件的代码路径（ADR-009，有测试守护）。
2. 敏感文件内容绝不落库/落日志/进 AI 请求（ADR-004，有测试守护）。
3. 所有外部命令必须走 `CommandRunner`（ADR-003，lint 守护）。
4. 迁移只增不改（已有 v1/v2/v3）。
5. AI 输出必须过 Schema 校验；Mock 结果必须带 mock 标签（ADR-008）。

## Next Task After Completion

P2 列表（推荐顺序）：

1. 真实 Codex / Claude Code / Cursor transcript adapter（接口已冻结：`src/core/agent-sessions.js`）
2. Python / Go / Rust 生态 scanner 检测器（扩展点：`src/core/scanner.js` 的 `LANGUAGE_DETECTORS`）
3. 跨项目依赖图与影响分析
4. AST 级语义分析（更深层的 drift 检测）
5. 多用户 / 远程 Commander 服务

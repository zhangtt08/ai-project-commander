# NEXT_ACTION.md — 断联恢复后第一件事

> 新 Agent 进入项目，读到这里就应该知道"现在立刻做什么"。

## Last Completed

2026-09-26 复核：修复了搬入本机后 4 个测试文件被 **libuv C 层 abort** 杀死的根因
（`fs.watch` 监控 Windows 8.3 短名路径会整进程崩溃），并修掉 3 个真实的"无证据断言"缺陷
（e2e 0/0 failing、零用例判 PASS、git-unavailable 被降级）与 1 个项目页每 3 秒自我重载的缺陷。
前端 13 个标签页已整体本地化。当前：unit 142/142 + integration 40/40 + verify 5/5。

## Current Task

1. **E2E 未验证**：界面文案已中文化、`e2e/e2e_test.py` 的 23 处断言已同步，但本机没有
   Playwright Chromium，一次都没跑过。先 `python -m playwright install chromium` 再
   `node scripts/run-e2e.js`，按失败步骤逐条核对（不要改断言去迁就实现，除非确认界面措辞有误）。
2. **WATCH-001 已撤销**：两组受控实验（6/6 与 1→2→3→4）证明投递正常，原结论是探测脚本缺陷。
3. 可选：`HEAD` 请求一律 404（http-server 只认 GET），若要接探活脚本需补 HEAD 分支。

## If You Are A Fresh Agent — Do Exactly This

```bash
cd "C:\Users\Administrator\Desktop\AI-Project-Commander"
node --version            # 需 >= 22.5.0（使用内置 node:sqlite）；本机 v24.18.0
npm run verify            # typecheck + lint + build + unit(142) + integration(40)
npm run dev               # 启动 http://127.0.0.1:8787
```

然后：

1. 打开 `http://127.0.0.1:8787`，逐标签点一遍项目详情页（中文文案与数字是否符合预期）。
2. 若要跑 E2E，先装 Chromium（见上）；未装时 `npm run test:e2e` 必然失败，这不是回归。
3. 若要继续开发，从 KNOWN_ISSUES.md 的 WATCH-001 或 P2 列表挑一项。

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

1. 分析流水线（扫描 / 构建 / 测试 / 回归）对被管理的 Workspace **只读**——不得新增任何在
   扫描路径上写入被管理项目文件的代码（ADR-009，有测试守护）。
   例外只有两条、且必须由用户明确动作触发：`src/core/source-purge.js`（删除源目录，
   需回显确认口令）和 `src/core/github-publisher.js`（写 `.git` 并推送）。详见
   KNOWN_ISSUES.md DEBT-010；不要"顺手"把它们的 lint 豁免改回去。
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

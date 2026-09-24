# TEST_STATUS.md — 真实测试状态记录

> 规则：只记录**真实执行过**的命令与结果。禁止写 "Tests OK"。
> 环境：Windows 11 (Administrator) · Node v22.22.2 (managed) · git 2.55.0 · Chromium via Python Playwright

## Sequence 0 — 环境探针（Stage 0）

| Field | Value |
| --- | --- |
| Command | `node -e "require('node:sqlite')"` (Node 22.22.2 managed) |
| Result | PASS — `DatabaseSync, StatementSync, constants, backup` 可用，FTS5 探测通过 |
| Timestamp | 2026-09-23 Stage 0 |

## Sequence 1 — 最终全量验证（`npm run verify`，Stage 16 交付时）

命令：`node scripts/verify.js` → **exit 0，5/5 通过**

| Check | Command | Result | Duration | Evidence |
| --- | --- | --- | --- | --- |
| Typecheck | `node tools/typecheck.js` | PASS | 4.5s | 78 files parsed；全部相对 import 可解析且命名导出存在 |
| Lint | `node tools/lint.js` | PASS | 0.2s | 61 source files；0 policy violations（架构规则：child_process 白名单、fs 写入白名单、domain 纯净、禁 eval/any） |
| Build | `node src/server/cli.js build` | PASS | 4.5s | 所有模块 `node --check` 通过；10 个 web 资产存在；9 个 agent memory 文件存在 |
| Unit tests | `node scripts/run-tests.js --unit` | **PASS 133/133** | 8.7s | 36 suites，0 failed |
| Integration tests | `node scripts/run-tests.js --integration` | **PASS 40/40** | 55.6s | 真实 fixture 生成 → 真实 git → 真实 build/test 子进程 |

## Sequence 2 — E2E（`npm run test:e2e`，真实 Chromium）

命令：`node scripts/run-e2e.js` → **exit 0，12/12 steps passed**

| Step | Result |
| --- | --- |
| open the dashboard and see three demo projects | PASS |
| attention center lists the failing project first | PASS |
| project detail overview shows gate, health and next action | PASS |
| tests tab shows 22/25 e2e with failing cases | PASS |
| risks tab lists deterministic risks with evidence | PASS |
| next action is rendered with priority and verification commands | PASS |
| prompt generation produces all ten sections | PASS |
| handoff package opens with all sections | PASS |
| search finds indexed content | PASS |
| settings screen renders provider and security info | PASS |
| keyboard navigation works | PASS |
| no console/page errors | PASS |

截图存档：`.e2e-artifacts/`（final-dashboard.png、prompt-modal.png、handoff.png）

## 关键断言摘录（来自真实测试运行）

- fixture-warning：`unit 2/2 PASS`、`e2e 22/25 FAIL`（3 个失败用例名称与错误摘要被捕获）
- fixture-critical：`build FAIL (exit 1)`、`unit 3/5 FAIL (jest)`、health=critical
- 回归注入后：`build_pass_to_fail` + `critical_risk_increased` 被检测，snapshot seq 1→2（append-only）
- 重复扫描 3 次后：task fingerprint 无重复、stage 无重复
- 安全测试：全库 dump / 日志 / AI 请求中均未出现 `sk_live_…`、`ghp_…`、`postgres://user:pass…`
- 只读保证：全量扫描前后 fixture 全部文件 mtime 逐一相同
- 命令拦截：`git reset --hard` / `git clean -fd` / `rm -rf` / `npm install x` 全部 blocked（exit 127，未产生子进程）
- Windows 适配：npm 经 `npm-cli.js` 以 `shell:false` 执行（shimmed），规避 Node ≥18.20 的 `.cmd` EINVAL

## Git State（交付时）

- 仓库：`C:\Users\Administrator\Desktop\AI-Project-Commander`（本地初始化，无远端）
- 交付前执行 checkpoint commits（见 CHANGELOG_DEV.md）；`git status --short` 交付时应为空

## 已知测试限制

- E2E 依赖本机 Chromium（由 managed Python Playwright 提供）；若缓存被清，`run-e2e.js` 会以明确错误退出
- integration 单次约 55s（真实构建/测试子进程），E2E 约 2.5min（含 demo 播种）
- `node --test <dir>` 在部分 Node 版本不可靠，因此统一使用 `scripts/run-tests.js` 显式文件清单

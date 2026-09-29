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
| issues can be filed manually and listed next to computed risks | PASS |
| tasks can be created and moved through the ledger | PASS |
| decisions and project memory versioning work | PASS |
| agent transcript import closes the prompt loop | PASS |
| no console/page errors | PASS |

截图存档：`.e2e-artifacts/`（final-dashboard.png、prompt-modal.png、handoff.png、FAIL-*.png 仅在失败时生成）

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

## Sequence 9 — 2026-09-26 复核（搬入本机后首次真实执行）

环境：**Node v24.18.0**（非 Sequence 1 记录的 v22.22.2）· Windows 11 10.0.26200 · 本机**未安装** Playwright Chromium。

### 发现的问题（真实执行证据）

`node scripts/run-tests.js --all` 实测 **143 tests / 139 pass / 4 fail**，与本文 Sequence 1 声称的
"unit 133 + integration 40 全通过" 不符。4 个失败项不是断言失败，而是**整个测试文件被 C 层 abort 杀死**：

```
Assertion failed: !_wcsnicmp(filename, dir, dirlen), file src\win\fs-event.c, line 72
```

影响文件：`tests/integration/{api,pipeline,security}.test.js`、`tests/unit/ai-jobs.test.js`。

### 根因（对照实验，非推断）

`src/core/jobs.js` 的 `WorkspaceWatcher.watch()` 对被监控目录调用 `fs.watch(dir, {recursive:true})`。
Windows 下 libuv 断言"通知文件名不以被监控目录开头"，而**当被监控路径以 8.3 短名形式给出**
（如 `C:\Users\ADMINI~1\...`，本机 `os.tmpdir()` 即此形式）时，系统回报的是长名，断言失败 →
**整个 Node 进程 abort，无法被 try/catch 捕获**。实测矩阵：

| 被监控路径 | 首个文件事件后 |
| --- | --- |
| 短名 `C:\Users\ADMINI~1\...\Temp\*`（recursive） | abort |
| 短名（非 recursive） | abort |
| 长名 `C:\Users\Administrator\...\Temp\*` | 正常收到 rename/change |
| 长名（项目内目录） | 正常 |

`fs.realpathSync` **不会**展开短名；`fs.realpathSync.native` 会。

### 修复

`src/core/fs-safe.js` 新增 `expandShortPath()`（仅 win32、仅含 `~<digit>` 时调用 native realpath、
失败即原样返回），在 `app.addProject()` 注册时与 `WorkspaceWatcher.watch()` 内两处接入（后者用于
兜底已入库的短名路径）。

### 修复后真实结果

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `node tools/typecheck.js` | PASS（81 files parsed，import 与命名导出全部可解析） |
| Lint | `node tools/lint.js` | PASS（0 violations，1 warning：fixture-factory 含 4 个 TODO 标记，属演示数据） |
| Build | `node src/server/cli.js build` | PASS |
| Unit | `node scripts/run-tests.js --unit` | **PASS 142/142** |
| Integration | `node scripts/run-tests.js --integration` | **PASS 40/40** |
| verify | `node scripts/verify.js` | **exit 0，5/5** |
| E2E | `node scripts/run-e2e.js` | **未执行** —— 本机无 Chromium，`BrowserType.launch` 报 Executable doesn't exist |

端到端验证（真实服务器 + 真实 watcher）：用短名路径注册项目 → 入库路径已展开为长名 →
连续写入/建目录 → **进程存活**且 `workspace_changed` 事件被记录。

### 本次同批修复的其它真实缺陷

- `attentionCenter()` 把 `status:'error'`（命令跑挂且无法解析）报成 "e2e 0/0 failing"，
  属无证据断言；已拆为 `test_error`，措辞为"执行异常，未能解析出用例结果"，降为 medium。
- `test-analyzer` 在 `exitCode===0 && failed===0` 时无条件判 PASS，导致零用例的运行
  在验收门里显示"0/0 通过"；已要求 `total > 0`。
- `orchestrator.js:300` 引用了不存在的字段 `metadata.isGitRepositoryHardware`（应为
  `isGitRepositoryHint`），使"git 不可用"状态被静默降级为 none。
- 项目页 `scheduleScanRefresh()` 在队列为空时也会 `Router.reload()`，而 reload 又再次调度它 →
  **项目页每 3 秒自我完整重载**（实测 13 秒内 8 轮 project+detail+jobs 请求），并会清空正在输入的表单。

## Sequence 10 — 2026-09-26 续（优化轮）

| 项 | 结果 | 证据 |
| --- | --- | --- |
| `npm run verify` | **5/5，exit 0** | typecheck 2.9s / lint 0.1s / build 3.2s / unit 3.1s / integration 39.7s |
| 测试临时目录泄漏（TEST-001） | **已修复** | 清空 `%TEMP%` 后跑 `run-tests --all` → 182/182 通过、残留 `apc-*` **0 个**（修复前每轮约 18 个） |
| WATCH-001「投递不稳定」| **撤销该结论** | 实验 A：同实例 6 轮注册-写入 → 6/6 收到事件；实验 B：删除他项后存活 watcher 计数 1→2→3→4。原 3 轮 0 事件系探测脚本自身问题 |
| 安全模型模式列表 | **改为取自真实规则** | 原先界面手写副本仅 ~20 条，服务端 `SENSITIVE_PATTERNS` 实为 28 条（漏 `.p12/.pfx/id_dsa/id_ecdsa/.ssh/**/*secret*.json/gcloud/keyfile.json`），等于少报保护范围；现 API 返回 `{pattern, rule}[]`，浏览器实测渲染 28 条 |
| 服务端英文泄漏 | 已清 | `progress.reason`（原 `not computed yet` 直接显示成"进度未知——not computed yet"）、`securityModel()` 四段说明、settings 半截句 `正在监控 N 个工作区。 Debounce…`、被脚本改坏的示例路径 `C:////Users////you////Desktop//nD:////dev` |
| e2e | **仍未执行** | 本机无 Chromium；本轮新增 2 处断言改动（安全页），`python -m py_compile` 通过 |

方法约束：本轮所有批量文案改动均为**完整字面量精确匹配**，配套三道校验——
(1) 剥掉字符串后的代码骨架逐字节一致；(2) 全局 grep 确认比较位不出现中文字面量；(3) 真实浏览器逐标签读渲染文本。
未使用任何词级正则替换。

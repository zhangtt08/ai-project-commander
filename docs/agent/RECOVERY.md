# RECOVERY.md — Session 中断恢复协议

> 本文件给"完全失忆"的下一任 Agent 看。

## 0. 铁律

1. **不要询问用户"项目做到哪了"。** 磁盘上有权威状态。
2. **不要重新初始化项目。** 目录已存在且可用。
3. **不要重新设计整个系统。** 架构决策见 `DECISIONS.md`，已论证过，不要推翻。
4. **不要 `git reset --hard` / `git clean -fd` / force push。**

## 1. 恢复步骤（严格按序）

### Step 1 — 读取状态（只读，不改代码）

按顺序读：

1. `docs/agent/PROJECT_STATE.md` ← 现状总览
2. `docs/agent/NEXT_ACTION.md` ← **立刻要做什么**
3. `docs/agent/TEST_STATUS.md` ← 上次测试的真实结果
4. `docs/agent/KNOWN_ISSUES.md` ← 哪些还没做完
5. `docs/agent/MASTER_PLAN.md` ← 任务树，找第一个 `[~]` 或 `[ ]`
6. `docs/agent/DECISIONS.md`（需要改架构时读）
7. `docs/agent/ARCHITECTURE.md`（需要动结构时读）

### Step 2 — 检查工作区

```bash
cd "C:\Users\Administrator\Desktop\AI-Project-Commander"
git status --short
git log --oneline -5
```

- 有未提交改动 → 说明上次中断在实现中途。**先读懂 diff 再动手**，不要直接丢弃。
- 工作区干净 → 从 `NEXT_ACTION.md` 的 "Current Task" 继续。

### Step 3 — 最低成本验证（不要一上来就跑全量）

```bash
node --version                 # 必须 >= 22.5.0
npm run test:unit              # 最快，确认核心没坏
```

单元测试通过 → 再跑 `npm run test:integration`。
仍通过 → 需要时再跑 `npm run test:e2e`（最慢，需要 Chromium）。
失败 → 先修失败，**不要继续加新功能**。

### Step 4 — 从 NEXT_ACTION.md 继续

按该文件 "Current Task" + "Commands To Run" + "Expected Result" 执行。
一次只推进一个可验收工作单元（见 MASTER_PLAN 粒度）。

### Step 5 — Checkpoint

每完成一个工作单元：

```bash
npm run verify                                     # typecheck+lint+build+unit+integration
git add -A && git commit -m "feat(<scope>): <what>"
```

然后**立即**更新这四个文件（缺一不可）：

- `MASTER_PLAN.md`（把 `[~]` 改 `[x]`）
- `PROJECT_STATE.md`（Current Module / Next Action / Last Updated）
- `NEXT_ACTION.md`（Last Completed / Current Task / Next Task After Completion）
- `TEST_STATUS.md`（真实命令 + 真实结果 + 时间戳）

若发现新问题，追加到 `KNOWN_ISSUES.md`。若做了重要架构选择，追加到 `DECISIONS.md`。
里程碑写入 `CHANGELOG_DEV.md`。

### Step 6 — 自动进入下一任务

不要停下来问用户"要不要继续"。直接取 MASTER_PLAN 中的下一个 `[ ]`。
只有当遇到**真正的外部阻塞**（需要用户 API Key、需要不存在的第三方账号、需要访问环境里完全没有的系统）才停，
并且要先把其余系统用 Mock / Adapter 完成。

## 2. 紧急 Token 协议（上下文快满时）

检测到剩余上下文不足时，**禁止把剩余功能写成 TODO**。立即：

1. 停止开启新的大模块。
2. 把当前模块收尾到"可运行"状态（哪怕是缩减实现，也要真实可用）。
3. 跑一次 `npm run test:unit`，确保不是红的。
4. 更新 `PROJECT_STATE.md` / `MASTER_PLAN.md` / `NEXT_ACTION.md` / `TEST_STATUS.md` / `KNOWN_ISSUES.md`。
5. `git commit` 一个 checkpoint。
6. 确认下一个 Agent 读 `NEXT_ACTION.md` 就能无缝接着干。

## 3. 常见故障速查

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| `ExperimentalWarning: SQLite` | Node 22 的 `node:sqlite` 是实验 API | 正常，忽略 |
| `Cannot find module 'node:sqlite'` | Node < 22.5 | 升级 Node，或改用系统 Node 24 |
| E2E 报找不到 Chromium | 本机 playwright 浏览器缓存被清 | 改用 managed Python 的 playwright（已预装 Chromium） |
| 端口 8787 被占用 | 本机其他应用占用了默认端口 | 无需处理：dev 会自动从 8787 起向上找空闲端口（最多 +20），以启动横幅里打印的 URL 为准 |
| `data/commander.db` 损坏 | 异常中断写入 | 直接删除 `data/`，重启会自动迁移 + 重新 seed Demo，不丢源码 |
| 扫描很慢 | 扫到大仓库 | Settings 里降低 `maxFiles` / 提高 ignore 规则 |

## 4. 绝对不要做的事

- 不要读取被管理项目里的 `.env` / `*.key` / `*.pem`（ADR-004）。
- 不要在业务代码里直接 `child_process`（ADR-003）。
- 不要写入被管理的 Workspace 目录（ADR-009）。
- 不要删除测试来让测试通过。
- 不要用 `any` / `@ts-ignore` 等价物绕过校验。
- 不要把本应属于 MVP 的缺失功能伪装成 Roadmap。

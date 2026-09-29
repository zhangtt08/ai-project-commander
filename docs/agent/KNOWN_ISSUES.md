# KNOWN_ISSUES.md — 已知问题 / 技术债 / 限制

> 规则：任何 Bug、临时绕过、第三方限制、Mock、不完整实现都必须记录在此。
> 禁止通过"隐藏问题"假装项目完成。

## 分类

- **BUG** — 真实缺陷
- **DEBT** — 技术债
- **LIMIT** — 环境/第三方限制
- **MOCK** — 明确使用 mock 的部分
- **TODO-P2** — 属于 P2 优先级，不在 MVP 验收范围内

---

### LIMIT-001 · 无构建步骤的前端

- **类型**: LIMIT
- **描述**: 前端为原生 ES Module，无 JSX/TS 编译期检查。
- **原因**: 本机 npm registry 网络不可用（ADR-001）。
- **影响**: 组件复用靠函数封装而非 JSX；类型错误只能在运行时发现（已用 `tools/typecheck.js` 静态扫描 + 运行时 Schema 校验部分补偿）。
- **计划**: 网络可用后迁移到 React + Vite，复用现有 REST 契约。

### MOCK-001 · MockAIProvider

- **类型**: MOCK
- **描述**: 未配置 API Key 时，AI 总结/风险解释/NextAction/Prompt 由确定性规则生成。
- **边界**: 所有 mock 结果在 `provider` 字段标记 `mock`，前端显示 "Mock (deterministic)" 徽章，**不伪装成真实 LLM 输出**。
- **计划**: 配置 OpenAI-compatible endpoint 后自动切换。

### MOCK-002 · Agent Adapter 仅有 ManualImport + Mock

- **类型**: MOCK
- **描述**: Codex / Claude Code / Cursor 的**真实 transcript 目录格式**未在本环境验证（这些工具未安装，且其本地历史格式属未公开实现）。
- **实现**: `ManualImportAdapter`（真实可用：粘贴 transcript 文本并解析）与 `MockAgentAdapter`（明确标记 mock）。`AgentAdapter` 接口已冻结，未来新增真实 adapter 无需改动上层。
- **不伪造**: 本适配器**不会**伪称读取到了真实会话。

---

## 待办（P2，不影响 MVP 验收）

- TODO-P2-001 真实 Codex CLI transcript adapter
- TODO-P2-002 真实 Claude Code transcript adapter
- TODO-P2-003 跨项目依赖图与影响分析
- TODO-P2-004 Python / Go / Rust scanner 检测器（`LANGUAGE_DETECTORS` 已预留扩展点）
- TODO-P2-005 无（已交付：FTS5 全文检索 + LIKE 回退自动探测，见 src/core/search.js）
- TODO-P2-006 多用户 / 团队协作与远程 Commander 服务

## 2026-09-26 复核新增（搬入本机后）

### WATCH-001 · 短名路径导致 fs.watch 整进程 abort（已修复，附后续受控验证）

- 原怀疑：短名崩溃修复后，HTTP 探测 4 轮中仅 1 轮收到 `workspace_changed`，疑似长跑服务器投递不稳定。
- **该怀疑不成立**。后续两组受控实验（各起独立服务器 + 独立数据目录）：
  - 实验 A：同一长生命周期实例内连续 6 轮"短名注册 → 写文件 → 读时间线"，
    **6/6 全部投递**（累积 6 个活跃 watcher，无退化）。
  - 实验 B：注册两个项目，删除其一后再写另一，存活项目事件计数严格
    `1 → 2 → 3 → 4`（跨"删除他项 / 新增他项 / 再删除"四种扰动），**unwatch 不影响其他 watcher**。
- 结论：之前那 3 轮 0 事件是我探测脚本自身的问题（等待/时序与脚本写法），不是产品缺陷；
  已排除的方向：`fs.watch` 未启动、路径未展开、`WATCH_IGNORE`、限速窗口、handle 泄漏、互相干扰。
- 保留本条以避免重复追查；真正已修复的是 8.3 短名 abort（见 TEST_STATUS.md Sequence 9）。

### E2E-001 · 本机无法执行 E2E（环境缺失）

- `python -m playwright` 已安装，但 `ms-playwright` 浏览器缓存不存在 → `chromium.launch()` 直接失败。
- 界面文案已整体本地化，`e2e/e2e_test.py` 的 23 处断言已同步为中文，但**尚未经过一次真实运行验证**。
- 恢复方式：`python -m playwright install chromium` 后执行 `node scripts/run-e2e.js`。

### HTTP-001 · 服务只实现 GET，HEAD 一律 404（次要）

- `src/server/http-server.js:148` 的静态分支判断 `req.method === 'GET'`，
  因此 `HEAD /` 与 `HEAD /api/health` 返回 404 JSON。对浏览器使用无影响，但会坑到探活脚本。

### TEST-001 · 测试套件泄漏临时目录（已修复，实测验证）

- 现象：`%TEMP%` 下遗留 205 个 `apc-*` 目录（`apc-unit` 90 个、`apc-cmd` 50 个，其余为
  `apc-watch` / `apc-api` / `apc-sec` / `apc-nogit` / `apc-resolver`）。
- 根因：`tests/unit/security-scan.test.js:12` 与 `tests/unit/commands-git.test.js:13` 等的
  `tmp()` 每次调用 `fs.mkdtempSync`，而这些文件里 `rmSync` 出现次数为 0 —— 夹具目录从不回收。
- 影响：每次跑测试堆积数十个目录；长期会污染临时盘。
- 修复：新增 `tests/helpers/tmp.js`（`makeTempDir()` 登记目录 + `process.on('exit')` 统一清理），
  改接全部 10 处创建点（含 `apc-empty-${Date.now()}` 那处 mkdirSync）。
- 验证：清空 %TEMP% 后跑 `run-tests --all` → **182/182 通过、残留 apc-* 目录 0 个**（修复前每轮约 18 个）。

---

## 2026-09-29 新增能力带来的约束变更

### DEBT-010 · ADR-009「Workspace 只读」新增两个用户主动触发的例外

- **类型**: DEBT（约束变更，必须显式记录）
- **变更**: 需求「删除项目后直接把项目源文件清除」和「每加入一个项目自动创建并上传私有 GitHub 仓库」
  本质上要求写入/删除被管理目录，与 ADR-009 的字面表述冲突。**分析流水线（扫描/构建/测试/回归）
  仍然严格只读**，这一点没有放松；被放开的是两条只能由用户明确动作触发的路径：
  1. `src/core/source-purge.js` —— 删除源目录。`assessPurgeTarget()` 拒绝磁盘根目录、用户主目录、
     Desktop/Documents/Downloads、层级 < 2 的路径、Commander 自身数据目录；`purgeDirectory()`
     还要求回显目录名作为确认口令，口令错误时一个文件都不会删。
     由 `tests/unit/source-purge.test.js` 逐条守护（lint 豁免的理由就写在这条测试上）。
  2. `src/core/github-publisher.js` —— 写 `.git`、创建提交并推送。令牌只通过
     `GIT_CONFIG_KEY_0/VALUE_0` 环境变量传给 git，绝不进 argv、不进日志、不进数据库、
     也不写进项目的 `.git/config`。
- **影响**: `tools/lint.js` 的两处白名单被扩充；任何后续 Agent 若看到这两个文件 import
  `node:fs` / 调用 `rmSync`，那是有意为之，不要"顺手修掉"。
- **计划**: 若未来引入插件系统，需要把这两条例外收敛为受审计的能力授权。

### LIMIT-011 · 桌面版用 Edge app-mode 渲染，而不是 Electron

- **类型**: LIMIT
- **描述**: `desktop/AIProjectCommander.exe` 是用系统自带 `csc.exe` 编译的原生 WinForms 外壳
  （自带图标、自己的任务栏身份、托盘、负责拉起/收养 Node 服务），窗口内容用本机已安装的
  Edge `--app` 模式渲染。
- **原因**: 本机 npm registry 极慢，Electron/Tauri 都装不动（ADR-001）；WebView2 的托管包装
  程序集在本机不存在且无 NuGet 缓存，无法编译 WebView2 应用。
- **影响**: 不是打包好的单机 `.exe` + 安装包；换机器需要 Node 22+ 和 Edge。窗口渲染引擎
  与 Electron 相同（Chromium），功能无差异。
- **计划**: 网络恢复后评估 Electron；届时 `Commander.cs` 只保留"拉起服务"职责。

### MOCK-012 · GitHub 上传需要用户自备 PAT

- **类型**: MOCK/LIMIT
- **描述**: 本机没有 `gh` CLI，也没有 `GITHUB_TOKEN` 环境变量，因此自动上传依赖用户在
  设置页粘贴一个有 repo 权限的 Personal Access Token。未配置令牌时导入照常成功，
  只是 `github.stage = 'disabled'`，UI 会显示中文原因——不会假装已经上传。

### LIMIT-013 · GitHub 自动上传：已验证与未验证的边界

- **类型**: LIMIT（必须写清，避免被误读为"全部通过"）
- **已用真实 git + 真实 CommandRunner 验证**（`tests/integration/git-publish-real.test.js`，6/6）：
  allowlist 放行 `init/add/commit/push/remote`；在没有全局 user.name/user.email 的机器上
  也能提交（身份由 GitHub 账号推导：`<owner>@users.noreply.github.com`）；重复执行安全；
  `ensureOriginRemote` 只接受 github.com，拒绝任意远端（防止把代码推到别处）；
  `.git/config` 里不含任何凭据；真实 push 能把 commit 落到远端。
- **已用真实 api.github.com 验证**：401 路径返回中文可读原因且不泄露令牌；
  `gitAuthEnv` 产出 `http.extraheader = Basic base64(x-access-token:<token>)`。
- **已用 App 级集成测试验证**（`tests/integration/github-publish-app.test.js`，7/7，全离线）：
  设置开关与无令牌的诚实降级；owner 由令牌解析并缓存；创建请求体 `private: true`；
  提交身份由 GitHub 账号推导（本机没有全局 user.name 也能提交）；令牌不出现在 argv /
  返回值 / 项目记录中；`GIT_TERMINAL_PROMPT=0` 与 45s 超时；API 全断时不抛异常并把原因
  写进 `metadata.github`；导入不等待上传完成。
- **仍未验证**：GitHub 真正接受令牌、创建私有仓库并接收推送的服务端应答 —— 本机没有
  `gh` CLI 也没有 `GITHUB_TOKEN`，需要用户提供一个有 repo 权限的 PAT 才能跑通。
  未配置令牌时导入照常成功，`github.stage = 'disabled'` 并给出中文原因。

### BUG-014 · 已修复：导入被 GitHub 上传阻塞（最长 120 秒）

- **类型**: BUG（已修复）
- **症状**: `addProjectAndClassify()` 里 `await publishToGithub()`，而 publisher 默认
  `timeoutMs = 120000`。GitHub 慢或不可达时，导入一个项目最长卡 2 分钟；首启批量导入
  20 个项目会串行放大成不可接受。实测该测试用例耗时 168 秒。
- **修复**: 发布改为后台触发、不阻塞导入（结果照常写进 `project.metadata.github`，
  UI 读取）；并把发布链路的 `timeoutMs` 收敛到 45 秒。
- **验证**: 同一测试从 168s 降到 1.6s，并新增一条断言导入在 8s 内返回。

---

## 2026-09-29 修复：seed-demo 破坏 E2E 数据隔离（曾污染真实数据库）

- **类型**: BUG（已修复）
- **症状**: `scripts/run-e2e.js` 用 `COMMANDER_DATA_DIR=<tmpdir>` 调 `cli.js seed-demo`，
  但 `seedDemo()` 里是 `new App()`，完全没读这个环境变量 —— 于是每次跑 E2E 都会把 3 个
  演示项目写进用户真实的 `data/commander.db`。我在 2026-09-29 实测时踩到并确认。
- **修复**: `seedDemo()` 改为 `new App({ dataDir: process.env.COMMANDER_DATA_DIR || undefined })`；
  并在 `run-e2e.js` 里加了断言：seed 输出的 `Data dir:` 必须等于本次要求的隔离目录，
  否则直接抛错拒绝继续。这样同类回归不可能再静默发生。
- **验证**: 修复后重新 seed，演示项目落在临时目录，真实库保持 1 个真实项目不变。

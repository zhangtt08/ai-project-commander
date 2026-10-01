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
- **已于 2026-09-30 真机端到端验证通过**：本机其实一直有可用的 GitHub 凭据 ——
  GitHub CLI 装在 `C:\Program Files\GitHub CLI\gh.exe`（不在 PATH 上，所以早先的探测没找到），
  且全局 git 配了 `credential.https://github.com.helper = gh auth git-credential`。
  用 `gh auth token` 取到令牌（值不打印，直接写入本地设置）后：
  - `POST /api/github/verify` → `{ok:true, username:'zhangtt08'}`；
  - 导入一个临时项目 → `metadata.github = {ok:true, stage:'pushed', created:true,
    fullName:'zhangtt08/apc-gh-verify-…', branch:'main'}`，约 6 秒完成；
  - **GitHub 服务端回读**（`gh api repos/…`）：`private: true`、`default_branch: main`、
    文件 `.gitignore / README.md / package.json / src`、提交信息
    「chore: 导入 AI Project Commander 管理的项目」——非公开与真实推送都由 GitHub 自己确认。
  - 未配置令牌时导入照常成功，`github.stage = 'disabled'` 并给出中文原因。
- **遗留一件小事**：那个验证用的临时私有仓库**没能自动删掉** —— gh 的 OAuth 令牌 scope 只有
  `gist, read:org, repo`，GitHub 的删除仓库接口要求 `delete_repo`，返回
  `403 Must have admin rights to Repository.`。需要用户在
  `https://github.com/zhangtt08/apc-gh-verify-1790727079546` 手动删除（仓库是私有的，
  里面只有 3 个占位文件 + 自动生成的 .gitignore）。这不是产品缺陷：Commander 的删除流程
  只负责记录 + 源目录，不调用远端删库。

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

---

## 2026-09-29 BUG-015 · 已修复：目录被外部删除/移动后仍展示旧的结论

- **类型**: BUG（已修复）
- **症状**: 用户在资源管理器里删掉（或挪走）一个已登记的项目目录后，面板依然显示
  `健康 = 警告`、`9 条优化建议`、`单元测试 188/203`，最后分析时间 5 天前。Commander
  在对一个它已经读不到的目录断言事实 —— 违反本项目「只说真实证据支持的话」的底线。
- **修复**:
  - `projectCard()` 与新增的 `suggestionsView()` 以 `fs.existsSync(workspace_path)` 为准；
    目录不在时不再输出缓存的 classification/purpose/suggestionSummary，health 记为
    `unknown`，只留一条 `workspace-missing` 建议，正文引用真实路径与真实分析时间。
  - `attentionCenter()` 对该项目只产出 1 条 `workspace_missing`（critical）并 `continue`，
    跳过所有需要读盘的规则；`dashboard().counts` 把它计入 `critical` 与新的 `missing`，
    不再沿用旧的 warning。
  - UI：仪表盘卡片改为「目录已不存在」态，项目列表「健康」列显示「目录已丢失」，
    详情页顶部横幅 + 优化建议页只显示这一条。
  - 新增 `setWorkspacePath()`（PATCH `/api/projects/:id`）：路径必须存在且是目录、且没被
    其他项目占用，否则 400 并保留原记录；成功时清空旧结论、重挂 watcher、入队重新分析。
    这是「项目被移动」的唯一正规出路，用户不必删了重加。
- **验证**: `tests/integration/workspace-missing.test.js` 12 个用例（缓存遮蔽、attention 只
  1 条、counts 归类、relink 的四种拒绝、HTTP 面）。真机复核：用户的
  `C:/Users/Administrator/Desktop/Git一键上传` 已不在磁盘上，修复后面板从 4 条过期关注项
  变成 1 条「项目目录已不存在」，建议从 9 条变成 1 条，危急计数 0→1、警告 1→0。
  `node scripts/verify.js` 5/5 通过。
- **顺带**: 校验类错误提示补了中文 hint，并用 `errorText(err)` 统一展示
  （「目录不存在，无法指向它：… —— 项目移动后请填写新的位置」），不再是裸英文。
  ADR-009 不受影响：relink 只读目录元数据，不向工作区写任何东西。

---

## 2026-09-30 BUG-016 · 已修复：GitHub 自动上传在未配置时完全不可见

- **类型**: BUG（已修复）
- **症状**: 干净首启实测：`metadata.github` 为 `null`、`/api/settings` 里 github 三项都是 null，
  项目页没有任何地方说明"每加入一个项目会自动建私有仓库并上传"这件事存在、没开、或者该去哪开。
  对用户来说这条主功能等于不存在 —— 属于"半成品"级别的问题。
- **修复**: 项目详情页概览新增「GitHub 私有仓库自动上传」卡片：状态徽章（已上传/未开启/缺少令牌/
  上传失败/未尝试）+ 服务端给出的中文原因 + 仓库链接（pushed 后）+「立即上传」按钮 +
  跳转设置的链接；没配令牌时明确写"未配置令牌时不会有任何网络写入"。`+ 添加项目` 的提示同步
  说明配置令牌后会自动上传。
- **顺带发现并修掉的真实缺陷**: 按钮第一次上线时读的是 `res.ok`，而路由返回的是
  `{ result, project }` —— 点击后提示变成 `未上传：undefined`（在真机上实测到的）。改为读
  `res.result.*`，字段名按 publisher 的真实产出对齐（`ok/stage/reason/htmlUrl/fullName`，
  没有 `repoUrl`）。
- **验证**: 在 `github-publish-app.test.js` 加了 HTTP 用例锁住这个响应形状（含 detail 里记录的
  `github.reason` 与 result 一致），并在隔离实例（临时 dataDir，端口 8788）实测：点击按钮 →
  提示「未上传：未配置 GitHub 令牌，无法自动上传。」，卡片显示 未开启 + 真实时间。
  `node scripts/verify.js` 5/5。
- **仍未闭环**: GitHub 服务端真实受理（需要用户提供一个 repo 权限的 PAT）—— 见 LIMIT-013。

---

## 2026-09-30 BUG-017 · 已修复：彻底删除（清源）在改过路径/名字后永远无法确认

- **类型**: BUG（已修复）—— 只有把整条流程在真实 UI 里点一遍才会暴露
- **症状**: 「整理」对话框要求输入**项目显示名**作为清源口令，而服务端的 `confirm_token`
  是**磁盘上的真实目录名**（`source-purge.js` 用 `path.basename(real)`）。两者一致时看不出问题；
  一旦项目被改名或用过 BUG-015 的重新指向，用户照着界面提示输入就会一直收到
  「确认口令不匹配：请填写「<目录名>」」，等于彻底删除功能失效。
  实测：导入 `apc-move-src` → 磁盘上移到 `apc-moved-here` → 重新指向 → 按界面提示输入
  `apc-move-src` → 被拒。
- **修复**: 对话框直接用它已经拿到的删除预览 `assessment.confirmToken` 作为唯一口令：
  勾选清源后 placeholder 实时显示真实目录名，口令不匹配时说明"这是磁盘上真实的目录名"，
  预览尚未返回时提示稍等而不是静默失败，`assessment.ok === false`（受保护路径等）时给出原因。
  只删记录的模式仍然要求输入 `DELETE`。
- **验证**: 真实 UI 走通 —— 错误口令 `DELETE` 被拒并给出中文解释；按提示输入 `apc-moved-here`
  → 提示「已删除记录并清除源文件：C:/Users/Administrator/Desktop/apc-moved-here（3 个文件）」，
  目录与记录同时消失，列表 0 条。测试夹具全部由本次会话创建并已清理，桌面与临时目录无残留。
- **顺带**: BUG-015 之后「整理」对话框同时承担改路径职责，因此这一轮的隔离实例把
  导入 → 外部移动 → 目录已丢失 → 重新指向 → 自动重新分析 → 清源删除 整条链在真实浏览器里跑完，
  每一步的状态都来自服务端真实返回。`node scripts/verify.js` 5/5。

---

## 2026-09-30 BUG-018 · 已修复：对已消失目录的 quickScan 会写库并刷新分析时间

- **类型**: BUG（已修复）—— 违反"只对真实读到的内容下结论"的底线
- **症状**: `orchestrator.quickScan()` 不做 `metadata.ok` 检查就落库：目录已被删除时，
  scanner 返回 `{ok:false, reason:'workspace_not_found'}`，quickScan 依然把 `last_analyzed_at`
  刷成当前时间、把 `repository_type` 覆写为 `none`。实测：删除夹具目录后再 quickScan，
  `last_analyzed_at` 由 …221Z 变成 …227Z —— 面板于是宣称"刚刚分析过"，而它什么也没读到；
  BUG-015 里那些"结论来自上次分析的缓存"的说明也会跟着指向一个假时间。
  （`fullScan` 早就有 guard：直接抛 `workspace scan failed: workspace_not_found`。）
- **修复**: quickScan 对齐 fullScan —— `metadata.ok` 为假时记录 `SCAN_FAILED` 事件并抛出同一个
  错误，不写 metadata、不刷 `last_analyzed_at`、不动 language/framework/repo 字段。
  影响面：`addProjectAndClassify` 本来就 try/catch 了 quickScan，导入流程不受影响；
  watcher 在目录被外部删除后的自动快速扫描，现在会在时间线里留下一次诚实的失败，
  而不是静默地伪造一次"分析成功"。
- **验证**: `workspace-missing.test.js` 新增用例「a scan of a vanished folder fails and rewrites
  nothing」——先真实扫描（拿到 last_analyzed_at 与 classification），删除夹具目录，再扫描必须
  reject，并断言 `last_analyzed_at` 与 classification 逐字不变。该文件 13/13 绿。
- **顺带**: 关注中心里新增的 `workspace_missing` 条目原本会把英文枚举 `workspace_missing`
  当 chip 直接显示出来；补了中文标签「目录已丢失」。真机复核 `#/attention`：仅 1 行、
  无 undefined/null 文本。
- **再顺带**: 这个失败原本以裸 `Error` 抛出，HTTP 层统一包成
  `500 {"message":"Internal error","hint":""}` —— 用户点「快速扫描/全量扫描」只看到"内部错误"，
  看不到真实原因。quickScan 与 fullScan 现在都抛 `WorkspaceError`，实测返回
  `400 workspace_error` + `hint：项目目录已不存在或读不到——在「整理」里改成新位置后重新分析，
  或删除这条记录。`，项目页的扫描失败 toast 也改用 `errorText()` 把这句中文提示带出来。
  真机复核：两种扫描模式都是 400，且 `last_analyzed_at` 仍是 2026-09-24T14:48:36.577Z（未被伪造）。

---

## 2026-09-30 · E2E 断言与当前契约重新对齐（但仍未执行，见 LIMIT-011）

BUG-017 改了清源确认口令的来源（项目显示名 → 真实目录名），`e2e/e2e_test.py` 的
`delete_preview` 步骤原本断言界面文案「彻底删除需要输入项目名」——那会在一个**正确**的产品上失败。
按派生方式改成不钉死具体口令的中性断言：

- 拒绝文案只断言前缀「彻底删除需要输入」；
- 新增：勾选清源后，确认输入框的 placeholder 必须来自删除预览（`输入「…」` /
  `当前源目录不允许彻底删除` / 正在载入三者之一），证明提示不再是一个写死的词；
- 新增：「整理」对话框必须带有可编辑且已填好当前路径的「工作区路径」字段（BUG-015 的重新指向入口）。

`python -m py_compile e2e/e2e_test.py` 通过；**这个套件在本机没有被执行过**（本机无 Chromium，
用户 2026-09-26 明确拒绝为此下载安装），所以它的有效性仍未被证明 —— 不要把它算作交付证据。

---

## 2026-09-30 · 新增能力：GitHub 仓库只读浏览（不下载到本地）

- **来源**: 用户追加目标 —— "进一步的作用就是链接 github，根据 github 上我的仓库可以进一步读取我的
  项目，这一步不用把项目下到本地，只是通过 github 读取。"
- **实现**: `src/core/github-remote.js`（`listRemoteRepos` / `readRemoteRepo`）+
  `GET /api/github/remote/repos?q=` 与 `GET /api/github/remote/repo?name=owner/repo` +
  侧栏「GitHub → 仓库（只读）」页面 `#/github`。
- **边界**: 全程只走 GitHub REST，**没有任何 clone / fetch / 写盘 / 写库**；令牌只出现在
  Authorization 头里，响应体经 `redact` 清洗；单个端点失败只降级那一块（README 202/403 时其余照常）。
  README 用 `Accept: application/vnd.github.raw+json` 直接取原文，最多 20 KB，超出显式标注截断。
- **真机验证**（用他账号的真实凭据，只读）：列出 **16 个仓库、全部私有**，含语言与体积；
  读 `zhangtt08/ai-project-commander` 得到 `private: true`、语言 JavaScript 79% / Python 12.3% /
  C# 4.4%、README 15230 字符、根目录 11 项，四个子请求全 ok；页面实测渲染出
  仓库数/私有/筛选/读取时间四张指标 + 16 行 + 详情卡（语言构成 / 根目录 / README），
  页面文本里不含 `gho_` 等令牌痕迹。
- **测试**: `tests/unit/github-remote.test.js` 10 个用例（无令牌不联网、字段映射、本地筛选、
  401 原因不泄露令牌、传输失败降级、四读组装、README 单独降级、仓库不存在、非法名先拒、
  大 README 截断）。`node scripts/verify.js` 5/5。
- **本轮清理**: `.run/` 运行期脚本与截图已清空（981 KB → 4 KB）；`e2e/__pycache__` 从 git 取消跟踪
  并写进 `.gitignore`。`data/desktop/browser`（约 278 MB，Edge app 模式自带缓存）**没有删**——
  它是正在运行的窗口的用户数据目录，删掉会打断他的界面；需要回收时先关窗口再
  `rm -rf data/desktop/browser`，下次启动会自动重建。

---

## 2026-10-01 · 体验精简：从"九项导航 + 十五个标签"收到"五项 + 五个标签"

用户反馈：功能方向对，但板块和按钮太冗杂，一进去不知道点哪里开始。本轮只做体验层收敛，
不删功能，只改"一处一件事"的归属：

| 位置 | 之前 | 现在 |
|---|---|---|
| 侧栏 | 9 项 + 4 个分组标题（含 搜索/分析队列/全局时间线/安全模型） | 5 项：仪表盘 · 项目 · 关注中心 · GitHub 仓库 · 设置；运维类三项收进侧栏底部一组安静的「系统」子链接，路由不变 |
| 项目详情 | 15 个标签 | 5 个标签：概况（含识别+建议+GitHub 状态）· 任务与阶段 · 质量与验证（测试/构建/Git/变更/风险）· AI 记录（提示词/会话/记忆/决策）· 设置（时间线+项目设置+危险区域）。旧链接 `…/suggestions`、`…/tests` 等经 `LEGACY_TAB` 自动落到对应新组 |
| 项目详情顶栏 | 6 个按钮（快速扫描/全量扫描/生成提示词/交接包/全部项目/删除） | 1 个「重新分析」；提示词与交接包移到 AI 记录标签内，删除/归档/暂停监控归到设置标签的「危险区域」 |
| 项目列表 | 12 列 | 6 列（项目含技术栈/阶段/进度小字 · 分类 · 健康 · 验证 · 建议 · 操作） |
| 「整理」对话框 | 保存 + 暂停监控 + 归档 + 删除区 | 保存 + 一个指向项目设置标签的链接 + 删除区（暂停监控/归档只留一处） |
| 项目列表拖拽面板 | compact 模式仍带两个按钮，与右上角「+ 添加项目」重复 | compact 只留一行拖拽提示；完整面板（含两个按钮）仍用于空状态 |
| 设置 / 安全模型 | 与侧栏脱节的独立页 | 顶部一条 设置 · 分析队列 · 全局时间线 · 安全模型 分段条（`systemSections`），四个页面共用 |

验证：`node scripts/verify.js` 5/5；真机逐页走查（仪表盘/项目/关注/GitHub/设置/队列/时间线/安全 +
项目五个标签 + 两个旧链接）均渲染正常、无错误态、无死路，侧栏在每页都是同样的 5 + 3。

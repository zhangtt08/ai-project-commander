# AI Project Commander（AI 项目管理中枢）

**English** | [简体中文](README.zh-CN.md)

**AI 项目管理中枢** — the control plane for AI coding projects.

Commander 管理的是 Codex、Claude Code、Cursor、Gemini CLI 等 coding agent 正在开发的项目。它回答那些 agent 会跑一周之后就再也答不上来的问题：

- 这个项目现在**实际**处于什么阶段？
- 构建还能通过吗？测试还能通过吗？
- 上一次快照之后改了什么？有没有**回归**？
- 项目是不是在偏离它的规格说明？
- 下一个 agent 应该做什么——它的提示词应该怎么写？

它**不是** Jira 克隆、待办清单或 git 图形界面。它展示的每一个结论都来自磁盘上收集到的真实工程证据。

![License](https://img.shields.io/badge/license-MIT-blue)
![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522.5-339933)
![Dependencies](https://img.shields.io/badge/runtime%20dependencies-0-brightgreen)

---

## Commander 是什么

一个本地优先（local-first）的桌面应用，它会：

1. **发现**本机上已有的 coding 项目并**注册**它们。
2. **分类**每个项目（AI 智能体 / Web 应用 / 浏览器插件 / 桌面应用 / 数据与自动化…），并给出分类依据。
3. 从项目自己的 README、`package.json` 或规格说明中**识别用途**——仓库什么都没声明时，它会如实说"未声明"，而不是编一个用途。
4. **扫描**技术栈、目录结构、规格文件、TODO 标记与敏感文件。
5. 在严格的安全围栏内**运行**检测到的构建 / 测试命令。
6. **快照**结果并**检测快照之间的回归**。
7. **推导**阶段、任务、验收标准、健康度、风险与进度。
8. **提出优化建议**——每条都注明它依据的数字。
9. **推荐**下一步行动并**生成**可直接粘贴的 agent 提示词。
10. 若你启用，在导入时把项目**发布**到你自己的 GitHub **私有**仓库。
11. **追踪**每一条 提示词 → 执行 → 证据 → 验收 链接。

**分析流水线是只读的**：扫描、构建、测试从不修改你的项目。只有两个操作会写，且都必须你显式发起——删除项目的源文件，以及发布到 GitHub。见[安全模型](#安全模型)。

## 核心功能

| 领域 | 你得到什么 |
| --- | --- |
| 仪表盘 | 真实计数（健康 / 警告 / 危急 / 阻塞）+ 每个项目卡片带实时构建、单测、e2e、git、验收门与进度数据 |
| 关注中心 | 危急健康、构建失败、失败测试套件、回归、阻塞任务、脏工作区、规格漂移、待审提示词 |
| 项目详情 | 14 个标签页：总览 · 阶段 · 任务 · 测试 · 构建 · Git · 变更 · 提示词 · Agent 会话 · 风险 · 记忆 · 决策 · 时间线 · 设置 |
| 验收门 | PASS / FAIL / BLOCKED / UNKNOWN，**每一项阻塞检查都有解释** |
| 健康引擎 | healthy / warning / critical / unknown，附透明可查的"为什么"原因列表 |
| 风险引擎 | 16 条确定性规则，每条带严重度、证据与建议动作 |
| Issues | 在计算出的风险旁手工建 issue——计算 vs. 手工永远可区分 |
| 回归检测 | 构建 PASS→FAIL、测试 PASS→FAIL、通过数下降、用例数下降、危急风险增加、文件删除、验收门回退 |
| 任务台账 | 任务来自规格文件、markdown 复选框、TODO/FIXME 标记、agent 日志、手工录入与 AI——带来源与置信度 |
| 项目记忆 | 版本化、只追加的项目记忆，可渲染为提示词与交接材料 |
| 下一步行动 | 确定性 12 规则决策链；LLM 只能改措辞，不能改选择 |
| 提示词生成 | 十个必备段落，即使 Provider 漏写也保证齐全 |
| 交接包 | 一份完整简报，让 Codex → Claude → Cursor → Gemini 没有原始对话也能继续 |
| 搜索 | SQLite FTS5 全文检索项目、任务、提示词、风险与决策（LIKE 兜底） |
| 演示模式 | 三个演示项目（真实构建/测试）——健康、警告（22/25 e2e）、危急 |

## 架构

```
表现层          src/web/**      原生 ES-module SPA（无构建步骤）
API 层         src/server/**   零依赖 HTTP 路由
应用层         src/core/**     编排器 · 引擎 · 分析器 · 队列 · watcher · AI
领域层         src/domain/**   枚举 · schema · 错误（不 import 任何东西）
基础设施       src/db/**       node:sqlite + 版本化迁移 + repository
               src/core/command-runner.js  唯一的进程启动模块
               src/core/fs-safe.js         唯一的工作区文件读取模块
```

依赖方向严格向下。完整流水线图与接口契约见 [`docs/agent/ARCHITECTURE.md`](docs/agent/ARCHITECTURE.md)。

**确定性优先，LLM 其次。** Git 状态、文件存在性、构建结果、测试数量、包管理器与进度全部由确定性代码计算。AI Provider 只做总结、解释与建议——每条 AI 响应都经过 schema 校验，失败重试一次，然后回退到确定性的 mock（UI 中**明确标注为 mock**）。

## 技术栈

- **运行时**：Node.js ≥ 22.5（使用内置 `node:sqlite`——无原生模块）
- **后端**：零依赖 HTTP server，ESM
- **数据库**：SQLite（WAL、外键、版本化迁移、可用时启用 FTS5）
- **前端**：原生 ES modules + 手写 CSS（Linear 风格亮色主题）
- **测试**：`node:test`（133 单测 + 40 集成），Playwright/Chromium e2e（16 步）
- **包管理**：npm——**零运行时依赖**，`npm install` 瞬间完成且完全离线

## 快速开始

**Windows 桌面方式（推荐）**：双击桌面上的 **AI Project Commander** 快捷方式，或
`desktop\AIProjectCommander.exe`。它是一个原生 WinForms 外壳（自带图标、独立任务栏身份与
托盘），负责拉起本地服务并用 Edge 应用模式打开独立窗口；服务已在运行时它只会把窗口带回前台。

**Windows 脚本方式**：双击根目录的 `启动.bat`。若 exe 尚未构建，它会自动退回"启动服务 +
打开浏览器"的方式，并提示如何构建 exe。

命令行方式：

```bash
git clone https://github.com/zhangtt08/ai-project-commander.git
cd ai-project-commander
npm install        # no-op（零依赖）——仅为惯例保留
npm run dev        # → http://127.0.0.1:8787（被占用时自动 +1，横幅会打印实际地址）
```

**首次启动不需要任何准备，也不会塞演示数据**：Commander 会扫描这台电脑（主目录、桌面、
文档、source 以及 D:/E:/F: 盘），把真正的项目目录导入并完成分类与用途识别，通常 2 秒内
就能看到有内容的仪表盘。想改搜索范围：设置 → 文件夹识别（拖拽导入）→ 搜索根目录。

### 添加自己的项目

`+ 添加项目` 打开一个双标签对话框：

- **扫描这台电脑** — 列出磁盘上发现的项目目录（含生态、git 状态与最近修改），默认一个都不勾，
  已管理的项目会标记出来避免重复添加，支持一次导入多个。
- **输入路径** — 绝对路径，加可选的名称与分类。

**如果目录被移动或在资源管理器里被删除**，Commander 会停止对它下结论：卡片变成"目录已不存在"，
项目从健康计数中移除并成为一条危急关注项，优化建议里保留唯一一条如实引用真实路径与
上次成功分析时间的条目。打开 项目 → 整理（或项目页的设置）输入新位置即可重新关联——
过期记录被清除、项目重新分析，无需删除重加。关联到不存在的路径、文件或已被其他项目
占用的目录会被拒绝并说明原因，不产生任何改动。

每个项目总览页有一张 **GitHub 私有仓库自动上传**卡片：最近一次状态（已上传 / 未开启 /
缺少令牌 / 上传失败 / 未尝试）、逐字的原因、私有仓库链接（存在时）、**立即上传**按钮和
设置入口。没有令牌时它会直说什么都没发出去——这个功能永远不会隐身，无令牌点击返回原因
而不是静默失败。

### 不下载也能浏览 GitHub 仓库

侧栏 **GitHub → 仓库（只读）**（`#/github`）列出账号下的仓库——名称、私有/公开、主语言、
大小、最近 push、描述——**只读查看**打开由 4 个 REST 读取拼装的详情：语言构成、根目录文件
清单与 README 正文。不做任何克隆或写入：没有 `git clone`、没有 `fetch`、磁盘上没有文件、
数据库里没有行。令牌始终留在服务端（浏览器只会看到 `__stored__`），每个部分独立降级，
GitHub 还在生成的 README 不会让面板空白。

它与发布路径互补：Commander 管理本机上的项目，还可以*查看* GitHub 上有什么而不拉下来。

无论哪种方式，Commander 随后会：

1. 扫描它（结构、技术栈、规格、标记、敏感文件），
2. 基于真实证据分类并识别用途，
3. 产出优化建议，每条注明依据，
4. 读取 git 状态，检测并运行构建/测试命令，
5. 产出快照、健康结论、风险清单与下一步行动，
6. 以及——若在设置中启用——创建你的 **私有** GitHub 仓库并在后台推送，不阻塞导入。

## 演示项目（仅测试夹具）

产品本身从不预置演示数据。三个演示项目纯粹作为 E2E 套件的确定性夹具；
`scripts/run-e2e.js` 把它们种进**隔离的临时数据目录**，若种子报告指向任何其他目录则拒绝继续。
手动种入：

```bash
npm run seed:demo   # 遵守 COMMANDER_DATA_DIR；不设置就会写进真实数据库
```

## 开发

```bash
npm run dev            # 启动服务（PORT / COMMANDER_DATA_DIR 环境变量可覆盖）
npm run build          # 静态构建检查：每个模块可解析、资源与 agent 记忆齐全
npm run typecheck      # 全部 65 个文件的解析 + import/绑定解析
npm run lint           # 架构策略：child_process 只能在 CommandRunner、
                       # fs 写入只能在授权模块、无 eval、领域纯净
npm test               # 单测 + 集成
npm run test:unit      # 133 个单测（~8s）
npm run test:integration  # 40 个集成测试（~40s，真实跑构建/测试）
npm run verify         # typecheck + lint + build + 单测 + 集成 一条命令
```

## 测试

- **单元**（`tests/unit/`）：schema 校验器、敏感文件检测、fs 护栏、ignore 引擎、扫描器、
  命令分类（allowlist + deny list）、git 分析器、三个测试报告解析器、规格解析、任务台账、
  阶段管理器、验收门、健康度、进度、风险、回归、漂移、下一步行动排序、提示词契约、交接、
  记忆版本化、结构化 AI 重试/回退、队列并发/超时/取消、watcher 防抖、搜索（FTS5 + LIKE 兜底）、
  agent 适配器。
- **集成**（`tests/integration/`）：生成三个真实夹具项目并扫描、构建、测试；注入并检测一次回归；
  重复扫描的幂等性；完整 HTTP API 面；以及一套安全测试，证明敏感内容永远不会进入数据库、
  日志或 AI 请求，且完整扫描对被管工作区逐字节零改动。
- **E2E**（`e2e/e2e_test.py`）：真实 Chromium 对真实服务——仪表盘、关注中心、项目详情、测试、
  风险、下一步行动、提示词生成、交接、搜索、设置、键盘导航。截图落在 `.e2e-artifacts/`。

```bash
npm run test:e2e       # ~2.5 min（种入演示数据、启动服务、驱动 Chromium）
                       # 覆盖：dashboard、attention、detail、tests、risks、issues、tasks、
                       # decisions、memory、transcript import、prompt、handoff、search、a11y
```

## AI Provider 配置

默认是离线 **mock** Provider（确定性、无 key、明确标注）。要用真实模型，设置一个
OpenAI 兼容端点：

```bash
# 通过设置界面（本地保存，绝不返回给浏览器），或：
export OPENAI_API_KEY=sk-...
export OPENAI_BASE_URL=https://api.openai.com/v1   # 或 Ollama/vLLM/OpenRouter/Groq
```

然后 Settings → Provider → `openai-compatible`。每条响应都按 schema 校验；无效输出带着
校验错误重试一次，然后回退到确定性 mock——从不盲目信任 `JSON.parse`。

## 安全模型

| 面 | 保证 |
| --- | --- |
| 敏感文件 | `.env`、`*.pem`、`*.key`、`id_rsa`、`credentials*`、`secrets*`、`tokens*`、`.npmrc`、`.pypirc`、云凭据目录… **被检测但从不读取**——不进数据库、日志或 AI 请求（测试强制） |
| 被管工作区 | **分析流水线**（扫描 / 构建 / 测试 / 回归）只读——由基于 mtime 的测试强制。两个**用户发起**的操作是授权例外，都有门禁：① 删除项目可同时清除源目录，但必须先经 `assessPurgeTarget()` 拒绝盘根、主目录/桌面/文档、浅路径与 Commander 自己的数据目录，**且**你手动回输文件夹名确认；② GitHub 发布只写项目自己的 `.git` 并推送到 `github.com` 远端——`ensureOriginRemote()` 拒绝任何其他主机，代码无法被重定向到别处 |
| 命令执行 | 唯一的 `CommandRunner`；永远 `shell: false`；allowlist（git 只读检查；`npm run/test`；`npx vitest/playwright`；`git init/add/commit/push/remote` 保留给显式发布动作）+ deny list（`rm`、`del`、`format`、`git reset --hard`、`git clean`、`rebase`、`push --force`、`npm install`…）。发布动词刻意**不会**被任何扫描自动执行 |
| GitHub 令牌 | 保存在本地 SQLite settings 表，绝不返回给浏览器，绝不进命令行，绝不写进项目的 `.git/config`——它只通过 `GIT_CONFIG_*` 环境变量交给 git，所有被记录或返回的字符串都被清洗 |
| AI 数据边界 | 只发送路径、计数、统计、短摘录与失败信息；机密在传输前打码 |
| 密钥 | API key 存在本地 SQLite settings 表；API 永不返回它们 |
| 前端 | 无 key、无动态数据 `innerHTML`、无 eval |

见 `GET /api/security` 与应用内 **Security** 页面。

## 已知边界

- 前端是无构建的原生 SPA（见 `docs/agent/DECISIONS.md` ADR-001——交付环境无法访问 npm
  registry）。REST 契约稳定，因此可以在不动后端的情况下加 React/Vite 客户端。
- 真实的 Codex / Claude Code / Cursor 会话记录读取器**未实现**——这些工具的本地历史格式
  在此处未验证。现提供 `ManualImportAdapter`（粘贴会话记录）与 `MockAgentAdapter`
  （明确标注）；适配器接口已冻结，供未来实现。
- 语言/框架检测对 JS/TS 生态覆盖深（Node、TS、React、Vite、Next、Vitest、Jest、
  Playwright、Express、Nest、Electron…）。Python/Go/Rust 扫描器是扩展点
  （`LANGUAGE_DETECTORS`），不是已交付功能。
- `node:sqlite` 在 Node 22 上会打印 `ExperimentalWarning`——预期内，无害。
- 测试输出解析理解 vitest / jest / playwright 报告格式；其他格式按*不可解析*上报而不是猜。
- 桌面外壳是用系统自带 `csc.exe` 编译的原生 WinForms `.exe`；窗口本体由本机安装的 Edge
  以 `--app` 模式渲染，不是 Electron。同样的 Chromium 内核，但不是单一自包含安装包——
  另一台机器需要 Node 22+ 与 Edge。WebView2 的托管程序集此处缺失，npm registry 拉不动
  Electron，这是零依赖路线（ADR-001）。
- **Playwright E2E 套件未在这台机器上执行过**——未安装 Chromium，且下载被拒绝。
  270 个单测/集成测试通过，UI 通过驱动运行中的应用并截取真实窗口像素做了验证，
  但 21 步 E2E 运行未验证。
- **GitHub 发布已对真实 GitHub 端到端验证**（2026-09-30）：导入一个项目在账号上创建了
  `private: true` 仓库并推送成功——通过从 GitHub API 回读仓库、文件清单与提交确认，
  不只是 Commander 自己的状态。所用凭据是本机 GitHub CLI 登录（`gh auth token`，
  scopes `gist, read:org, repo`），管道注入 Settings 且从不打印；API 只回显 `__stored__`。
  该令牌做不到的一件事是删除仓库（需要 `delete_repo` scope），删除已发布仓库仍是
  GitHub 侧的手工步骤。

## 路线图

仅 P2 项——以上功能均已交付，不是承诺：

1. Codex CLI / Claude Code / Cursor 的真实会话记录适配器。
2. Python / Go / Rust 生态检测器。
3. 跨项目依赖图与影响分析。
4. AST 级语义分析以支持更深的漂移检测。
5. 团队功能：共享实例、角色、远程 Commander 服务。

## Agent Recovery（agent 可接续）

本仓库设计为任何 AI agent 无需聊天历史即可接续：

- [`docs/agent/PROJECT_STATE.md`](docs/agent/PROJECT_STATE.md) — 当前状态
- [`docs/agent/NEXT_ACTION.md`](docs/agent/NEXT_ACTION.md) — 下一步做什么
- [`docs/agent/RECOVERY.md`](docs/agent/RECOVERY.md) — 恢复协议
- 另有 `MASTER_PLAN.md`、`TEST_STATUS.md`、`KNOWN_ISSUES.md`、`DECISIONS.md`、
  `CHANGELOG_DEV.md`、`ARCHITECTURE.md`

新 agent 应先读 `RECOVERY.md`，运行 `npm run verify`，然后从 `NEXT_ACTION.md` 继续。

## 许可证

[MIT](LICENSE)

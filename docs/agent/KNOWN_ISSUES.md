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

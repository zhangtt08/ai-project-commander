/**
 * Project classification (项目分类) and purpose identification (识别用途).
 *
 * Both are derived from evidence the scanner already collected — never invented. Every
 * category carries the reasons that produced it so the UI can show *why* it decided.
 */

export const CATEGORY_DEFS = Object.freeze([
  { key: 'ai-agent', label: 'AI 智能体', hint: '调用大模型 / MCP / Agent 编排' },
  { key: 'web-app', label: 'Web 应用', hint: '浏览器端应用或全栈站点' },
  { key: 'desktop-app', label: '桌面应用', hint: 'Electron / Tauri / WinForms 等本机程序' },
  { key: 'mobile-app', label: '移动应用', hint: 'iOS / Android / 跨端移动项目' },
  { key: 'browser-ext', label: '浏览器插件', hint: 'Chrome / Edge 扩展' },
  { key: 'cli-tool', label: '命令行工具', hint: '终端里运行的工具或脚本集' },
  { key: 'data-pipeline', label: '数据与自动化', hint: '爬虫、ETL、定时任务、数据分析' },
  { key: 'library', label: '库与 SDK', hint: '被别的项目引用的包' },
  { key: 'content-site', label: '内容与文档站', hint: '文档、博客、静态展示站' },
  { key: 'game', label: '游戏与可视化', hint: '游戏、图形与交互演示' },
  { key: 'infra', label: '基础设施', hint: '部署、容器、运维配置' },
  { key: 'experiment', label: '实验与原型', hint: '小规模验证性代码' },
  { key: 'uncategorized', label: '未分类', hint: '证据不足，需人工确认' },
]);

export const CATEGORY_KEYS = Object.freeze(CATEGORY_DEFS.map((c) => c.key));
export const CATEGORY_LABELS = Object.freeze(Object.fromEntries(CATEGORY_DEFS.map((c) => [c.key, c.label])));

export function categoryLabel(key) {
  return CATEGORY_LABELS[key] || CATEGORY_LABELS.uncategorized;
}

const AI_DEPS = /(^|[/@-\s])(openai|anthropic|langchain|langgraph|llama|ollama|transformers|@azure\/openai|@google\/generative-ai|@modelcontextprotocol|mcp|bedrock|cohere|groq|deepgram|whisper)([-@/\s]|$)/i;
const WEB_FRAMEWORKS = /react|vue|svelte|solid|angular|next|nuxt|remix|astro|vite|webpack|tailwind/i;
const DESKTOP_DEPS = /electron|tauri|nw\.js|neutralino/i;
const MOBILE_DEPS = /react-native|expo|flutter|ionic|capacitor/i;
const DATA_DEPS = /pandas|numpy|scrapy|airflow|duckdb|sqlalchemy|celery|apscheduler|beautifulsoup|selenium|playwright|requests|httpx/i;
// Dedicated engines and video/motion runtimes: these define what the project IS.
const GAME_DEPS = /(^|[/@-\s])(phaser|pixi|pixi\.js|godot|unity|cocos|pygame|babylon|babylonjs|remotion|motion-canvas)([-@/\s.]|$)/i;
// Animation/visualisation libraries that ordinary websites also use. `gsap` alone once
// reclassified a portfolio site as a game — these may only support a decision, never make it.
const VIZ_LIB_DEPS = /(^|[/@-\s])(three|three\.js|konva|d3|echarts|gsap|lottie|p5|fabric|highcharts|chart\.js|victory)([-@/\s.]|$)/i;
// `@types/chrome` is unambiguous: an extension, not a website. manifest.json alone is not,
// because PWAs ship one too.
const EXTENSION_DEPS = /@types\/chrome|webextension|@crxjs|plasmo|^wxt$|extension-web-i18n/i;

const SOURCE_EXT_RE = /^\.(js|mjs|cjs|ts|tsx|jsx|vue|svelte|py|go|rs|java|kt|rb|php|c|h|cpp|hpp|cs|swift|scala|lua|dart|ex|sql)$/i;

function countSourceFiles(extCounts) {
  let n = 0;
  for (const [ext, count] of Object.entries(extCounts || {})) {
    if (SOURCE_EXT_RE.test(ext)) n += Number(count) || 0;
  }
  return n;
}

function allDependencyNames(pkg) {
  if (!pkg || typeof pkg !== 'object') return '';
  const buckets = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  const names = [];
  for (const b of buckets) if (pkg[b] && typeof pkg[b] === 'object') names.push(...Object.keys(pkg[b]));
  return names.join(' ');
}

/**
 * @param {object} meta ProjectScanner result (see scanner.js `scan`)
 * @param {{manualCategory?:string, specs?:Array}} [opts]
 * @returns {{category:string,label:string,confidence:string,reasons:Array<{text:string,weight:number}>,manual:boolean}}
 */
export function classifyProject(meta, { manualCategory = null, specs = [] } = {}) {
  if (manualCategory && CATEGORY_KEYS.includes(manualCategory)) {
    return { category: manualCategory, label: categoryLabel(manualCategory), confidence: 'high', reasons: [{ text: `用户手动指定为「${categoryLabel(manualCategory)}」`, weight: 10 }], manual: true };
  }

  const reasons = [];
  const add = (text, weight) => {
    if (text) reasons.push({ text, weight });
  };

  if (!meta || meta.ok !== true) {
    return { category: 'uncategorized', label: categoryLabel('uncategorized'), confidence: 'low', reasons: [{ text: '尚未完成扫描，无法判断', weight: 1 }], manual: false };
  }

  const pkg = meta.packageJson || null;
  const deps = allDependencyNames(pkg);
  const text = [
    deps,
    (meta.frameworks || []).join(' '),
    meta.primaryLanguage || '',
    (meta.languages || []).map((l) => l.name).join(' '),
    pathHints(meta),
  ].join(' ');
  const fileCount = Number(meta.fileCount) || 0;
  const roles = meta.roleCounts || {};
  const isDocHeavy = (roles.docs || 0) > (roles.source || 0) && (roles.docs || 0) > 2;

  if (AI_DEPS.test(text)) add('依赖中出现大模型 / MCP / Agent 相关包', 6);
  if (/(agent|agents|mcp|llm|prompt|chatbot|assistant|copilot|rag)/i.test(pathHints(meta)) && AI_DEPS.test(deps)) add('目录与依赖同时指向 AI 应用', 3);
  if (DESKTOP_DEPS.test(text)) add('使用 Electron / Tauri 等桌面壳', 6);
  if (MOBILE_DEPS.test(text)) add('使用 React Native / Expo / Flutter 等移动框架', 6);
  if (EXTENSION_DEPS.test(deps)) add('依赖中包含浏览器扩展专用包 (@types/chrome 等)', 6);
  if (WEB_FRAMEWORKS.test(text)) add('存在前端框架或构建工具', 4);
  if (flagged(meta.directories, ['monorepoApps', 'monorepoPackages']).split(' ').length >= 2) add('同时存在 apps/ 与 packages/，是 monorepo', 2);
  if (pkg && pkg.bin && Object.keys(pkg.bin).length) add('package.json 声明了可执行入口 (bin)', 5);
  if (pkg && pkg.main && pkg.types && !pkg.bin) add('作为被引用的包发布 (main + types)', 3);
  if (DATA_DEPS.test(text)) add('存在数据处理 / 抓取 / 自动化依赖', 4);
  if (GAME_DEPS.test(deps)) add('使用游戏引擎或程序化视频框架', 5);
  else if (VIZ_LIB_DEPS.test(deps)) add('使用动画 / 可视化库（普通网站也会用）', 1);
  if ((meta.ecosystems || []).includes('python') && !WEB_FRAMEWORKS.test(deps)) add('Python 项目', 2);
  if (flagged(meta.configFiles, ['docker', 'ci'])) add('存在部署 / 流水线配置', 3);
  // No source files at all means there is nothing to classify — calling an `npm install`
  // scratch folder a "prototype" would be a guess dressed up as a result.
  const sourceFiles = countSourceFiles(meta.extCounts);
  if (sourceFiles === 0) {
    return {
      category: 'uncategorized',
      label: categoryLabel('uncategorized'),
      confidence: 'low',
      reasons: [{ text: `目录中没有任何源码文件（共 ${meta.fileCount || 0} 个文件），可能不是项目`, weight: 0 }],
      manual: false,
      notAProject: true,
    };
  }
  if (isDocHeavy) add('文档文件数量超过源码文件', 4);
  if (fileCount > 0 && fileCount <= 12) add(`受跟踪文件仅 ${fileCount} 个，规模像一次性验证`, 2);
  if (!hasReadmeDoc(meta)) add('仓库内没有 README', 1);
  for (const s of specs || []) {
    const t = ((s.parsed && s.parsed.goals) || []).map((g) => g.text).join(' ');
    if (AI_DEPS.test(t)) add('规格文档描述了 AI 能力', 2);
  }

  const category = decide(text, deps, reasons, meta, { isDocHeavy, fileCount });
  const score = reasons.reduce((a, r) => a + r.weight, 0);
  const confidence = score >= 8 ? 'high' : score >= 4 ? 'medium' : score >= 1 ? 'low' : 'unknown';
  return { category, label: categoryLabel(category), confidence, reasons: reasons.sort((a, b) => b.weight - a.weight), manual: false };
}

function decide(text, deps, reasons, meta, { isDocHeavy, fileCount }) {
  const has = (re) => re.test(text);
  const hasDep = (re) => re.test(deps);
  const weightOf = (re) => reasons.filter((r) => re.test(r.text)).reduce((a, r) => a + r.weight, 0);
  if (weightOf(/大模型|MCP|Agent 编排|AI 能力/) >= 4) return 'ai-agent';
  if (hasDep(DESKTOP_DEPS)) return 'desktop-app';
  if (hasDep(MOBILE_DEPS)) return 'mobile-app';
  if (hasDep(EXTENSION_DEPS)) return 'browser-ext';
  if (hasDep(GAME_DEPS)) return 'game';
  if (weightOf(/可执行入口/) >= 5 && !has(WEB_FRAMEWORKS)) return 'cli-tool';
  if (isDocHeavy) return 'content-site';
  if (has(WEB_FRAMEWORKS)) return 'web-app';
  if (has(DATA_DEPS)) return 'data-pipeline';
  if (weightOf(/部署|流水线/) >= 3 && fileCount <= 40) return 'infra';
  if (weightOf(/被引用的包/) >= 3) return 'library';
  if (fileCount > 0 && fileCount <= 12) return 'experiment';
  if ((meta.primaryLanguage || '') !== 'unknown') return 'web-app';
  return 'uncategorized';
}

/** `configFiles` / `directories` are boolean maps, not arrays. */
function flagged(map, keys) {
  if (!map || typeof map !== 'object') return '';
  const wanted = keys ? keys.filter((k) => map[k]) : Object.keys(map).filter((k) => map[k] === true);
  return wanted.join(' ');
}

function hasReadmeDoc(meta) {
  return (meta.topLevelFiles || []).some((f) => /^readme(\.|$)/i.test(String(f))) ||
    (meta.markdownDocs || []).some((d) => /(^|\/)readme/i.test(d.path || ''));
}

function pathHints(meta) {
  const dirs = flagged(meta.directories);
  const configs = flagged(meta.configFiles);
  const files = (meta.topLevelFiles || []).join(' ');
  const docs = (meta.markdownDocs || []).map((d) => `${d.path} ${d.title || ''}`).join(' ');
  return `${dirs} ${configs} ${files} ${docs}`;
}

/**
 * Identify what the project is *for*, from its own words plus structural evidence.
 * Falls back to a clearly-labelled structural description when the repo says nothing —
 * it never guesses a business purpose that has no evidence.
 */
export function identifyPurpose(meta, { specs = [], project = {} } = {}) {
  const evidence = [];
  const declared = [];

  const readme = (meta.markdownDocs || []).find((d) => /(^|\/)readme/i.test(d.path || ''));
  if (readme) {
    const line = String(readme.title || '').trim();
    if (line.length >= 4) {
      declared.push(line.slice(0, 300));
      evidence.push({ source: `README:${readme.path}`, text: line.slice(0, 200) });
    }
  }
  if (meta.packageJson && typeof meta.packageJson.description === 'string' && meta.packageJson.description.trim()) {
    declared.push(meta.packageJson.description.trim().slice(0, 300));
    evidence.push({ source: 'package.json:description', text: meta.packageJson.description.trim().slice(0, 200) });
  }
  if (project.description && project.description.trim()) {
    declared.push(project.description.trim().slice(0, 300));
    evidence.push({ source: 'commander:项目描述', text: project.description.trim().slice(0, 200) });
  }
  for (const s of specs || []) {
    const goals = ((s.parsed && s.parsed.goals) || []).map((g) => g.text).filter(Boolean);
    if (goals.length) {
      declared.push(goals[0].slice(0, 300));
      evidence.push({ source: `spec:${s.path || s.name || 'spec'}`, text: goals[0].slice(0, 200) });
    }
  }

  const cls = classifyProject(meta, { specs });
  const structural = structuralDescription(meta, cls);
  const hasDeclared = declared.length > 0;

  return {
    purpose: hasDeclared ? declared[0] : '',
    summary: hasDeclared
      ? `${declared[0]}（${structural}）`
      : `${meta.name || '该项目'}：仓库内没有描述业务用途，以下仅根据文件与目录命名推断——${structural}`,
    declared: hasDeclared,
    category: cls.category,
    categoryLabel: cls.label,
    confidence: cls.confidence,
    reasons: cls.reasons,
    evidence: evidence.slice(0, 8),
    structural,
  };
}

function structuralDescription(meta, cls) {
  const bits = [];
  if (meta.primaryLanguage && meta.primaryLanguage !== 'unknown') bits.push(`主语言 ${meta.primaryLanguage}`);
  const frameworks = (meta.frameworks || []).filter(Boolean);
  if (frameworks.length) bits.push(`框架 ${frameworks.slice(0, 3).join(' / ')}`);
  if (meta.packageManager && meta.packageManager !== 'unknown') bits.push(`${meta.packageManager} 管理依赖`);
  const roles = meta.roleCounts || {};
  bits.push(`${meta.fileCount || 0} 个受跟踪文件（源码 ${roles.source || 0}、测试 ${(roles.test || 0) + (roles.e2e || 0)}、文档 ${roles.docs || 0}）`);
  if (meta.isGitRepositoryHint) bits.push('已纳入 Git 版本管理');
  bits.push(`归类为「${cls.label}」`);
  return bits.join('，');
}

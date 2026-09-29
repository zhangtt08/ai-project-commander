/**
 * Classifier regression cases. Each one encodes a decision that was verified against a real
 * project on the author's machine — including a portfolio site whose `gsap` dependency once
 * mislabelled it as a game. They are reproduced as synthetic metadata so the suite stays
 * independent of whatever happens to be on disk.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyProject, CATEGORY_KEYS, categoryLabel } from '../../src/core/categories.js';

function meta(overrides = {}) {
  return {
    ok: true,
    name: 'probe',
    fileCount: 60,
    primaryLanguage: 'JavaScript',
    languages: [{ name: 'JavaScript', files: 50 }],
    ecosystems: ['node'],
    frameworks: [],
    packageManager: 'npm',
    roleCounts: { source: 40, test: 5, docs: 3 },
    topLevelFiles: ['package.json', 'index.js'],
    directories: { src: true, tests: true },
    configFiles: {},
    markdownDocs: [],
    todos: [],
    largestFiles: [],
    // The real scanner always reports this; without it a project looks like an empty folder.
    extCounts: { '.js': 40, '.json': 5, '.md': 3 },
    ...overrides,
  };
}

// Returns a dependency MAP, to be placed under packageJson.dependencies.
function depsOf(names) {
  return Object.fromEntries(names.map((n) => [n, '^1.0.0']));
}

const CASES = [
  ['openai', 'ai-agent'],
  ['@modelcontextprotocol/sdk', 'ai-agent'],
  ['electron', 'desktop-app'],
  ['@tauri-apps/api', 'desktop-app'],
  ['react-native', 'mobile-app'],
  ['@types/chrome', 'browser-ext'],
  ['remotion', 'game'],
  ['phaser', 'game'],
  ['scrapy', 'data-pipeline'],
];

describe('dependency-driven categories', () => {
  for (const [dep, expected] of CASES) {
    test(`${dep} -> ${expected}`, () => {
      const r = classifyProject(meta({ packageJson: { name: 'p', dependencies: { [dep]: '^1.0.0' } } }), {});
      assert.equal(r.category, expected, `${r.label} | reasons: ${r.reasons.map((x) => x.text).join('; ')}`);
      assert.ok(CATEGORY_KEYS.includes(r.category));
      assert.equal(r.label, categoryLabel(r.category));
    });
  }
});

describe('libraries that merely animate a website must not change its category', () => {
  // The real case: a React + Vite portfolio using GSAP was classified as 游戏与可视化.
  test('react + vite + gsap stays a web app', () => {
    const r = classifyProject(meta({
      packageJson: {
        name: 'ztt-home-index',
        dependencies: depsOf(['react', 'react-dom', 'react-router-dom', 'gsap', 'vite', '@vitejs/plugin-react', 'lucide-react']),
      },
      frameworks: ['react', 'vite'],
    }), {});
    assert.equal(r.category, 'web-app', `got ${r.label}: ${r.reasons.map((x) => x.text).join('; ')}`);
    // the animation library is still allowed to appear as a (weak) supporting reason
    assert.ok(r.reasons.every((x) => x.weight <= 4), 'a shared library must not outweigh the framework');
  });

  test('d3 in a dashboard stays a web app', () => {
    const r = classifyProject(meta({ packageJson: { name: 'd', dependencies: depsOf(['vue', 'd3', 'vite']) }, frameworks: ['vue'] }), {});
    assert.equal(r.category, 'web-app');
  });

  test('three.js is not enough on its own to call something a game', () => {
    const r = classifyProject(meta({ packageJson: { name: 't', dependencies: depsOf(['react', 'three', 'vite']) }, frameworks: ['react'] }), {});
    assert.equal(r.category, 'web-app');
  });
});

describe('honest uncertainty', () => {
  test('an unscanned project is 未分类 with low confidence, never a guess', () => {
    const r = classifyProject({ ok: false }, {});
    assert.equal(r.category, 'uncategorized');
    assert.equal(r.confidence, 'low');
  });

  test('a 2-file repo with no README is flagged as low confidence', () => {
    const r = classifyProject(meta({ fileCount: 2, roleCounts: { source: 2 } }), {});
    assert.ok(['experiment', 'uncategorized', 'library'].includes(r.category), `got ${r.category}`);
    assert.ok(['low', 'unknown'].includes(r.confidence), `got ${r.confidence}`);
  });

  test('a folder with only manifests and node_modules is not called a project', () => {
    const r = classifyProject(meta({
      fileCount: 2,
      roleCounts: { source: 0, unknown: 2 },
      extCounts: { '.json': 2 },
      packageJson: { name: 'tools-rcedit', main: 'index.js', dependencies: depsOf(['rcedit']) },
    }), {});
    assert.equal(r.category, 'uncategorized', `got ${r.category}`);
    assert.equal(r.notAProject, true);
    assert.match(r.reasons[0].text, /没有任何源码/);
  });

  test('a manual category always wins and says so', () => {
    const r = classifyProject(meta({ packageJson: { name: 'p', dependencies: depsOf(['electron']) } }), { manualCategory: 'data-pipeline' });
    assert.equal(r.category, 'data-pipeline');
    assert.equal(r.manual, true);
    assert.match(r.reasons[0].text, /手动/);
  });

  test('an unknown manual category falls back to inference instead of throwing', () => {
    const r = classifyProject(meta({ packageJson: { name: 'p', dependencies: depsOf(['electron']) } }), { manualCategory: 'not-a-real-category' });
    assert.equal(r.category, 'desktop-app');
    assert.equal(r.manual, false);
  });
});

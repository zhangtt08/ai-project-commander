/** Temporary runtime probe during development. Not part of the product. */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { App } from '../src/core/app.js';
import { createFixtureProject } from '../src/demo/fixture-factory.js';

const base = path.join(os.tmpdir(), `apc-pipeline-${Date.now()}`);
fs.mkdirSync(base, { recursive: true });
const app = new App({ dataDir: path.join(base, 'data'), logLevel: process.env.LOG || 'info' });
const { dir } = createFixtureProject(path.join(base, 'warning'), 'warning');
const project = app.addProject({ workspacePath: dir, name: 'Warning Fixture' });
console.log('project', project.id);

const out = await app.orchestrator.fullScan(project.id, { runCommands: true, suites: ['unit', 'e2e'] });
console.log('SCAN', {
  files: out.metadata.fileCount,
  health: out.health.status,
  gate: out.gate.result,
  stages: out.stages.length,
  tasks: out.tasks.length,
  criteria: out.criteria.length,
  risks: out.risks.length,
  regressions: out.regressions.length,
  progress: out.progress.percent,
  snapshotSeq: out.snapshot.seq,
  drift: out.drift.verdict,
  durationMs: out.durationMs,
});
console.log('SPECS', out.specs.map((s) => `${s.path}:${(s.parsed.stages || []).length}`).join(','));
console.log('MOCKLEAK', out.metadata.e2eMockLeak);
console.log('GATE', out.gate.result, '|', out.gate.explanation.slice(0, 240));
console.log('HEALTH reasons', out.health.reasons.map((r) => `${r.severity}:${r.code}`).join(', '));
console.log('RISKS', out.risks.map((r) => `${r.severity}:${r.code}`).join(', '));
console.log('STAGES', out.stages.map((s) => `${s.name}=${s.status}`).join(' | '));

const ai = await app.aiService.summarize(project.id);
console.log('AI summary provider', ai.provider, 'fallback', ai.fallbackUsed);
const action = await app.aiService.nextAction(project.id, { engine: app.nextActionEngine });
console.log('NEXT ACTION', action.rule || action.deterministicRule, '|', action.objective);
const prompt = await app.promptGenerator.generate({
  project: app.getProject(project.id), metadata: out.metadata, git: out.git, build: out.build.build,
  unit: out.tests.unit, e2e: out.tests.e2e, nextAction: action, risks: out.risks,
  memory: app.memoryStore.latest(project.id), failedCases: out.failedCases, specs: out.specs,
  criteria: out.criteria, tasks: out.tasks, currentStage: out.currentStage,
});
console.log('PROMPT sections missing:', prompt.sections.missing, 'len', prompt.prompt.length);

// Regression: break the build then rescan.
const { applyRegression } = await import('./src/demo/fixture-factory.js');
applyRegression(dir, 'build');
const out2 = await app.orchestrator.fullScan(project.id, { runCommands: true, suites: ['unit', 'e2e'] });
console.log('SCAN2', { health: out2.health.status, gate: out2.gate.result, regressions: out2.regressions.map((r) => r.type) });

const dash = app.dashboard();
console.log('DASHBOARD', JSON.stringify(dash.counts));
console.log('ATTENTION', app.attentionCenter().items.map((i) => `${i.severity}:${i.kind}`).join(', '));

app.close();
console.log('OK ->', base);

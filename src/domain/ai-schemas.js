/**
 * Structured output schemas for every AI call.
 * Every AI response MUST be validated against one of these before use.
 * See ADR-008.
 */
import { s } from './schema.js';
import { CONFIDENCE_VALUES, SEVERITY_VALUES, TASK_PRIORITY_VALUES } from './constants.js';

export const EvidenceRefSchema = s.object({
  type: s.enum(['file', 'test', 'commit', 'spec', 'command', 'diff', 'snapshot', 'task', 'risk', 'session']),
  ref: s.string({ min: 1, max: 500 }),
  note: s.string({ max: 500 }).optional().default(''),
});

export const ConfidenceSchema = s.enum(CONFIDENCE_VALUES).default('unknown');

export const ProjectSummarySchema = s.object({
  summary: s.string({ min: 1, max: 4000 }).describe('What this project is, in 2-4 sentences'),
  purpose: s.string({ max: 1000 }).optional().default(''),
  currentStageGuess: s.string({ max: 200 }).optional().default(''),
  technologies: s.array(s.string({ max: 80 }), { max: 30 }).optional().default([]),
  mainModules: s.array(s.string({ max: 200 }), { max: 30 }).optional().default([]),
  confidence: ConfidenceSchema,
  evidence: s.array(EvidenceRefSchema, { max: 30 }).optional().default([]),
});

export const RiskAnalysisSchema = s.object({
  risks: s.array(
    s.object({
      title: s.string({ min: 1, max: 200 }),
      severity: s.enum(SEVERITY_VALUES),
      description: s.string({ max: 2000 }),
      suggestedAction: s.string({ max: 1000 }).optional().default(''),
      confidence: ConfidenceSchema,
      evidence: s.array(EvidenceRefSchema, { max: 20 }).optional().default([]),
    }),
    { max: 40 },
  ),
});

export const TaskExtractionSchema = s.object({
  tasks: s.array(
    s.object({
      title: s.string({ min: 1, max: 300 }),
      description: s.string({ max: 2000 }).optional().default(''),
      priority: s.enum(TASK_PRIORITY_VALUES).default('p2'),
      stage: s.string({ max: 200 }).optional().default(''),
      confidence: ConfidenceSchema,
      evidence: s.array(EvidenceRefSchema, { max: 20 }).optional().default([]),
    }),
    { max: 100 },
  ),
});

export const NextActionSchema = s.object({
  objective: s.string({ min: 1, max: 500 }),
  reason: s.string({ min: 1, max: 2000 }),
  scope: s.array(s.string({ max: 300 }), { max: 30 }).optional().default([]),
  relevantFiles: s.array(s.string({ max: 300 }), { max: 50 }).optional().default([]),
  constraints: s.array(s.string({ max: 400 }), { max: 30 }).optional().default([]),
  acceptanceCriteria: s.array(s.string({ max: 400 }), { max: 30 }).optional().default([]),
  verificationCommands: s.array(s.string({ max: 300 }), { max: 30 }).optional().default([]),
  risks: s.array(s.string({ max: 400 }), { max: 30 }).optional().default([]),
  priority: s.enum(['p0', 'p1', 'p2', 'p3']).default('p1'),
  confidence: ConfidenceSchema,
  evidence: s.array(EvidenceRefSchema, { max: 30 }).optional().default([]),
});

export const StageInferenceSchema = s.object({
  stages: s.array(
    s.object({
      name: s.string({ min: 1, max: 200 }),
      description: s.string({ max: 1000 }).optional().default(''),
      status: s.enum(['not_started', 'in_progress', 'blocked', 'completed']).default('not_started'),
      confidence: ConfidenceSchema,
      evidence: s.array(EvidenceRefSchema, { max: 20 }).optional().default([]),
    }),
    { max: 40 },
  ),
});

export const ChangeClassificationSchema = s.object({
  changes: s.array(
    s.object({
      path: s.string({ min: 1, max: 500 }),
      kind: s.enum(['feature', 'fix', 'refactor', 'test', 'docs', 'config', 'unknown']),
      rationale: s.string({ max: 500 }).optional().default(''),
      confidence: ConfidenceSchema,
    }),
    { max: 200 },
  ),
});

export const DriftAnalysisSchema = s.object({
  drifts: s.array(
    s.object({
      title: s.string({ min: 1, max: 300 }),
      description: s.string({ max: 2000 }),
      severity: s.enum(SEVERITY_VALUES),
      requirementRef: s.string({ max: 300 }).optional().default(''),
      confidence: ConfidenceSchema,
      evidence: s.array(EvidenceRefSchema, { max: 20 }).optional().default([]),
    }),
    { max: 40 },
  ),
  verdict: s.enum(['aligned', 'possible_drift', 'unknown']).default('unknown'),
});

export const AgentPromptSchema = s.object({
  title: s.string({ min: 1, max: 200 }),
  prompt: s.string({ min: 1, max: 20000 }),
  completionRequirements: s.array(s.string({ max: 400 }), { max: 20 }).optional().default([]),
  confidence: ConfidenceSchema,
});

export const HANDOFF_SECTIONS = Object.freeze([
  'Project Summary',
  'Architecture',
  'Current Stage',
  'Completed Work',
  'Current Task',
  'Known Issues',
  'Relevant Files',
  'Tests',
  'Next Action',
  'Constraints',
  'Verification',
]);

export const REQUIRED_PROMPT_SECTIONS = Object.freeze([
  'PROJECT CONTEXT',
  'CURRENT STATE',
  'OBJECTIVE',
  'RELEVANT FILES',
  'KNOWN FAILURES',
  'CONSTRAINTS',
  'DO NOT BREAK',
  'ACCEPTANCE CRITERIA',
  'VERIFICATION COMMANDS',
  'COMPLETION REQUIREMENTS',
]);

export const AI_SCHEMAS = Object.freeze({
  projectSummary: ProjectSummarySchema,
  riskAnalysis: RiskAnalysisSchema,
  taskExtraction: TaskExtractionSchema,
  nextAction: NextActionSchema,
  stageInference: StageInferenceSchema,
  changeClassification: ChangeClassificationSchema,
  driftAnalysis: DriftAnalysisSchema,
  agentPrompt: AgentPromptSchema,
});

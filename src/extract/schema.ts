import { z } from 'zod';

// Bumping this invalidates the extraction cache by design (ARCHITECTURE §6).
export const SCHEMA_VERSION = 4;

export const DocType = z
  .string()
  .min(1)
  .describe('spec|plan|adr|session_log|backtest_report|test_report|research_note|incident|readme|changelog|other or a repo-specific type');

export const DateEvent = z.object({
  date: z.string(), // ISO-ish; validated loosely, normalized downstream
  precision: z.enum(['day', 'month', 'year', 'unknown']).default('day'),
  source: z.enum(['content', 'git']).default('content'),
  event: z.string().min(1),
});

export const Metric = z.object({
  name: z.string().min(1),
  value: z.number(),
  unit: z.string().default('unknown'),
  context: z.string().default(''),
  quote: z.string().default(''),
});

export const Decision = z.object({
  decision: z.string().min(1),
  alternatives: z.array(z.string()).default([]),
  rationale: z.string().default(''),
  status: z.enum(['proposed', 'adopted', 'rejected', 'superseded', 'unknown']).default('unknown'),
  quote: z.string().min(1),
});

export const FeatureMention = z.object({
  name: z.string().min(1),
  documented_status: z
    .enum(['planned', 'in_progress', 'shipped', 'abandoned', 'unknown'])
    .default('unknown'),
  evidence: z.string().default(''),
  quote: z.string().min(1),
  code_entities: z.array(z.string()).default([]),
});

export const MermaidBlock = z.object({
  kind: z.string().default('unknown'),
  nodes: z.number().int().nonnegative().default(0),
  edges: z.number().int().nonnegative().default(0),
  digest: z.string().default(''),
});

// What the model is asked to return per file. Kept lenient with defaults so a
// slightly-off response still validates instead of triggering a repair round.
export const ExtractionModelOutput = z.object({
  doc_type: DocType,
  type_confidence: z.number().min(0).max(1).default(0.5),
  title: z.string().default(''),
  summary: z.string().default(''),
  dates: z.array(DateEvent).default([]),
  metrics: z.array(Metric).default([]),
  decisions: z.array(Decision).default([]),
  features: z.array(FeatureMention).default([]),
  entities: z.array(z.string()).default([]),
  open_loops: z.array(z.string()).default([]),
  links: z.array(z.string()).default([]),
  mermaid: z.array(MermaidBlock).default([]),
});
export type ExtractionModelOutput = z.infer<typeof ExtractionModelOutput>;

// The full cached record adds provenance the model does not produce.
export interface ExtractionRecord extends ExtractionModelOutput {
  schema_version: number;
  file: string;
  content_hash: string;
  extracted_at: string;
  model: string;
  extraction_failed?: boolean;
  failure_reason?: string;
  raw_output?: string;
}

export const GroundingSchema = z.object({
  project_purpose: z.string().default(''),
  domain_glossary: z
    .array(z.object({ term: z.string(), meaning: z.string().default('') }))
    .default([]),
  stack: z.array(z.string()).default([]),
  module_names: z.array(z.string()).default([]),
  doc_conventions: z.array(z.string()).default([]),
  extra_doc_types: z.array(z.string()).default([]),
});
export type Grounding = z.infer<typeof GroundingSchema>;

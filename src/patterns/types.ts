// Pattern adapters teach mdpulse the conventional, typed artifact layouts that
// spec-driven-development tools impose (GitHub Spec Kit, AWS Kiro, OpenSpec,
// the AGENTS.md convention). Instead of treating every file as free-form
// markdown, an adapter recognizes a repo's convention and derives *typed*
// artifacts plus real management stats — spec coverage, task completion,
// requirement->task traceability — deterministically, with no model calls.
// This is the "management stats derived from typed agent artifacts" layer.

export interface TaskStat {
  total: number;
  done: number;
}

// One recognized artifact within a pattern (a spec, plan, tasks file, etc.).
export interface PatternArtifact {
  path: string; // repo-relative
  artifactType: string; // spec | plan | tasks | requirements | design | constitution | change | capability | agents_config | steering ...
  feature?: string; // grouping key: the feature/spec/change/capability this belongs to
  tasks?: TaskStat; // checklist completion, when the artifact is a task list
  requirementIds?: string[]; // e.g. EARS / numbered requirement identifiers
  testLinks?: string[]; // links to tests / verification (coverage evidence)
  scope?: string; // for config artifacts: the directory the file governs
}

// Per-feature (or per-change/capability) coverage rollup.
export interface FeatureCoverage {
  name: string;
  stages: Record<string, boolean>; // which required artifacts exist, e.g. { spec:true, plan:false, tasks:true }
  tasks: TaskStat;
  requirementCount: number;
  tracedRequirements: number; // requirements referenced by at least one task
  hasTests: boolean;
  percentComplete: number; // 0..100, real, from artifact state
  artifacts: string[]; // contributing file paths
}

export interface PatternDetection {
  id: string; // 'spec-kit'
  name: string; // 'GitHub Spec Kit'
  detected: boolean;
  markers: string[]; // evidence paths that triggered detection
  artifacts: PatternArtifact[];
  features: FeatureCoverage[];
  overallPercentComplete: number; // task-weighted across features
  // Deterministic doc_type hints: repo-relative path -> artifactType, applied
  // to extraction records so the taxonomy reflects the pattern's typing.
  typeHints: Record<string, string>;
  notes: string[]; // human-readable summary lines for the dashboard
}

export interface PatternAdapter {
  id: string;
  name: string;
  // Inspect the tree (directly on disk, so gitignored artifacts still count)
  // and return a detection, or null if this pattern is not present.
  detect(root: string): PatternDetection | null;
}

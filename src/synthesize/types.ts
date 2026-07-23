// Shape of the synthesized artifacts the renderer consumes. Every user-facing
// item carries `sources` (file + optional heading/line) so the renderer can
// enforce "every claim is cited or it does not ship" (Design principle 4).

export interface SourceRef {
  file: string;
  quote?: string;
  date?: string;
}

export interface TimelineEvent {
  date: string; // YYYY-MM-DD
  precision: 'day' | 'month' | 'year' | 'unknown';
  event: string;
  kind: 'decision' | 'milestone' | 'result' | 'activity';
  sources: SourceRef[];
}

export interface TimelineMonth {
  month: string; // YYYY-MM
  narrative: string;
  events: TimelineEvent[];
}

export interface Timeline {
  months: TimelineMonth[];
  activity: { month: string; commits: number; docs: number }[];
}

export type FeatureBadge =
  | 'confirmed_shipped'
  | 'doc_drift'
  | 'implemented_undocumented'
  | 'planned_no_impl'
  | 'contradiction'
  | 'unverified';

export interface Feature {
  name: string;
  documented_status: 'planned' | 'in_progress' | 'shipped' | 'abandoned' | 'stale' | 'unknown';
  code_status: 'present' | 'absent' | 'not_verifiable';
  badge: FeatureBadge;
  latest_evidence: string | null;
  code_entities: string[];
  code_citations: string[];
  sources: SourceRef[];
}

export interface MetricSeries {
  metric_name: string;
  unit: string;
  regression_flagged: boolean;
  points: { date: string; value: number; file: string; quote: string; context: string }[];
}

export interface ArchSnapshot {
  date: string | null;
  file: string;
  title: string;
  kind: string;
  digest: string;
  nodes: number;
  edges: number;
  change_note: string;
  sources: SourceRef[];
}

export interface OpenLoop {
  text: string;
  sources: SourceRef[];
}

export interface DigestItem {
  text: string;
}

export interface Synthesis {
  timeline: Timeline;
  features: Feature[];
  results: MetricSeries[];
  architecture: ArchSnapshot[];
  open_loops: OpenLoop[];
  digest: DigestItem[];
  generated_at: string;
}

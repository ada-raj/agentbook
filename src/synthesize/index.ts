import { modelCall } from '../auth/claude.js';
import { extractJson } from '../util.js';
import type { ExtractionRecord } from '../extract/schema.js';
import type { GitFacts } from '../discover/gitfacts.js';
import type { CodeFacts, CodeStatus } from '../codefacts/verify.js';
import type { Config } from '../config.js';
import type { Store } from '../cache/store.js';
import type {
  Synthesis,
  Timeline,
  TimelineEvent,
  Feature,
  FeatureBadge,
  MetricSeries,
  ArchSnapshot,
  OpenLoop,
  DigestItem,
  SourceRef,
} from './types.js';

export async function synthesize(
  extractions: ExtractionRecord[],
  gitFacts: GitFacts,
  codeFacts: CodeFacts,
  cfg: Config,
  store: Store,
): Promise<Synthesis> {
  const generatedAt = new Date().toISOString();
  const live = extractions.filter((e) => !e.extraction_failed);

  const timeline = await buildTimeline(live, gitFacts, cfg);
  const features = buildFeatures(live, codeFacts);
  const results = buildResults(live);
  const architecture = await buildArchitecture(live, cfg);
  const open_loops = buildOpenLoops(live);

  const prev = store.readJson<Synthesis>('synth/_prev.json');
  const digest = await buildDigest(prev, { features, timeline, results }, cfg);

  const synth: Synthesis = {
    timeline,
    features,
    results,
    architecture,
    open_loops,
    digest,
    generated_at: generatedAt,
  };

  store.writeJson('synth/timeline.json', timeline);
  store.writeJson('synth/features.json', features);
  store.writeJson('synth/results.json', results);
  store.writeJson('synth/architecture.json', architecture);
  store.writeJson('synth/open_loops.json', open_loops);
  store.writeJson('synth/digest.json', digest);
  store.writeJson('synth/_prev.json', synth);
  return synth;
}

// ---- Timeline -----------------------------------------------------------

function latestDate(ex: ExtractionRecord, git: GitFacts): string | null {
  const contentDates = ex.dates.map((d) => normDate(d.date)).filter(Boolean) as string[];
  if (contentDates.length) return contentDates.sort().pop()!;
  const gf = git.perFile.get(baseFile(ex.file));
  return gf?.last ? gf.last.slice(0, 10) : null;
}

async function buildTimeline(
  extractions: ExtractionRecord[],
  git: GitFacts,
  cfg: Config,
): Promise<Timeline> {
  const events: TimelineEvent[] = [];
  for (const ex of extractions) {
    for (const d of ex.dates) {
      const date = normDate(d.date);
      if (!date) continue;
      events.push({
        date,
        precision: d.precision,
        event: d.event,
        kind: classifyEvent(ex.doc_type, d.event),
        sources: [{ file: ex.file, date }],
      });
    }
  }

  // Dedup near-duplicate events (within 3 days, similar text), keep both sources.
  const deduped = dedupeEvents(events);

  // Activity heat strip from git dates.
  const activityMap = new Map<string, { commits: number; docs: number }>();
  for (const [, gf] of git.perFile) {
    if (gf.last) {
      const m = gf.last.slice(0, 7);
      const a = activityMap.get(m) ?? { commits: 0, docs: 0 };
      a.commits += gf.commitCount;
      a.docs += 1;
      activityMap.set(m, a);
    }
  }
  const activity = Array.from(activityMap.entries())
    .map(([month, v]) => ({ month, ...v }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // Group by month.
  const byMonth = new Map<string, TimelineEvent[]>();
  for (const e of deduped) {
    const m = e.date.slice(0, 7);
    (byMonth.get(m) ?? byMonth.set(m, []).get(m)!).push(e);
  }
  const months = Array.from(byMonth.keys()).sort();

  // One model call narrates all months from the structured events (bounded input).
  const narratives = await narrateMonths(months, byMonth, cfg);

  return {
    months: months.map((month) => ({
      month,
      narrative: narratives[month] ?? '',
      events: (byMonth.get(month) ?? []).sort((a, b) => a.date.localeCompare(b.date)),
    })),
    activity,
  };
}

async function narrateMonths(
  months: string[],
  byMonth: Map<string, TimelineEvent[]>,
  cfg: Config,
): Promise<Record<string, string>> {
  if (!months.length) return {};
  const input = months
    .map((m) => {
      const evs = (byMonth.get(m) ?? []).map((e) => `- [${e.kind}] ${e.event}`).join('\n');
      return `## ${m}\n${evs}`;
    })
    .join('\n\n')
    .slice(0, 60_000);
  const prompt = `Below are project events grouped by month, extracted from a repository's markdown. For each month, write ONE factual sentence summarizing what happened. Do not invent anything not in the events.\n\nReturn JSON: { "months": { "YYYY-MM": "one sentence", ... } }\n\nEVENTS:\n${input}\n\nOutput JSON now.`;
  try {
    const raw = await modelCall(prompt, {
      model: cfg.synthModel,
      system: 'You summarize project timelines factually. Output only JSON.',
      timeoutMs: 180_000,
    });
    const parsed = extractJson<{ months: Record<string, string> }>(raw);
    return parsed.months ?? {};
  } catch {
    return {}; // fail visibly: months render with events, no narrative
  }
}

function classifyEvent(docType: string, event: string): TimelineEvent['kind'] {
  const t = event.toLowerCase();
  if (/decid|adopt|chose|switch|pivot|migrat/.test(t)) return 'decision';
  if (/ship|launch|releas|merg|complet|done/.test(t)) return 'milestone';
  if (docType.includes('backtest') || docType.includes('test') || /result|benchmark|win rate|passed|failed/.test(t))
    return 'result';
  return 'activity';
}

function dedupeEvents(events: TimelineEvent[]): TimelineEvent[] {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const out: TimelineEvent[] = [];
  for (const e of sorted) {
    const dup = out.find(
      (o) =>
        Math.abs(daysBetween(o.date, e.date)) <= 3 &&
        similar(o.event, e.event),
    );
    if (dup) {
      for (const s of e.sources) if (!dup.sources.some((x) => x.file === s.file)) dup.sources.push(s);
    } else {
      out.push({ ...e, sources: [...e.sources] });
    }
  }
  return out;
}

// ---- Features + status matrix ------------------------------------------

function buildFeatures(extractions: ExtractionRecord[], code: CodeFacts): Feature[] {
  interface Agg {
    name: string;
    statuses: { status: string; date: string | null; file: string; quote: string }[];
    entities: Set<string>;
    sources: SourceRef[];
  }
  const groups = new Map<string, Agg>();
  for (const ex of extractions) {
    const fileDate = latestContentDate(ex);
    for (const f of ex.features) {
      const key = f.name.trim().toLowerCase();
      if (!key) continue;
      const g =
        groups.get(key) ??
        groups.set(key, { name: f.name.trim(), statuses: [], entities: new Set(), sources: [] }).get(key)!;
      g.statuses.push({ status: f.documented_status, date: fileDate, file: ex.file, quote: f.quote });
      for (const e of f.code_entities) g.entities.add(e);
      g.sources.push({ file: ex.file, quote: f.quote, date: fileDate ?? undefined });
    }
  }

  const features: Feature[] = [];
  for (const g of groups.values()) {
    const documented = resolveDocumentedStatus(g.statuses);
    const codeStatus = resolveCodeStatus(Array.from(g.entities), code);
    const citations = collectCitations(Array.from(g.entities), code);
    const latest = g.statuses
      .map((s) => s.date)
      .filter(Boolean)
      .sort()
      .pop() as string | undefined;
    features.push({
      name: g.name,
      documented_status: documented,
      code_status: codeStatus,
      badge: resolveBadge(documented, codeStatus),
      latest_evidence: latest ?? null,
      code_entities: Array.from(g.entities),
      code_citations: citations,
      sources: g.sources.slice(0, 8),
    });
  }
  // Order: actionable badges first, then alphabetical for stability.
  const badgeRank: Record<FeatureBadge, number> = {
    doc_drift: 0,
    contradiction: 1,
    planned_no_impl: 2,
    implemented_undocumented: 3,
    confirmed_shipped: 4,
    unverified: 5,
  };
  features.sort((a, b) => badgeRank[a.badge] - badgeRank[b.badge] || a.name.localeCompare(b.name));
  return features;
}

function resolveDocumentedStatus(
  statuses: { status: string; date: string | null }[],
): Feature['documented_status'] {
  // Latest-dated evidence wins; abandoned requires explicit evidence.
  const dated = statuses
    .filter((s) => s.date)
    .sort((a, b) => (a.date! < b.date! ? -1 : 1));
  const latest = (dated.length ? dated[dated.length - 1] : statuses[statuses.length - 1])?.status;
  if (statuses.some((s) => s.status === 'abandoned')) {
    // abandoned only wins if it is the latest signal
    if (latest === 'abandoned') return 'abandoned';
  }
  const rank = ['unknown', 'planned', 'in_progress', 'shipped'];
  // If undated, take the strongest documented status.
  if (!dated.length) {
    const best = statuses
      .map((s) => s.status)
      .filter((s) => rank.includes(s))
      .sort((a, b) => rank.indexOf(a) - rank.indexOf(b))
      .pop();
    return (best as Feature['documented_status']) ?? 'unknown';
  }
  return (latest as Feature['documented_status']) ?? 'unknown';
}

function resolveCodeStatus(entities: string[], code: CodeFacts): CodeStatus {
  const verdicts = entities.map((e) => code.entities[e]).filter(Boolean);
  if (!verdicts.length) return 'not_verifiable';
  if (verdicts.some((v) => v.status === 'present')) return 'present';
  if (verdicts.every((v) => v.status === 'not_verifiable')) return 'not_verifiable';
  if (verdicts.some((v) => v.status === 'absent')) return 'absent';
  return 'not_verifiable';
}

function collectCitations(entities: string[], code: CodeFacts): string[] {
  const cites = new Set<string>();
  for (const e of entities) {
    const v = code.entities[e];
    if (v) for (const c of v.citations) cites.add(c);
  }
  return Array.from(cites).slice(0, 6);
}

// Status matrix (ARCHITECTURE §8).
function resolveBadge(
  documented: Feature['documented_status'],
  code: CodeStatus,
): FeatureBadge {
  if (code === 'not_verifiable') return 'unverified';
  const shipped = documented === 'shipped';
  const planned = documented === 'planned' || documented === 'in_progress';
  const abandoned = documented === 'abandoned';
  if (shipped && code === 'present') return 'confirmed_shipped';
  if (shipped && code === 'absent') return 'doc_drift';
  if (planned && code === 'present') return 'implemented_undocumented';
  if (planned && code === 'absent') return 'planned_no_impl';
  if (abandoned && code === 'present') return 'contradiction';
  return 'unverified';
}

// ---- Results ------------------------------------------------------------

function buildResults(extractions: ExtractionRecord[]): MetricSeries[] {
  const series = new Map<string, MetricSeries>();
  for (const ex of extractions) {
    const date = latestContentDate(ex) ?? ex.extracted_at.slice(0, 10);
    for (const m of ex.metrics) {
      if (!m.unit || m.unit === 'unknown') continue; // excluded from trend charts
      const key = m.name.trim().toLowerCase();
      const s =
        series.get(key) ??
        series
          .set(key, { metric_name: m.name.trim(), unit: m.unit, regression_flagged: false, points: [] })
          .get(key)!;
      s.points.push({ date, value: m.value, file: ex.file, quote: m.quote, context: m.context });
    }
  }
  const out: MetricSeries[] = [];
  for (const s of series.values()) {
    s.points.sort((a, b) => a.date.localeCompare(b.date));
    s.regression_flagged = flagRegression(s);
    if (s.points.length) out.push(s);
  }
  out.sort((a, b) => a.metric_name.localeCompare(b.metric_name));
  return out;
}

function flagRegression(s: MetricSeries): boolean {
  if (s.points.length < 2) return false;
  const last = s.points[s.points.length - 1].value;
  const prev = s.points[s.points.length - 2].value;
  // Heuristic: for "loss/drawdown/error/latency" higher is worse; else lower is worse.
  const higherWorse = /loss|drawdown|error|latency|p9|p5|fail|dd/i.test(s.metric_name);
  return higherWorse ? last > prev : last < prev;
}

// ---- Architecture -------------------------------------------------------

async function buildArchitecture(
  extractions: ExtractionRecord[],
  cfg: Config,
): Promise<ArchSnapshot[]> {
  const snaps: ArchSnapshot[] = [];
  for (const ex of extractions) {
    for (const mm of ex.mermaid) {
      snaps.push({
        date: latestContentDate(ex),
        file: ex.file,
        title: ex.title || ex.file,
        kind: mm.kind,
        digest: mm.digest,
        nodes: mm.nodes,
        edges: mm.edges,
        change_note: '',
        sources: [{ file: ex.file }],
      });
    }
  }
  snaps.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));

  // Narrate what changed between consecutive diagrams (one model call).
  if (snaps.length >= 2) {
    const seq = snaps
      .map((s, i) => `${i + 1}. [${s.date ?? 'undated'}] ${s.file}: ${s.digest || s.kind}`)
      .join('\n')
      .slice(0, 40_000);
    try {
      const raw = await modelCall(
        `These are architecture diagrams in chronological order. For each after the first, write ONE sentence on what changed vs the previous. Return JSON: { "notes": ["", "changed X", ...] } with one entry per diagram (first is "").\n\n${seq}\n\nOutput JSON now.`,
        { model: cfg.synthModel, system: 'You narrate architecture evolution factually. JSON only.', timeoutMs: 120_000 },
      );
      const notes = extractJson<{ notes: string[] }>(raw).notes ?? [];
      snaps.forEach((s, i) => (s.change_note = notes[i] ?? ''));
    } catch {
      /* fail visibly: no change notes */
    }
  }
  return snaps;
}

// ---- Open loops ---------------------------------------------------------

function buildOpenLoops(extractions: ExtractionRecord[]): OpenLoop[] {
  const map = new Map<string, OpenLoop>();
  for (const ex of extractions) {
    for (const l of ex.open_loops) {
      const key = l.trim().toLowerCase();
      if (!key) continue;
      const o = map.get(key) ?? map.set(key, { text: l.trim(), sources: [] }).get(key)!;
      if (!o.sources.some((s) => s.file === ex.file)) o.sources.push({ file: ex.file });
    }
  }
  return Array.from(map.values());
}

// ---- Digest -------------------------------------------------------------

async function buildDigest(
  prev: Synthesis | null,
  cur: { features: Feature[]; timeline: Timeline; results: MetricSeries[] },
  cfg: Config,
): Promise<DigestItem[]> {
  if (!prev) {
    return [{ text: `First run: ${cur.features.length} features, ${cur.timeline.months.length} months of history, ${cur.results.length} metric series indexed.` }];
  }
  const prevFeat = new Set(prev.features.map((f) => f.name.toLowerCase()));
  const newFeatures = cur.features.filter((f) => !prevFeat.has(f.name.toLowerCase()));
  const changes: string[] = [];
  for (const f of newFeatures.slice(0, 10)) changes.push(`New feature detected: ${f.name} (${f.badge})`);
  const regressions = cur.results.filter((r) => r.regression_flagged).map((r) => r.metric_name);
  if (regressions.length) changes.push(`Regression flagged: ${regressions.join(', ')}`);
  if (!changes.length) changes.push('No material changes since the last run.');

  try {
    const raw = await modelCall(
      `Summarize these changes since the last run into up to 5 crisp bullets. Return JSON { "bullets": [string] }.\n\n${changes.join('\n')}\n\nJSON now.`,
      { model: cfg.synthModel, system: 'You write concise changelogs. JSON only.', timeoutMs: 60_000 },
    );
    const bullets = extractJson<{ bullets: string[] }>(raw).bullets ?? changes;
    return bullets.slice(0, 5).map((text) => ({ text }));
  } catch {
    return changes.slice(0, 5).map((text) => ({ text }));
  }
}

// ---- helpers ------------------------------------------------------------

function baseFile(file: string): string {
  const i = file.indexOf('#mermaid-');
  return i === -1 ? file : file.slice(0, i);
}

function latestContentDate(ex: ExtractionRecord): string | null {
  const ds = ex.dates.map((d) => normDate(d.date)).filter(Boolean) as string[];
  return ds.length ? ds.sort().pop()! : null;
}

function normDate(d: string): string | null {
  if (!d) return null;
  const s = d.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-01`;
  m = s.match(/^(\d{4})$/);
  if (m) return `${m[1]}-01-01`;
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return null;
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(a) - Date.parse(b)) / 86_400_000;
}

function similar(a: string, b: string): boolean {
  const wa = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const wb = new Set(b.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  if (!wa.size || !wb.size) return a.toLowerCase() === b.toLowerCase();
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  const union = new Set([...wa, ...wb]).size;
  return inter / union >= 0.5;
}

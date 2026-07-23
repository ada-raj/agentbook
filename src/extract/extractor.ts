import { modelCall } from '../auth/claude.js';
import { extractJson, estimateTokens } from '../util.js';
import {
  ExtractionModelOutput,
  SCHEMA_VERSION,
  type ExtractionRecord,
  type Grounding,
} from './schema.js';
import { EXTRACTION_SYSTEM, buildExtractionPrompt, compactGrounding } from './prompts.js';
import type { DiscoveredFile } from '../discover/scanner.js';
import type { Config } from '../config.js';
import type { Store } from '../cache/store.js';
import { pMap } from '../util.js';

const BASE_TAXONOMY = [
  'spec',
  'plan',
  'adr',
  'session_log',
  'backtest_report',
  'test_report',
  'research_note',
  'incident',
  'readme',
  'changelog',
  'skill',
  'trace',
  'other',
];

export interface ExtractProgress {
  (done: number, total: number, path: string, failed: boolean): void;
}

export async function extractAll(
  pending: DiscoveredFile[],
  grounding: Grounding,
  cfg: Config,
  store: Store,
  onProgress?: ExtractProgress,
): Promise<{ ok: number; failed: number }> {
  const groundingBlock = compactGrounding(grounding);
  const taxonomy = [...BASE_TAXONOMY, ...grounding.extra_doc_types].filter(
    (v, i, a) => a.indexOf(v) === i,
  );

  let ok = 0;
  let failed = 0;
  let done = 0;

  await pMap(pending, cfg.concurrency, async (file) => {
    // Resume-safety: another concurrent-run may have already produced this.
    const existing = store.readExtraction(file.shortHash);
    if (
      existing &&
      existing.schema_version === SCHEMA_VERSION &&
      existing.model === cfg.extractModel &&
      existing.content_hash === file.hash &&
      !existing.extraction_failed
    ) {
      done++;
      ok++;
      onProgress?.(done, pending.length, file.path, false);
      return;
    }

    const rec = await extractOne(file, groundingBlock, taxonomy, cfg);
    store.writeExtraction(file.shortHash, rec);
    done++;
    if (rec.extraction_failed) failed++;
    else ok++;
    onProgress?.(done, pending.length, file.path, !!rec.extraction_failed);
  });

  return { ok, failed };
}

async function extractOne(
  file: DiscoveredFile,
  groundingBlock: string,
  taxonomy: string[],
  cfg: Config,
): Promise<ExtractionRecord> {
  const base = {
    schema_version: SCHEMA_VERSION,
    file: file.path,
    content_hash: file.hash,
    extracted_at: '1970-01-01T00:00:00Z', // set below via env-independent stamp
    model: cfg.extractModel,
  };
  const extractedAt = new Date().toISOString();

  try {
    let output: ExtractionModelOutput;
    if (estimateTokens(file.content) > cfg.chunkTokens) {
      output = await extractChunked(file, groundingBlock, taxonomy, cfg);
    } else {
      output = await extractSingle(file.path, file.content, groundingBlock, taxonomy, cfg);
    }
    const cleaned = verifyQuotes(output, file.content);
    return { ...base, ...cleaned, extracted_at: extractedAt };
  } catch (err: any) {
    return {
      ...base,
      extracted_at: extractedAt,
      doc_type: 'other',
      type_confidence: 0,
      title: file.path,
      summary: '',
      dates: [],
      metrics: [],
      decisions: [],
      features: [],
      entities: [],
      open_loops: [],
      links: [],
      mermaid: [],
      extraction_failed: true,
      failure_reason: String(err?.message ?? err).slice(0, 500),
    };
  }
}

async function extractSingle(
  path: string,
  content: string,
  groundingBlock: string,
  taxonomy: string[],
  cfg: Config,
): Promise<ExtractionModelOutput> {
  const prompt = buildExtractionPrompt(groundingBlock, taxonomy, path, content);
  const raw = await modelCall(prompt, {
    model: cfg.extractModel,
    system: EXTRACTION_SYSTEM,
    timeoutMs: 120_000,
  });
  try {
    return ExtractionModelOutput.parse(extractJson(raw));
  } catch (zerr: any) {
    // One repair retry (ARCHITECTURE §5).
    const repairPrompt = `Your previous output failed validation.\nError: ${String(zerr.message).slice(0, 800)}\n\nPrevious output:\n${raw.slice(0, 6000)}\n\nReturn ONLY corrected JSON matching the required schema. No prose, no fences.`;
    const repaired = await modelCall(repairPrompt, {
      model: cfg.extractModel,
      system: EXTRACTION_SYSTEM,
      timeoutMs: 120_000,
    });
    return ExtractionModelOutput.parse(extractJson(repaired));
  }
}

// Split oversized docs on heading boundaries, extract each, merge in code.
async function extractChunked(
  file: DiscoveredFile,
  groundingBlock: string,
  taxonomy: string[],
  cfg: Config,
): Promise<ExtractionModelOutput> {
  const chunks = chunkByHeadings(file.content, cfg.chunkTokens);
  const parts = await pMap(chunks, Math.min(cfg.concurrency, 3), (chunk, i) =>
    extractSingle(`${file.path} (chunk ${i + 1}/${chunks.length})`, chunk, groundingBlock, taxonomy, cfg),
  );
  return mergeExtractions(parts);
}

export function chunkByHeadings(content: string, chunkTokens: number): string[] {
  const lines = content.split('\n');
  const sections: string[] = [];
  let cur: string[] = [];
  for (const line of lines) {
    if (/^#{1,3}\s/.test(line) && cur.length) {
      sections.push(cur.join('\n'));
      cur = [];
    }
    cur.push(line);
  }
  if (cur.length) sections.push(cur.join('\n'));

  // Greedily pack sections up to the token budget, with small overlap.
  const chunks: string[] = [];
  let buf = '';
  for (const sec of sections) {
    if (buf && estimateTokens(buf + '\n' + sec) > chunkTokens) {
      chunks.push(buf);
      const tail = buf.split('\n').slice(-3).join('\n'); // ~overlap
      buf = tail + '\n' + sec;
    } else {
      buf = buf ? buf + '\n' + sec : sec;
    }
  }
  if (buf) chunks.push(buf);
  return chunks.length ? chunks : [content];
}

function mergeExtractions(parts: ExtractionModelOutput[]): ExtractionModelOutput {
  const best = parts.reduce((a, b) => (b.type_confidence > a.type_confidence ? b : a), parts[0]);
  const dedupe = <T>(arr: T[], key: (x: T) => string): T[] => {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const x of arr) {
      const k = key(x);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(x);
    }
    return out;
  };
  return {
    doc_type: best.doc_type,
    type_confidence: best.type_confidence,
    title: parts.find((p) => p.title)?.title ?? '',
    summary: parts.map((p) => p.summary).filter(Boolean).join(' '),
    dates: dedupe(parts.flatMap((p) => p.dates), (d) => d.date + '|' + d.event),
    metrics: dedupe(parts.flatMap((p) => p.metrics), (m) => m.name + '|' + m.value + '|' + m.quote),
    decisions: dedupe(parts.flatMap((p) => p.decisions), (d) => d.decision),
    features: dedupe(parts.flatMap((p) => p.features), (f) => f.name.toLowerCase()),
    entities: dedupe(parts.flatMap((p) => p.entities), (e) => e.toLowerCase()),
    open_loops: dedupe(parts.flatMap((p) => p.open_loops), (o) => o.toLowerCase()),
    links: dedupe(parts.flatMap((p) => p.links), (l) => l),
    mermaid: parts.flatMap((p) => p.mermaid),
  };
}

// Enforce the "quote must be verbatim" rule in code, not on trust
// (ARCHITECTURE §6). A feature/decision whose quote is not present is dropped;
// a metric with a bad quote keeps the number but clears the quote.
function verifyQuotes(o: ExtractionModelOutput, source: string): ExtractionModelOutput {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const hay = norm(source);
  const present = (q: string) => q.length > 0 && hay.includes(norm(q));

  return {
    ...o,
    features: o.features.filter((f) => present(f.quote)),
    decisions: o.decisions.filter((d) => present(d.quote)),
    metrics: o.metrics.map((m) => (present(m.quote) ? m : { ...m, quote: '' })),
  };
}

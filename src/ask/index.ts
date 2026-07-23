import { modelCall } from '../auth/claude.js';
import type { ExtractionRecord, Grounding } from '../extract/schema.js';
import type { Config } from '../config.js';

// Lexical retrieval over the index (ARCHITECTURE §11). Scores extractions by
// term overlap against query terms expanded with the grounding glossary; takes
// top 20 plus grounding; answers with one Sonnet call requiring citations.

export interface RetrievedDoc {
  file: string;
  score: number;
  summary: string;
  bag: string;
}

export function retrieve(
  query: string,
  extractions: ExtractionRecord[],
  grounding: Grounding,
  k = 20,
): RetrievedDoc[] {
  const qTerms = expandTerms(query, grounding);
  const scored = extractions
    .filter((e) => !e.extraction_failed)
    .map((e) => {
      const bag = docBag(e);
      const bagLower = bag.toLowerCase();
      let score = 0;
      for (const t of qTerms) {
        if (bagLower.includes(t)) score += t.length > 5 ? 2 : 1;
      }
      return { file: e.file, score, summary: e.summary, bag };
    })
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  return scored.slice(0, k);
}

export async function ask(
  query: string,
  extractions: ExtractionRecord[],
  grounding: Grounding,
  cfg: Config,
): Promise<string> {
  const docs = retrieve(query, extractions, grounding, 20);
  if (!docs.length) {
    return 'No relevant documents found in the index for that question.';
  }
  const context = docs
    .map((d, i) => `[${i + 1}] ${d.file}\n${d.bag.slice(0, 1200)}`)
    .join('\n\n')
    .slice(0, 90_000);
  const prompt = `Answer the question using ONLY the indexed document excerpts below. Cite sources by their [n] file path. If the answer is not in the excerpts, say so.\n\nQUESTION: ${query}\n\nEXCERPTS:\n${context}\n\nAnswer concisely with citations.`;
  return modelCall(prompt, {
    model: cfg.synthModel,
    system: 'You answer questions about a codebase from its extracted markdown index. Always cite the file paths you used. Never invent facts not present in the excerpts.',
    timeoutMs: 120_000,
  });
}

function docBag(e: ExtractionRecord): string {
  return [
    e.title,
    e.summary,
    e.doc_type,
    ...e.entities,
    ...e.features.map((f) => `${f.name} ${f.documented_status}`),
    ...e.decisions.map((d) => d.decision),
    ...e.open_loops,
    ...e.metrics.map((m) => `${m.name} ${m.value}`),
  ].join(' ');
}

function expandTerms(query: string, grounding: Grounding): string[] {
  const terms = new Set(
    query
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
  // Expand with glossary terms whose word appears in the query.
  for (const g of grounding.domain_glossary) {
    const t = g.term.toLowerCase();
    for (const w of terms) if (t.includes(w) || g.meaning.toLowerCase().includes(w)) terms.add(t);
  }
  return Array.from(terms);
}

const STOP = new Set([
  'the', 'and', 'for', 'was', 'when', 'did', 'how', 'what', 'why', 'where', 'who', 'this',
  'that', 'with', 'from', 'into', 'have', 'has', 'are', 'were', 'you', 'your', 'our', 'its',
]);

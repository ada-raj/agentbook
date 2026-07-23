import { buildInventory, grepCodePresence, type Inventory } from './inventory.js';
import type { Store } from '../cache/store.js';
import type { ExtractionRecord, Grounding } from '../extract/schema.js';

export type CodeStatus = 'present' | 'absent' | 'not_verifiable';

export interface EntityVerdict {
  entity: string;
  status: CodeStatus;
  citations: string[]; // file paths where matched
}

export interface CodeFacts {
  head: string | null;
  inventoryPaths: number;
  inventoryIdentifiers: number;
  entities: Record<string, EntityVerdict>; // keyed by entity string
}

// Only identifier-like entities (or glossary-mapped ones) are eligible for
// verification. Prose entities are not_verifiable by design (D8).
export function isIdentifierLike(s: string): boolean {
  const t = s.trim();
  if (!t || /\s/.test(t)) return false;
  return (
    /^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+$/.test(t) || // CamelCase
    /^[a-z][a-zA-Z0-9]*[A-Z]/.test(t) || // camelCase
    /_/.test(t) || // snake_case
    /\./.test(t) || // dotted.path
    /\//.test(t) || // path/like
    /\.\w{1,4}$/.test(t) // filename.ext
  );
}

export function runCodeFacts(
  root: string,
  extractions: ExtractionRecord[],
  grounding: Grounding,
  store: Store,
): CodeFacts {
  const inv = buildInventory(root);

  // Cache keyed by HEAD commit (rebuild is cheap but skip when unchanged).
  const cached = store.readJson<CodeFacts>('cache/codefacts.json');

  // Gather candidate entities from feature code_entities + entities.
  const candidates = new Set<string>();
  for (const ex of extractions) {
    for (const f of ex.features) for (const e of f.code_entities) candidates.add(e);
    for (const e of ex.entities) candidates.add(e);
  }
  // Glossary terms that grounding explicitly maps to symbols are eligible too.
  const glossarySymbols = new Set(
    grounding.domain_glossary
      .map((g) => g.term)
      .filter((t) => isIdentifierLike(t)),
  );

  if (cached && cached.head === inv.head && inv.head) {
    // Ensure any new candidates get verified even on a cache hit.
    let complete = true;
    for (const c of candidates) {
      if (isIdentifierLike(c) && !(c in cached.entities)) {
        complete = false;
        break;
      }
    }
    if (complete) return cached;
  }

  const entities: Record<string, EntityVerdict> = {};
  const grepCache = new Map<string, string[]>();
  for (const c of candidates) {
    const eligible = isIdentifierLike(c) || glossarySymbols.has(c);
    if (!eligible) {
      entities[c] = { entity: c, status: 'not_verifiable', citations: [] };
      continue;
    }
    entities[c] = verifyEntity(c, inv, root, grepCache);
  }

  const facts: CodeFacts = {
    head: inv.head,
    inventoryPaths: inv.paths.length,
    inventoryIdentifiers: inv.identifiers.size,
    entities,
  };
  store.writeJson('cache/codefacts.json', facts);
  return facts;
}

function verifyEntity(
  entity: string,
  inv: Inventory,
  root: string,
  grepCache: Map<string, string[]>,
): EntityVerdict {
  const e = entity.trim();

  // Path-like: check against tracked paths.
  if (e.includes('/') || /\.\w{1,4}$/.test(e)) {
    const hits = inv.paths.filter((p) => p === e || p.endsWith('/' + e) || p.includes(e));
    if (hits.length) return { entity, status: 'present', citations: hits.slice(0, 5) };
    const stem = e.split('/').pop()!.replace(/\.[^.]+$/, '');
    if (inv.pathBasenames.has(stem)) {
      const hits2 = inv.paths.filter((p) => p.split('/').pop()!.replace(/\.[^.]+$/, '') === stem);
      return { entity, status: 'present', citations: hits2.slice(0, 5) };
    }
    // Grep the last path segment as a symbol before concluding absent.
    const seg = e.split(/[/.]/).filter(Boolean).pop();
    const g = seg ? grep(root, seg, grepCache) : [];
    return { entity, status: g.length ? 'present' : 'absent', citations: g };
  }

  // Identifier: exact, then case-insensitive, against declared identifiers.
  if (inv.identifiers.has(e)) {
    return { entity, status: 'present', citations: [] };
  }
  if (inv.identifiersLower.has(e.toLowerCase())) {
    return { entity, status: 'present', citations: [] };
  }
  // Also allow a filename-stem match (a component named after its file).
  if (inv.pathBasenames.has(e)) {
    return { entity, status: 'present', citations: [] };
  }
  // Final, decisive check (§8a step 3): word-boundary git grep across code.
  // Our declared-identifier set is regex-harvested and necessarily incomplete
  // (decorated defs, exports, re-exports); a symbol present anywhere in real
  // code must NEVER be flagged as absent. Precision over recall.
  const hits = grep(root, e, grepCache);
  // Namespaced tokens (a__b__c) also match on their last segment.
  if (!hits.length && /__|\./.test(e)) {
    const seg = e.split(/__|\./).filter(Boolean).pop();
    if (seg && seg !== e) {
      const h2 = grep(root, seg, grepCache);
      if (h2.length) return { entity, status: 'present', citations: h2 };
    }
  }
  return { entity, status: hits.length ? 'present' : 'absent', citations: hits };
}

function grep(root: string, term: string, cache: Map<string, string[]>): string[] {
  const cached = cache.get(term);
  if (cached) return cached;
  const hits = grepCodePresence(root, term);
  cache.set(term, hits);
  return hits;
}

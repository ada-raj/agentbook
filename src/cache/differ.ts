import type { DiscoveredFile } from '../discover/scanner.js';
import type { Store } from './store.js';

export interface PendingSet {
  pending: DiscoveredFile[]; // need a (re)extraction
  cached: DiscoveredFile[]; // already have a valid extraction
}

// Which discovered files lack a valid cached extraction for the current
// (content_hash, schema_version, model)? (ARCHITECTURE §7)
export function computePending(
  files: DiscoveredFile[],
  store: Store,
  schemaVersion: number,
  model: string,
): PendingSet {
  const pending: DiscoveredFile[] = [];
  const cached: DiscoveredFile[] = [];
  for (const f of files) {
    const rec = store.readExtraction(f.shortHash);
    const valid =
      rec &&
      rec.schema_version === schemaVersion &&
      rec.model === model &&
      rec.content_hash === f.hash &&
      !rec.extraction_failed;
    if (valid) cached.push(f);
    else pending.push(f);
  }
  return { pending, cached };
}

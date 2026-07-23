import type { PatternAdapter, PatternDetection } from './types.js';

// The set of pattern adapters mdpulse knows about. Each spec-driven-development
// convention is added here by its own branch; on its own this list is empty and
// pattern detection is a no-op (repos with no recognized convention are
// unaffected).
export const ADAPTERS: PatternAdapter[] = [
  // registered by pattern branches, e.g. specKitAdapter, kiroAdapter, ...
];

// Run every adapter against the repo root and return the patterns that matched.
export function detectPatterns(root: string): PatternDetection[] {
  const out: PatternDetection[] = [];
  for (const adapter of ADAPTERS) {
    try {
      const d = adapter.detect(root);
      if (d && d.detected) out.push(d);
    } catch {
      // A misbehaving adapter must never fail a run (Design principle 5).
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

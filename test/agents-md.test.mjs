// Deterministic test for the AGENTS.md convention adapter (no model calls).
// Run: node test/agents-md.test.mjs
import { agentsMdAdapter } from '../dist/patterns/adapters/agentsMd.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, 'fixtures/agents-md');

let failures = 0;
const eq = (name, a, b) => {
  const pass = JSON.stringify(a) === JSON.stringify(b);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : `  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`}`);
  if (!pass) failures++;
};
const ok = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
};

const d = agentsMdAdapter.detect(root);
ok('detects the pattern', !!d && d.detected);
eq('id', d.id, 'agents-md');
eq('finds 4 config files', d.artifacts.length, 4);
ok('root AGENTS.md is a marker', d.markers.includes('AGENTS.md'));

const rootScope = d.features.find((f) => f.name === 'root');
ok('root scope has both AGENTS and CLAUDE', rootScope.stages.AGENTS && rootScope.stages.CLAUDE);
ok('backend scope present', d.features.some((f) => f.name === 'backend'));
ok('frontend scope present', d.features.some((f) => f.name === 'frontend'));

// Root guidance present -> repo-wide availability = 100%; scoped depth (2/3)
// is preserved as a note rather than the headline.
eq('availability 100% (root guidance present)', d.overallPercentComplete, 100);
ok('notes flag AGENTS/CLAUDE duplication at root', d.notes.some((n) => /both AGENTS.md and CLAUDE.md/.test(n)));
ok('notes report scoped module coverage 2/3', d.notes.some((n) => /2\/3 top-level module/.test(n)));

ok('returns null for a dir with no agent configs', agentsMdAdapter.detect(join(root, 'infra')) === null);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);

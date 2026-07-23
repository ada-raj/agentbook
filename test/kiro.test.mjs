// Deterministic test for the AWS Kiro adapter (no model calls).
// Run: node test/kiro.test.mjs
import { kiroAdapter } from '../dist/patterns/adapters/kiro.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, 'fixtures/kiro');

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

const d = kiroAdapter.detect(root);
ok('detects the pattern', !!d && d.detected);
eq('id', d.id, 'kiro');
ok('steering doc recognized', d.artifacts.some((a) => a.artifactType === 'steering'));
ok('EARS marker present', d.markers.includes('EARS requirements'));

const f = d.features.find((x) => x.name === 'checkout-flow');
ok('finds checkout-flow feature', !!f);
eq('stages requirements+design+tasks', f.stages, { requirements: true, design: true, tasks: true });
eq('tasks 2/3', f.tasks, { total: 3, done: 2 });
eq('percent 67', f.percentComplete, 67);
eq('3 requirements found', f.requirementCount, 3);
ok('all 3 requirements traced to tasks', f.tracedRequirements === 3);
ok('hasTests from design mentioning tests/verification', f.hasTests === true);

ok('returns null for non-Kiro repo', kiroAdapter.detect(join(here, 'fixtures')) === null);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);

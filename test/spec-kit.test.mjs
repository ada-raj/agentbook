// Deterministic test for the Spec Kit adapter (no model calls).
// Run: node test/spec-kit.test.mjs
import { specKitAdapter } from '../dist/patterns/adapters/specKit.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, 'fixtures/spec-kit');

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

const d = specKitAdapter.detect(root);
ok('detects the pattern', !!d && d.detected);
eq('id', d.id, 'spec-kit');
ok('constitution recognized', d.artifacts.some((a) => a.artifactType === 'constitution'));

const auth = d.features.find((f) => f.name === '001-user-auth');
ok('finds user-auth feature', !!auth);
eq('auth tasks 2/4', auth.tasks, { total: 4, done: 2 });
eq('auth percent = 50', auth.percentComplete, 50);
eq('auth stages spec+plan+tasks', auth.stages, { spec: true, plan: true, tasks: true });

const billing = d.features.find((f) => f.name === '002-billing');
ok('finds billing feature', !!billing);
eq('billing has spec, no plan/tasks', billing.stages, { spec: true, plan: false, tasks: false });
ok('billing hasTests via contracts/', billing.hasTests === true);
eq('billing percent = 33 (1 of 3 stages)', billing.percentComplete, 33);

ok('overall percent is task-weighted (2/4 = 50)', d.overallPercentComplete === 50);
ok('typeHints map tasks.md -> tasks', d.typeHints['specs/001-user-auth/tasks.md'] === 'tasks');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);

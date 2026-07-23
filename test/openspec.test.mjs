// Deterministic test for the OpenSpec adapter (no model calls).
// Run: node test/openspec.test.mjs
import { openspecAdapter } from '../dist/patterns/adapters/openspec.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, 'fixtures/openspec');

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

const d = openspecAdapter.detect(root);
ok('detects the pattern', !!d && d.detected);
eq('id', d.id, 'openspec');
ok('project.md recognized', d.artifacts.some((a) => a.artifactType === 'project'));
ok('capability recognized', d.artifacts.some((a) => a.artifactType === 'capability'));

const oauth = d.features.find((f) => f.name === 'add-oauth');
ok('finds add-oauth change', !!oauth);
eq('oauth tasks 2/3', oauth.tasks, { total: 3, done: 2 });
eq('oauth percent 67', oauth.percentComplete, 67);
ok('oauth has spec delta stage', oauth.stages.delta === true);

const mfa = d.features.find((f) => f.name === 'add-mfa');
ok('finds add-mfa change (proposal only)', !!mfa);
ok('mfa has proposal, no tasks', mfa.stages.proposal === true && mfa.stages.tasks === false);

ok('notes mention capabilities + SHALL', d.notes.some((n) => /capability/.test(n) && /SHALL/.test(n)));
ok('returns null for non-OpenSpec repo', openspecAdapter.detect(join(here, 'fixtures')) === null);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);

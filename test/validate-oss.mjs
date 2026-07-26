// Runs the real pattern adapters against cloned OSS repos and prints the
// derived coverage. Deterministic — no model calls.
import { detectPatterns } from '../dist/patterns/registry.js';

const targets = process.argv.slice(2); // list of "label=path"
for (const t of targets) {
  const [label, path] = t.split('=');
  console.log(`\n=== ${label}  (${path}) ===`);
  const pats = detectPatterns(path);
  if (!pats.length) {
    console.log('  no pattern detected');
    continue;
  }
  for (const p of pats) {
    console.log(`  ${p.name}: ${p.overallPercentComplete}% overall · ${p.features.length} features · ${p.artifacts.length} typed artifacts`);
    console.log(`    markers: ${p.markers.join(' | ')}`);
    for (const n of p.notes) console.log(`    note: ${n}`);
    for (const f of p.features.slice(0, 6)) {
      const stages = Object.entries(f.stages).filter(([, v]) => v).map(([k]) => k).join('+');
      const tr = f.requirementCount ? ` req ${f.tracedRequirements}/${f.requirementCount} traced` : '';
      console.log(`      - ${f.name}: ${f.percentComplete}%  [${stages}]  tasks ${f.tasks.done}/${f.tasks.total}${tr}`);
    }
    if (p.features.length > 6) console.log(`      … ${p.features.length - 6} more`);
  }
}

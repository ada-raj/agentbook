import { join } from 'node:path';
import type { PatternAdapter, PatternDetection, PatternArtifact, FeatureCoverage } from '../types.js';
import {
  readFileSafe,
  isDir,
  exists,
  listDirs,
  countCheckboxes,
  computePercent,
  overallPercent,
} from '../coverage.js';

// GitHub Spec Kit (github/spec-kit): the `specify` workflow lays out
//   specs/<NNN-feature>/{spec.md, plan.md, tasks.md, research.md, ...}
//   .specify/memory/constitution.md  (+ .specify/templates)
// Workflow is Specify -> Plan -> Tasks -> Implement, governed by a constitution
// and a cross-artifact consistency/coverage check. We derive per-feature
// completion from the tasks.md checklist and the Specify->Plan->Tasks stages.

const STAGE_FILES: { key: string; file: string }[] = [
  { key: 'spec', file: 'spec.md' },
  { key: 'plan', file: 'plan.md' },
  { key: 'tasks', file: 'tasks.md' },
];

const SUPPORTING = ['research.md', 'data-model.md', 'quickstart.md'];

export const specKitAdapter: PatternAdapter = {
  id: 'spec-kit',
  name: 'GitHub Spec Kit',

  detect(root: string): PatternDetection | null {
    const markers: string[] = [];
    const hasSpecifyDir = isDir(join(root, '.specify'));
    if (hasSpecifyDir) markers.push('.specify/');

    const constitutionPath = firstExisting(root, [
      '.specify/memory/constitution.md',
      'memory/constitution.md',
    ]);
    if (constitutionPath) markers.push(constitutionPath);

    const specsDir = join(root, 'specs');
    const featureDirs = isDir(specsDir)
      ? listDirs(specsDir).filter((d) =>
          STAGE_FILES.some((s) => exists(join(specsDir, d, s.file))),
        )
      : [];
    if (featureDirs.length) markers.push(`specs/ (${featureDirs.length} features)`);

    // Require the constitution or at least one well-formed feature dir; the
    // bare presence of a `specs/` folder is not enough (many repos have one).
    if (!hasSpecifyDir && !constitutionPath && !featureDirs.length) return null;

    const artifacts: PatternArtifact[] = [];
    const typeHints: Record<string, string> = {};
    const features: FeatureCoverage[] = [];

    if (constitutionPath) {
      artifacts.push({ path: constitutionPath, artifactType: 'constitution' });
      typeHints[constitutionPath] = 'constitution';
    }

    for (const dir of featureDirs) {
      const relBase = `specs/${dir}`;
      const stages: Record<string, boolean> = {};
      let tasks = { total: 0, done: 0 };

      for (const s of STAGE_FILES) {
        const relPath = `${relBase}/${s.file}`;
        const body = readFileSafe(join(root, relPath));
        stages[s.key] = body != null;
        if (body != null) {
          artifacts.push({ path: relPath, artifactType: s.key, feature: dir });
          typeHints[relPath] = s.key;
          if (s.key === 'tasks') tasks = countCheckboxes(body);
        }
      }
      for (const sup of SUPPORTING) {
        const relPath = `${relBase}/${sup}`;
        if (exists(join(root, relPath))) {
          const t = sup.replace('.md', '').replace('-', '_');
          artifacts.push({ path: relPath, artifactType: t, feature: dir });
          typeHints[relPath] = t;
        }
      }

      const hasTests =
        isDir(join(root, relBase, 'contracts')) ||
        exists(join(root, relBase, 'quickstart.md'));

      features.push({
        name: dir,
        stages,
        tasks,
        requirementCount: 0,
        tracedRequirements: 0,
        hasTests,
        percentComplete: computePercent(stages, tasks),
        artifacts: artifacts.filter((a) => a.feature === dir).map((a) => a.path),
      });
    }

    const notes = buildNotes(features, !!constitutionPath);

    return {
      id: this.id,
      name: this.name,
      detected: true,
      markers,
      artifacts,
      features,
      overallPercentComplete: overallPercent(features),
      typeHints,
      notes,
    };
  },
};

function firstExisting(root: string, rels: string[]): string | null {
  for (const r of rels) if (exists(join(root, r))) return r;
  return null;
}

function buildNotes(features: FeatureCoverage[], hasConstitution: boolean): string[] {
  const notes: string[] = [];
  if (hasConstitution) notes.push('Project constitution present (governance for the Specify→Plan→Tasks flow).');
  const noTasks = features.filter((f) => !f.stages.tasks);
  if (noTasks.length)
    notes.push(`${noTasks.length} feature(s) specified/planned but without a tasks.md breakdown yet.`);
  const stalePlan = features.filter((f) => f.stages.spec && !f.stages.plan);
  if (stalePlan.length)
    notes.push(`${stalePlan.length} feature(s) have a spec with no plan — open at the Plan stage.`);
  const done = features.filter((f) => f.percentComplete === 100 && f.tasks.total > 0);
  if (done.length) notes.push(`${done.length} feature(s) at 100% of their task checklist.`);
  return notes;
}

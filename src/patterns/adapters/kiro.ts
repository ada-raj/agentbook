import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import type { PatternAdapter, PatternDetection, PatternArtifact, FeatureCoverage } from '../types.js';
import {
  readFileSafe,
  isDir,
  listDirs,
  exists,
  countCheckboxes,
  extractRequirementIds,
  countShall,
  tracedRequirements,
  computePercent,
  overallPercent,
} from '../coverage.js';

// AWS Kiro (.kiro/): the agentic IDE lays out
//   .kiro/specs/<feature>/{requirements.md, design.md, tasks.md}
//   .kiro/steering/*.md   (always-on project guidance)
// requirements.md is written in EARS ("WHEN <event> THE SYSTEM SHALL <action>")
// with numbered requirements; tasks.md references those requirement numbers,
// which is the requirement->task traceability Kiro is known for. We surface
// that traceability as a first-class coverage metric.

const STAGE_FILES: { key: string; file: string }[] = [
  { key: 'requirements', file: 'requirements.md' },
  { key: 'design', file: 'design.md' },
  { key: 'tasks', file: 'tasks.md' },
];

export const kiroAdapter: PatternAdapter = {
  id: 'kiro',
  name: 'AWS Kiro',

  detect(root: string): PatternDetection | null {
    const kiroDir = join(root, '.kiro');
    if (!isDir(kiroDir)) return null;

    const markers: string[] = ['.kiro/'];
    const artifacts: PatternArtifact[] = [];
    const typeHints: Record<string, string> = {};
    const features: FeatureCoverage[] = [];

    // Steering docs (always-on guidance).
    const steeringDir = join(kiroDir, 'steering');
    if (isDir(steeringDir)) {
      markers.push('.kiro/steering/');
      for (const name of safeMdFiles(steeringDir)) {
        const relPath = `.kiro/steering/${name}`;
        artifacts.push({ path: relPath, artifactType: 'steering' });
        typeHints[relPath] = 'steering';
      }
    }

    const specsDir = join(kiroDir, 'specs');
    const featureDirs = isDir(specsDir)
      ? listDirs(specsDir).filter((d) =>
          STAGE_FILES.some((s) => exists(join(specsDir, d, s.file))),
        )
      : [];
    if (featureDirs.length) markers.push(`.kiro/specs/ (${featureDirs.length} features)`);

    if (!featureDirs.length && !isDir(steeringDir)) {
      // A bare .kiro/ with nothing recognizable is not a confident match.
      return null;
    }

    for (const dir of featureDirs) {
      const relBase = `.kiro/specs/${dir}`;
      const stages: Record<string, boolean> = {};
      let tasks = { total: 0, done: 0 };
      let requirementIds: string[] = [];
      let tasksBody = '';
      let hasTests = false;

      for (const s of STAGE_FILES) {
        const relPath = `${relBase}/${s.file}`;
        const body = readFileSafe(join(root, relPath));
        stages[s.key] = body != null;
        if (body == null) continue;
        artifacts.push({ path: relPath, artifactType: s.key, feature: dir });
        typeHints[relPath] = s.key;
        if (s.key === 'requirements') {
          requirementIds = extractRequirementIds(body);
          if (countShall(body) > 0 && !markers.includes('EARS requirements')) markers.push('EARS requirements');
        }
        if (s.key === 'tasks') {
          tasks = countCheckboxes(body);
          tasksBody = body;
        }
        if (s.key === 'design' && /test|verif/i.test(body)) hasTests = true;
      }

      const traced = tracedRequirements(tasksBody, requirementIds);

      const reqArtifact = artifacts.find((a) => a.feature === dir && a.artifactType === 'requirements');
      if (reqArtifact) reqArtifact.requirementIds = requirementIds;
      const taskArtifact = artifacts.find((a) => a.feature === dir && a.artifactType === 'tasks');
      if (taskArtifact) taskArtifact.tasks = tasks;

      features.push({
        name: dir,
        stages,
        tasks,
        requirementCount: requirementIds.length,
        tracedRequirements: traced,
        hasTests,
        percentComplete: computePercent(stages, tasks),
        artifacts: artifacts.filter((a) => a.feature === dir).map((a) => a.path),
      });
    }

    return {
      id: this.id,
      name: this.name,
      detected: true,
      markers,
      artifacts,
      features,
      overallPercentComplete: overallPercent(features),
      typeHints,
      notes: buildNotes(features),
    };
  },
};

function safeMdFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith('.md'))
      .sort();
  } catch {
    return [];
  }
}

function buildNotes(features: FeatureCoverage[]): string[] {
  const notes: string[] = [];
  const untraced = features.filter((f) => f.requirementCount > 0 && f.tracedRequirements < f.requirementCount);
  if (untraced.length)
    notes.push(
      `${untraced.length} feature(s) have requirements not yet referenced by any task (traceability gap).`,
    );
  const noDesign = features.filter((f) => f.stages.requirements && !f.stages.design);
  if (noDesign.length) notes.push(`${noDesign.length} feature(s) have requirements but no design doc yet.`);
  const complete = features.filter((f) => f.tasks.total > 0 && f.percentComplete === 100);
  if (complete.length) notes.push(`${complete.length} feature(s) with all tasks complete.`);
  return notes;
}

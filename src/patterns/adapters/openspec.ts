import { join } from 'node:path';
import type { PatternAdapter, PatternDetection, PatternArtifact, FeatureCoverage } from '../types.js';
import {
  readFileSafe,
  isDir,
  listDirs,
  exists,
  countCheckboxes,
  countShall,
  extractTestLinks,
  computePercent,
  overallPercent,
} from '../coverage.js';

// OpenSpec (openspec/): repo-resident living specs with delta/change tracking.
//   openspec/project.md
//   openspec/specs/<capability>/spec.md      (SHALL requirements + #### Scenario:)
//   openspec/changes/<change>/{proposal.md, tasks.md, design.md}
// The "changes" are the unit of active work (each has a task checklist and a
// delta against the capability specs); the "specs" are the settled
// capabilities. We report per-change completion and per-capability requirement
// counts, and treat scenarios as verification evidence.

function countScenarios(md: string): number {
  return (md.match(/^#{2,5}\s+scenario\b/gim) || []).length;
}

export const openspecAdapter: PatternAdapter = {
  id: 'openspec',
  name: 'OpenSpec',

  detect(root: string): PatternDetection | null {
    const base = join(root, 'openspec');
    if (!isDir(base)) return null;

    const markers: string[] = ['openspec/'];
    const artifacts: PatternArtifact[] = [];
    const typeHints: Record<string, string> = {};
    const features: FeatureCoverage[] = [];
    const notes: string[] = [];

    if (exists(join(base, 'project.md'))) {
      artifacts.push({ path: 'openspec/project.md', artifactType: 'project' });
      typeHints['openspec/project.md'] = 'project';
      markers.push('openspec/project.md');
    }

    // Capabilities (settled specs).
    const specsDir = join(base, 'specs');
    let capabilityCount = 0;
    let totalRequirements = 0;
    let totalScenarios = 0;
    if (isDir(specsDir)) {
      for (const cap of listDirs(specsDir)) {
        const relPath = `openspec/specs/${cap}/spec.md`;
        const body = readFileSafe(join(root, relPath));
        if (body == null) continue;
        capabilityCount++;
        const reqs = countShall(body);
        const scen = countScenarios(body);
        totalRequirements += reqs;
        totalScenarios += scen;
        artifacts.push({
          path: relPath,
          artifactType: 'capability',
          feature: cap,
          testLinks: extractTestLinks(body),
        });
        typeHints[relPath] = 'capability';
      }
      if (capabilityCount) markers.push(`openspec/specs/ (${capabilityCount} capabilities)`);
    }

    // Changes (active work with task checklists and deltas).
    const changesDir = join(base, 'changes');
    if (isDir(changesDir)) {
      const changeDirs = listDirs(changesDir).filter((c) => c !== 'archive');
      for (const change of changeDirs) {
        const relBase = `openspec/changes/${change}`;
        const stages: Record<string, boolean> = {};
        let tasks = { total: 0, done: 0 };
        let hasTests = false;

        for (const [key, file] of [
          ['proposal', 'proposal.md'],
          ['design', 'design.md'],
          ['tasks', 'tasks.md'],
        ] as const) {
          const relPath = `${relBase}/${file}`;
          const body = readFileSafe(join(root, relPath));
          stages[key] = body != null;
          if (body == null) continue;
          artifacts.push({ path: relPath, artifactType: key, feature: change });
          typeHints[relPath] = key;
          if (key === 'tasks') tasks = countCheckboxes(body);
          if (countScenarios(body) > 0) hasTests = true;
        }

        // A change also carries spec deltas under changes/<c>/specs/**.
        const deltaDir = join(root, relBase, 'specs');
        if (isDir(deltaDir)) {
          stages['delta'] = true;
        }

        features.push({
          name: change,
          stages,
          tasks,
          requirementCount: 0,
          tracedRequirements: 0,
          hasTests,
          percentComplete: computePercent(stages, tasks),
          artifacts: artifacts.filter((a) => a.feature === change).map((a) => a.path),
        });
      }
      if (changeDirs.length) markers.push(`openspec/changes/ (${changeDirs.length} changes)`);
    }

    if (capabilityCount === 0 && features.length === 0 && !exists(join(base, 'project.md'))) {
      return null; // bare openspec/ dir with nothing recognizable
    }

    if (capabilityCount)
      notes.push(
        `${capabilityCount} settled capability spec(s) with ${totalRequirements} SHALL requirement(s) and ${totalScenarios} scenario(s).`,
      );
    if (features.length) {
      const active = features.filter((f) => f.percentComplete < 100);
      notes.push(`${features.length} change(s) tracked; ${active.length} still in progress.`);
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
      notes,
    };
  },
};

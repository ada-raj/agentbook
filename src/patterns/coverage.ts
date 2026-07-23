import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { TaskStat, FeatureCoverage, PatternArtifact } from './types.js';

// Shared, dependency-free parsers used by every pattern adapter. All are
// deterministic — the value of the pattern layer is that these stats come from
// artifact *state*, not from a model or from git metadata.

export function readFileSafe(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export function rel(root: string, abs: string): string {
  return relative(root, abs).split('\\').join('/');
}

export function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function listDirs(p: string): string[] {
  try {
    return readdirSync(p)
      .filter((n) => isDir(join(p, n)))
      .sort();
  } catch {
    return [];
  }
}

export function exists(p: string): boolean {
  return existsSync(p);
}

// Count GitHub-style task checkboxes: "- [ ]" (open) and "- [x]" (done).
export function countCheckboxes(md: string): TaskStat {
  const total = (md.match(/^\s*[-*]\s+\[[ xX]\]/gm) || []).length;
  const done = (md.match(/^\s*[-*]\s+\[[xX]\]/gm) || []).length;
  return { total, done };
}

// Extract requirement-style identifiers: REQ-1, FR-2.3, US-01, R1, 1.2 headings, EARS "The system SHALL".
export function extractRequirementIds(md: string): string[] {
  const ids = new Set<string>();
  const idRe = /\b((?:REQ|FR|NFR|US|AC|R)[-_ ]?\d+(?:\.\d+)*)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = idRe.exec(md)) !== null) ids.add(m[1].toUpperCase().replace(/[ _]/g, '-'));
  // Numbered requirement headings: "### Requirement 3" or "## 2. ..."
  const hdRe = /^#{1,4}\s+(?:requirement\s+)?(\d+(?:\.\d+)*)\b/gim;
  while ((m = hdRe.exec(md)) !== null) ids.add('REQ-' + m[1]);
  return Array.from(ids);
}

// EARS/SHALL clause count — a proxy for testable requirement statements.
export function countShall(md: string): number {
  return (md.match(/\b(SHALL|MUST|WHEN\b.+?\bTHE SYSTEM SHALL)\b/g) || []).length;
}

// Links to test files / verification markers (OpenSpec [@test], paths to tests, "Verified by").
export function extractTestLinks(md: string): string[] {
  const links = new Set<string>();
  let m: RegExpExecArray | null;
  const tagRe = /\[@test[:\s]+([^\]]+)\]/gi;
  while ((m = tagRe.exec(md)) !== null) links.add(m[1].trim());
  const pathRe = /\b([\w./-]*(?:test|spec|__tests__)[\w./-]*\.[a-z]{1,4})\b/gi;
  while ((m = pathRe.exec(md)) !== null) links.add(m[1]);
  return Array.from(links);
}

// Which requirement IDs are referenced by task text (traceability).
export function tracedRequirements(taskMd: string, requirementIds: string[]): number {
  if (!requirementIds.length) return 0;
  const hay = taskMd.toUpperCase().replace(/[ _]/g, '-');
  let n = 0;
  for (const id of requirementIds) if (hay.includes(id)) n++;
  return n;
}

// Compute a real percent-complete for a feature from its artifact state.
// Weighting: tasks dominate when present; otherwise fall back to stage presence.
export function computePercent(stages: Record<string, boolean>, tasks: TaskStat): number {
  if (tasks.total > 0) return Math.round((tasks.done / tasks.total) * 100);
  const keys = Object.keys(stages);
  if (!keys.length) return 0;
  const present = keys.filter((k) => stages[k]).length;
  return Math.round((present / keys.length) * 100);
}

export function sumTasks(features: FeatureCoverage[]): TaskStat {
  return features.reduce(
    (acc, f) => ({ total: acc.total + f.tasks.total, done: acc.done + f.tasks.done }),
    { total: 0, done: 0 },
  );
}

export function overallPercent(features: FeatureCoverage[]): number {
  const t = sumTasks(features);
  if (t.total > 0) return Math.round((t.done / t.total) * 100);
  if (!features.length) return 0;
  return Math.round(features.reduce((a, f) => a + f.percentComplete, 0) / features.length);
}

export function artifactPaths(arts: PatternArtifact[]): string[] {
  return arts.map((a) => a.path);
}

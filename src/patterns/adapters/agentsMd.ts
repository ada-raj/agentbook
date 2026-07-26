import { join } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import type { PatternAdapter, PatternDetection, PatternArtifact, FeatureCoverage } from '../types.js';
import { readFileSafe, rel } from '../coverage.js';

// AGENTS.md / CLAUDE.md — the cross-tool "config as code" convention adopted by
// GitHub Agent HQ, Codex, Claude Code, Cursor, and others: a markdown file that
// instructs agents how to work in a given directory scope. Unlike the
// spec-driven patterns this is not about task completion; it is a
// provenance/config layer. We inventory every agent-instruction file by the
// scope it governs and compute a real "agent-config coverage": how much of the
// codebase's top-level structure has agent guidance available.

const CONFIG_NAMES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.cursorrules'];

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.venv',
  'venv',
  '__pycache__',
  '.mdpulse',
  'coverage',
  '.turbo',
]);

interface ConfigFile {
  path: string; // repo-relative
  scope: string; // dir it governs ('root' for repo root)
  kind: string; // AGENTS | CLAUDE | GEMINI | cursorrules
}

export const agentsMdAdapter: PatternAdapter = {
  id: 'agents-md',
  name: 'AGENTS.md convention',

  detect(root: string): PatternDetection | null {
    const configs = findConfigs(root, root, 0, 5);
    if (!configs.length) return null;

    const markers: string[] = [];
    const artifacts: PatternArtifact[] = [];
    const typeHints: Record<string, string> = {};

    for (const c of configs) {
      if (c.scope === 'root') markers.push(c.path);
      artifacts.push({ path: c.path, artifactType: 'agents_config', scope: c.scope });
      // Only .md files exist in the extraction corpus; hint those.
      if (c.path.endsWith('.md')) typeHints[c.path] = 'agents_config';
    }
    if (markers.length === 0) markers.push(`${configs.length} agent config file(s)`);

    // Group by scope into coverage rows.
    const byScope = new Map<string, ConfigFile[]>();
    for (const c of configs) {
      (byScope.get(c.scope) ?? byScope.set(c.scope, []).get(c.scope)!).push(c);
    }
    const features: FeatureCoverage[] = Array.from(byScope.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([scope, files]) => {
        const stages: Record<string, boolean> = {};
        for (const name of CONFIG_NAMES) {
          stages[kindOf(name)] = files.some((f) => f.kind === kindOf(name));
        }
        const nonEmpty = files.some((f) => (readFileSafe(join(root, f.path)) || '').trim().length > 0);
        return {
          name: scope,
          stages,
          tasks: { total: 0, done: 0 },
          requirementCount: 0,
          tracedRequirements: 0,
          hasTests: false,
          percentComplete: nonEmpty ? 100 : 0,
          artifacts: files.map((f) => f.path),
        };
      });

    // Agent-config coverage: fraction of top-level module dirs that carry their
    // OWN scoped guidance. Root guidance applies repo-wide but is reported
    // separately; the actionable signal is which modules have scoped guidance.
    const hasRoot = configs.some((c) => c.scope === 'root');
    const topDirs = topLevelDirs(root);
    const scopesWithConfig = new Set(configs.map((c) => c.scope));
    const coveredTop = topDirs.filter((d) => scopesWithConfig.has(d));
    // Headline = agent-guidance *availability*. Root guidance applies
    // repo-wide, so a repo with a root AGENTS.md/CLAUDE.md is fully covered
    // even if no submodule has its own file (reporting 0% there would be
    // misleading). Without root guidance, coverage is the share of top-level
    // modules that carry their own scoped guidance. The scoped share is always
    // preserved as a note for granularity.
    const coverage = hasRoot
      ? 100
      : topDirs.length
        ? Math.round((coveredTop.length / topDirs.length) * 100)
        : 0;

    const notes = buildNotes(configs, hasRoot, topDirs.length, coveredTop.length);

    return {
      id: this.id,
      name: this.name,
      detected: true,
      markers,
      artifacts,
      features,
      overallPercentComplete: coverage,
      typeHints,
      notes,
    };
  },
};

function kindOf(name: string): string {
  if (name === '.cursorrules') return 'cursorrules';
  return name.replace('.md', '');
}

function findConfigs(dir: string, root: string, depth: number, maxDepth: number): ConfigFile[] {
  if (depth > maxDepth) return [];
  const out: ConfigFile[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries.sort()) {
    const abs = join(dir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      out.push(...findConfigs(abs, root, depth + 1, maxDepth));
    } else if (CONFIG_NAMES.includes(name)) {
      const relPath = rel(root, abs);
      const scope = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : 'root';
      out.push({ path: relPath, scope, kind: kindOf(name) });
    }
  }
  return out;
}

function topLevelDirs(root: string): string[] {
  try {
    return readdirSync(root)
      .filter((n) => !n.startsWith('.') && !SKIP_DIRS.has(n) && safeIsDir(join(root, n)))
      .sort();
  } catch {
    return [];
  }
}

function safeIsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function buildNotes(configs: ConfigFile[], hasRoot: boolean, topTotal: number, topCovered: number): string[] {
  const notes: string[] = [];
  notes.push(hasRoot ? 'Root agent guidance present.' : 'No root-level AGENTS.md/CLAUDE.md — guidance is scoped only.');
  const kinds = Array.from(new Set(configs.map((c) => c.kind)));
  notes.push(`${configs.length} config file(s) across ${new Set(configs.map((c) => c.scope)).size} scope(s): ${kinds.join(', ')}.`);
  // Flag scopes that duplicate guidance (both AGENTS.md and CLAUDE.md).
  const dupScopes = new Set<string>();
  const byScopeKind = new Map<string, Set<string>>();
  for (const c of configs) {
    const s = byScopeKind.get(c.scope) ?? byScopeKind.set(c.scope, new Set()).get(c.scope)!;
    s.add(c.kind);
  }
  for (const [scope, k] of byScopeKind) if (k.has('AGENTS') && k.has('CLAUDE')) dupScopes.add(scope);
  if (dupScopes.size) notes.push(`${dupScopes.size} scope(s) have both AGENTS.md and CLAUDE.md (potential drift between the two).`);
  if (topTotal) notes.push(`${topCovered}/${topTotal} top-level module(s) have their own scoped agent guidance.`);
  return notes;
}

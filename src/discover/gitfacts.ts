import { execFileSync } from 'node:child_process';

export interface GitFileFacts {
  first?: string; // ISO date of earliest commit touching the file
  last?: string; // ISO date of most recent commit
  authors: string[];
  commitCount: number;
}

export interface GitFacts {
  isRepo: boolean;
  head?: string;
  perFile: Map<string, GitFileFacts>;
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60_000,
  });
}

export function collectGitFacts(root: string, paths: string[]): GitFacts {
  let head: string | undefined;
  try {
    head = git(root, ['rev-parse', 'HEAD']).trim();
  } catch {
    return { isRepo: false, perFile: new Map() };
  }

  const perFile = new Map<string, GitFileFacts>();
  // One `git log` per file is slow on huge repos, but bounded by corpus size
  // (markdown files only) and cached upstream by the run. Use --follow for
  // rename-aware history.
  for (const p of paths) {
    if (p.includes('#mermaid-')) continue; // synthetic docs share their parent's facts
    try {
      const log = git(root, [
        'log',
        '--follow',
        '--format=%aI\t%an',
        '--',
        p,
      ]).trim();
      if (!log) {
        perFile.set(p, { authors: [], commitCount: 0 });
        continue;
      }
      const rows = log.split('\n').map((l) => l.split('\t'));
      const dates = rows.map((r) => r[0]).filter(Boolean);
      const authors = Array.from(new Set(rows.map((r) => r[1]).filter(Boolean)));
      perFile.set(p, {
        last: dates[0],
        first: dates[dates.length - 1],
        authors,
        commitCount: rows.length,
      });
    } catch {
      perFile.set(p, { authors: [], commitCount: 0 });
    }
  }

  return { isRepo: true, head, perFile };
}

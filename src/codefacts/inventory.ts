import { execFileSync } from 'node:child_process';

export interface Inventory {
  head: string | null;
  paths: string[]; // all tracked file paths at HEAD
  pathBasenames: Set<string>;
  identifiers: Set<string>; // exported/declared identifiers across the tree
  identifiersLower: Set<string>;
}

// Deterministic HEAD inventory (Decision D8): zero model calls, zero new deps.
// Uses git to list tracked files and cheap per-language regexes to harvest
// declared identifiers.

const CODE_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.rb',
  '.kt',
  '.swift',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
]);

const DECL_PATTERNS: RegExp[] = [
  // JS/TS
  /\b(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
  // Python
  /\bdef\s+([A-Za-z_]\w*)/g,
  /\bclass\s+([A-Za-z_]\w*)/g,
  // Go
  /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/g,
  /\btype\s+([A-Za-z_]\w*)\s+(?:struct|interface)/g,
  // Rust
  /\b(?:pub\s+)?fn\s+([A-Za-z_]\w*)/g,
  /\b(?:pub\s+)?struct\s+([A-Za-z_]\w*)/g,
  /\b(?:pub\s+)?enum\s+([A-Za-z_]\w*)/g,
];

function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    timeout: 120_000,
  });
}

export function buildInventory(root: string): Inventory {
  let head: string | null = null;
  let paths: string[] = [];
  try {
    head = git(root, ['rev-parse', 'HEAD']).trim();
    paths = git(root, ['ls-files'])
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return {
      head: null,
      paths: [],
      pathBasenames: new Set(),
      identifiers: new Set(),
      identifiersLower: new Set(),
    };
  }

  const pathBasenames = new Set<string>();
  for (const p of paths) {
    const b = p.split('/').pop()!;
    pathBasenames.add(b);
    pathBasenames.add(b.replace(/\.[^.]+$/, '')); // stem
  }

  const identifiers = new Set<string>();
  for (const p of paths) {
    const ext = extOf(p);
    if (!CODE_EXT.has(ext)) continue;
    let src: string;
    try {
      src = git(root, ['show', `HEAD:${p}`]);
    } catch {
      continue;
    }
    if (src.length > 2_000_000) continue; // skip vendored megafiles
    for (const re of DECL_PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        if (m[1] && m[1].length > 1) identifiers.add(m[1]);
      }
    }
  }

  const identifiersLower = new Set(Array.from(identifiers, (s) => s.toLowerCase()));
  return { head, paths, pathBasenames, identifiers, identifiersLower };
}

function extOf(p: string): string {
  const b = p.split('/').pop()!;
  const i = b.lastIndexOf('.');
  return i === -1 ? '' : b.slice(i).toLowerCase();
}

const DOC_EXT_SET = new Set(['.md', '.mdx', '.mmd', '.markdown']);

/**
 * Word-boundary presence check against tracked code (ARCHITECTURE §8a step 3):
 * "exact, then word-boundary git grep". Matches only in non-markdown files, so
 * a symbol that appears solely in docs never counts as present in code. Returns
 * the matching code file paths (citations), capped.
 */
export function grepCodePresence(root: string, term: string): string[] {
  const t = term.trim();
  if (!t || t.length < 2) return [];
  let raw: string;
  try {
    // -w word boundary, -F fixed string (term may contain regex metachars),
    // -l list files, -I skip binary. Non-zero exit (no match) throws -> [].
    raw = git(root, ['grep', '-l', '-I', '-w', '-F', '-e', t]);
  } catch {
    return [];
  }
  return raw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((p) => !DOC_EXT_SET.has(extOf(p)))
    .slice(0, 6);
}

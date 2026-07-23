import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { sha256, shortHash } from '../util.js';

export interface DiscoveredFile {
  path: string; // repo-relative, forward slashes
  absPath: string;
  content: string;
  hash: string; // sha256:...
  shortHash: string;
  size: number;
  mtimeMs: number;
  isLiftedMermaid: boolean; // true for a .mmd block lifted out of a markdown file
}

const DOC_EXT = new Set(['.md', '.mdx', '.mmd', '.markdown']);

// Default excludes on top of .gitignore (PRODUCT F2).
const DEFAULT_EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  'vendor',
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

// Secret-ish filenames are skipped even with a .md extension (ARCHITECTURE §14).
const SECRET_PATTERNS = [/\.env/i, /credentials/i, /secrets?/i];

function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i === -1 ? '' : b.slice(i).toLowerCase();
}

export function discover(root: string, ignore: IgnoreMatcher): DiscoveredFile[] {
  const out: DiscoveredFile[] = [];
  walk(root, root, ignore, out);
  // Deterministic ordering for byte-stable runs.
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

function walk(dir: string, root: string, ignore: IgnoreMatcher, out: DiscoveredFile[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries.sort()) {
    const abs = join(dir, name);
    const rel = relative(root, abs).split('\\').join('/');
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (DEFAULT_EXCLUDE_DIRS.has(name)) continue;
      if (ignore.ignores(rel + '/')) continue;
      walk(abs, root, ignore, out);
      continue;
    }
    if (!st.isFile()) continue;
    if (!DOC_EXT.has(extname(name))) continue;
    if (SECRET_PATTERNS.some((re) => re.test(name))) continue;
    if (ignore.ignores(rel)) continue;

    let content: string;
    try {
      content = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }

    out.push({
      path: rel,
      absPath: abs,
      content,
      hash: sha256(content),
      shortHash: shortHash(content),
      size: st.size,
      mtimeMs: st.mtimeMs,
      isLiftedMermaid: false,
    });

    // Lift fenced mermaid blocks out of markdown into synthetic .mmd docs so
    // architecture diagrams are extracted structurally (PRODUCT F2).
    if (extname(name) !== '.mmd') {
      const blocks = liftMermaid(content);
      blocks.forEach((block, i) => {
        const vpath = `${rel}#mermaid-${i + 1}`;
        out.push({
          path: vpath,
          absPath: abs,
          content: block,
          hash: sha256(block),
          shortHash: shortHash(block),
          size: Buffer.byteLength(block),
          mtimeMs: st.mtimeMs,
          isLiftedMermaid: true,
        });
      });
    }
  }
}

export function liftMermaid(md: string): string[] {
  const blocks: string[] = [];
  const re = /```mermaid\s*\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const body = m[1].trim();
    if (body) blocks.push(body);
  }
  return blocks;
}

// ---- Minimal .gitignore matcher (no dependency) -------------------------

export interface IgnoreMatcher {
  ignores(relPath: string): boolean;
}

export function loadIgnore(root: string): IgnoreMatcher {
  const patterns: { re: RegExp; negate: boolean; dirOnly: boolean }[] = [];
  const giPath = join(root, '.gitignore');
  let raw = '';
  try {
    raw = readFileSync(giPath, 'utf8');
  } catch {
    /* no .gitignore */
  }
  for (let line of raw.split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const negate = line.startsWith('!');
    if (negate) line = line.slice(1);
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.slice(0, -1);
    patterns.push({ re: globToRegExp(line), negate, dirOnly });
  }
  return {
    ignores(relPath: string): boolean {
      const isDir = relPath.endsWith('/');
      const p = isDir ? relPath.slice(0, -1) : relPath;
      let ignored = false;
      for (const pat of patterns) {
        if (pat.dirOnly && !isDir) continue;
        if (pat.re.test(p) || pat.re.test(basename(p))) {
          ignored = !pat.negate;
        }
      }
      return ignored;
    },
  };
}

function globToRegExp(glob: string): RegExp {
  // Anchor to path start if it contains a slash, else match any segment.
  let g = glob;
  const anchored = g.includes('/') && !g.startsWith('**');
  g = g
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
    .replace(/\?/g, '[^/]');
  return new RegExp((anchored ? '^' : '(^|/)') + g + '($|/)');
}

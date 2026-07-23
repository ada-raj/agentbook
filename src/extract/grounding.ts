import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { modelCall } from '../auth/claude.js';
import { extractJson, sha256 } from '../util.js';
import { GroundingSchema, type Grounding } from './schema.js';
import { GROUNDING_SYSTEM, buildGroundingPrompt } from './prompts.js';
import type { Store } from '../cache/store.js';
import type { Config } from '../config.js';

const GROUND_FILES = [
  /^readme(\.md|\.mdx)?$/i,
  /^claude\.md$/i,
  /^agents\.md$/i,
  /^package\.json$/i,
  /^pyproject\.toml$/i,
  /^cargo\.toml$/i,
  /^go\.mod$/i,
];

// F1: read README, CLAUDE.md, manifests, and a depth-3 tree; one Sonnet call,
// cached and only re-run when its inputs change.
export async function runGrounding(cfg: Config, store: Store): Promise<Grounding> {
  const materials = gatherMaterials(cfg.root);
  const inputHash = sha256(materials);

  const cached = store.readJson<{ input_hash: string; grounding: Grounding }>('grounding.json');
  if (cached && cached.input_hash === inputHash) {
    return cached.grounding;
  }

  const raw = await modelCall(buildGroundingPrompt(materials), {
    model: cfg.synthModel,
    system: GROUNDING_SYSTEM,
    timeoutMs: 180_000,
  });
  let grounding: Grounding;
  try {
    grounding = GroundingSchema.parse(extractJson(raw));
  } catch {
    // Grounding is best-effort; a minimal profile still lets extraction run.
    grounding = GroundingSchema.parse({ project_purpose: '', domain_glossary: [] });
  }
  store.writeJson('grounding.json', { input_hash: inputHash, grounding });
  return grounding;
}

function gatherMaterials(root: string): string {
  const parts: string[] = [];
  for (const name of readdirSyncSafe(root)) {
    if (GROUND_FILES.some((re) => re.test(name))) {
      try {
        const body = readFileSync(join(root, name), 'utf8').slice(0, 12_000);
        parts.push(`# ${name}\n${body}`);
      } catch {
        /* skip */
      }
    }
  }
  parts.push('# DIRECTORY TREE (depth 3)\n' + tree(root, root, 0, 3));
  return parts.join('\n\n').slice(0, 40_000);
}

function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

const TREE_SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.mdpulse',
  '.venv',
  'venv',
  '__pycache__',
  '.next',
]);

function tree(dir: string, root: string, depth: number, maxDepth: number): string {
  if (depth > maxDepth) return '';
  const lines: string[] = [];
  for (const name of readdirSyncSafe(dir).sort()) {
    if (name.startsWith('.') && name !== '.claude') continue;
    if (TREE_SKIP.has(name)) continue;
    const abs = join(dir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    const rel = relative(root, abs);
    const indent = '  '.repeat(depth);
    if (st.isDirectory()) {
      lines.push(`${indent}${rel}/`);
      if (depth < maxDepth) lines.push(tree(abs, root, depth + 1, maxDepth));
    } else {
      lines.push(`${indent}${basename(rel)}`);
    }
  }
  return lines.filter(Boolean).join('\n');
}

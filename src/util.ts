import { createHash } from 'node:crypto';

/** sha256 of content, prefixed like the schema examples. */
export function sha256(content: string): string {
  return 'sha256:' + createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Short hash for filenames (content-addressed cache keys). */
export function shortHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 40);
}

/** Cheap bytes-to-tokens estimate (ARCHITECTURE §9: ÷3.6). */
export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 3.6);
}

/**
 * Extract a JSON value from model output. Handles ```json fences, leading
 * prose, and trailing commentary by scanning for the first balanced JSON
 * object or array. Throws if nothing parses.
 */
export function extractJson<T = unknown>(raw: string): T {
  let s = raw.trim();

  // Strip a fenced block if present.
  const fence = s.match(/```(?:json|jsonc)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  // Fast path.
  try {
    return JSON.parse(s) as T;
  } catch {
    /* fall through to balanced scan */
  }

  const start = firstOf(s, ['{', '[']);
  if (start === -1) throw new Error('no JSON found in model output');
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) {
        const candidate = s.slice(start, i + 1);
        return JSON.parse(candidate) as T;
      }
    }
  }
  throw new Error('unterminated JSON in model output');
}

function firstOf(s: string, chars: string[]): number {
  let min = -1;
  for (const ch of chars) {
    const idx = s.indexOf(ch);
    if (idx !== -1 && (min === -1 || idx < min)) min = idx;
  }
  return min;
}

/** Run async tasks with a bounded concurrency pool, preserving input order. */
export async function pMap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Stable JSON stringify (sorted keys) for byte-stable cache + render diffs. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2);
}

function sortKeys(value: any): any {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(value).sort()) out[k] = sortKeys(value[k]);
    return out;
  }
  return value;
}

/** Escape text for safe embedding in HTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

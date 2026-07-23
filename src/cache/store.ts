import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stableStringify } from '../util.js';
import type { ExtractionRecord } from '../extract/schema.js';

// Content-addressed JSON store under .mdpulse/ (Decision D3).
export class Store {
  readonly dir: string;
  readonly cacheDir: string;
  readonly extractionsDir: string;
  readonly synthDir: string;
  readonly runsDir: string;

  constructor(outDir: string) {
    this.dir = outDir;
    this.cacheDir = join(outDir, 'cache');
    this.extractionsDir = join(this.cacheDir, 'extractions');
    this.synthDir = join(outDir, 'synth');
    this.runsDir = join(outDir, 'runs');
    for (const d of [this.dir, this.cacheDir, this.extractionsDir, this.synthDir, this.runsDir]) {
      mkdirSync(d, { recursive: true });
    }
    this.ensureGitignore();
  }

  private ensureGitignore(): void {
    const gi = join(this.dir, '.gitignore');
    if (!existsSync(gi)) writeFileSync(gi, '*\n');
  }

  private extractionPath(shortHash: string): string {
    return join(this.extractionsDir, `${shortHash}.json`);
  }

  hasExtraction(shortHash: string): boolean {
    return existsSync(this.extractionPath(shortHash));
  }

  readExtraction(shortHash: string): ExtractionRecord | null {
    const p = this.extractionPath(shortHash);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as ExtractionRecord;
    } catch {
      return null;
    }
  }

  writeExtraction(shortHash: string, rec: ExtractionRecord): void {
    writeFileSync(this.extractionPath(shortHash), stableStringify(rec));
  }

  allExtractions(): ExtractionRecord[] {
    if (!existsSync(this.extractionsDir)) return [];
    const out: ExtractionRecord[] = [];
    for (const f of readdirSync(this.extractionsDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(readFileSync(join(this.extractionsDir, f), 'utf8')));
      } catch {
        /* skip corrupt entry */
      }
    }
    return out;
  }

  readJson<T>(relPath: string): T | null {
    const p = join(this.dir, relPath);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as T;
    } catch {
      return null;
    }
  }

  writeJson(relPath: string, value: unknown): void {
    const p = join(this.dir, relPath);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, stableStringify(value));
  }

  writeText(relPath: string, text: string): void {
    const p = join(this.dir, relPath);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, text);
  }
}

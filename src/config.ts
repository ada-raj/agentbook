import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Config resolution: flags > mdpulse.config.json > defaults (ARCHITECTURE §3).
export interface Config {
  root: string;
  outDir: string; // .mdpulse
  concurrency: number;
  maxFiles: number | null;
  extractModel: 'haiku' | 'sonnet';
  synthModel: 'haiku' | 'sonnet';
  chunkTokens: number;
  commitCache: boolean;
}

export interface CliFlags {
  concurrency?: number;
  maxFiles?: number;
  extractModel?: 'haiku' | 'sonnet';
  commitCache?: boolean;
}

const DEFAULTS: Omit<Config, 'root' | 'outDir'> = {
  concurrency: 6,
  maxFiles: null,
  extractModel: 'haiku',
  synthModel: 'sonnet',
  chunkTokens: 8000,
  commitCache: false,
};

export function loadConfig(root: string, flags: CliFlags = {}): Config {
  let fileCfg: Partial<Config> = {};
  const cfgPath = join(root, 'mdpulse.config.json');
  if (existsSync(cfgPath)) {
    try {
      fileCfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    } catch {
      /* ignore malformed config; defaults win */
    }
  }
  return {
    root,
    outDir: join(root, '.mdpulse'),
    concurrency: flags.concurrency ?? fileCfg.concurrency ?? DEFAULTS.concurrency,
    maxFiles: flags.maxFiles ?? fileCfg.maxFiles ?? DEFAULTS.maxFiles,
    extractModel: flags.extractModel ?? fileCfg.extractModel ?? DEFAULTS.extractModel,
    synthModel: fileCfg.synthModel ?? DEFAULTS.synthModel,
    chunkTokens: fileCfg.chunkTokens ?? DEFAULTS.chunkTokens,
    commitCache: flags.commitCache ?? fileCfg.commitCache ?? DEFAULTS.commitCache,
  };
}

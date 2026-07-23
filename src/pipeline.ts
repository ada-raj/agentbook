import pc from 'picocolors';
import { basename } from 'node:path';
import type { Config } from './config.js';
import { Store } from './cache/store.js';
import { discover, loadIgnore, type DiscoveredFile } from './discover/scanner.js';
import { collectGitFacts } from './discover/gitfacts.js';
import { computePending } from './cache/differ.js';
import { runGrounding } from './extract/grounding.js';
import { extractAll } from './extract/extractor.js';
import { SCHEMA_VERSION } from './extract/schema.js';
import { runCodeFacts } from './codefacts/verify.js';
import { synthesize } from './synthesize/index.js';
import { renderDashboard, type RenderData } from './render/html.js';
import { estimateTokens } from './util.js';
import { detectPatterns } from './patterns/registry.js';

export interface RunResult {
  htmlPath: string;
  stats: RenderData['stats'];
}

export function scan(cfg: Config): DiscoveredFile[] {
  const ignore = loadIgnore(cfg.root);
  let files = discover(cfg.root, ignore);
  if (cfg.maxFiles != null) files = files.slice(0, cfg.maxFiles);
  return files;
}

export function estimate(cfg: Config): { pending: number; total: number; tokens: number } {
  const store = new Store(cfg.outDir);
  const files = scan(cfg);
  const { pending } = computePending(files, store, SCHEMA_VERSION, cfg.extractModel);
  const tokens = pending.reduce((n, f) => n + estimateTokens(f.content) + 600, 0);
  return { pending: pending.length, total: files.length, tokens };
}

export async function run(cfg: Config, log: (s: string) => void): Promise<RunResult> {
  const store = new Store(cfg.outDir);

  log(pc.dim('Discovering markdown corpus...'));
  const files = scan(cfg);
  log(`  ${pc.bold(String(files.length))} documents found (incl. lifted mermaid blocks).`);

  log(pc.dim('Reading git history...'));
  const gitFacts = collectGitFacts(
    cfg.root,
    files.map((f) => f.path),
  );

  log(pc.dim('Grounding in the project...'));
  const grounding = await runGrounding(cfg, store);
  if (grounding.project_purpose) log(`  ${pc.dim(grounding.project_purpose.slice(0, 80))}`);

  const { pending, cached } = computePending(files, store, SCHEMA_VERSION, cfg.extractModel);
  log(`  ${pc.bold(String(cached.length))} cached, ${pc.bold(String(pending.length))} to extract.`);

  if (pending.length) {
    const tokens = pending.reduce((n, f) => n + estimateTokens(f.content) + 600, 0);
    log(pc.dim(`Extracting ${pending.length} files (~${(tokens / 1000).toFixed(0)}k tokens, ${cfg.extractModel}, concurrency ${cfg.concurrency})...`));
    const r = await extractAll(pending, grounding, cfg, store, (done, total, path, failed) => {
      const bar = progressBar(done, total);
      const tag = failed ? pc.red('fail') : pc.green(' ok ');
      process.stdout.write(`\r  ${bar} ${done}/${total} [${tag}] ${truncate(basename(path), 32).padEnd(32)}`);
    });
    process.stdout.write('\n');
    log(`  extracted ${pc.green(String(r.ok))} ok, ${r.failed ? pc.red(String(r.failed) + ' failed') : '0 failed'}.`);
  }

  const extractions = store.allExtractions().filter((e) =>
    files.some((f) => f.hash === e.content_hash),
  );

  log(pc.dim('Detecting spec-driven-development patterns...'));
  const patterns = detectPatterns(cfg.root);
  if (patterns.length) {
    log(`  ${patterns.map((p) => `${p.name} (${p.overallPercentComplete}% complete)`).join(', ')}`);
    // Apply deterministic doc_type hints from recognized artifacts.
    const hints: Record<string, string> = {};
    for (const p of patterns) Object.assign(hints, p.typeHints);
    for (const ex of extractions) {
      const hint = hints[ex.file];
      if (hint) ex.doc_type = hint;
    }
    store.writeJson('synth/patterns.json', patterns);
  } else {
    log(pc.dim('  none detected (free-form markdown corpus).'));
  }

  log(pc.dim('Verifying features against current code (CodeFacts)...'));
  const codeFacts = runCodeFacts(cfg.root, extractions, grounding, store);
  log(`  inventory: ${codeFacts.inventoryPaths} paths, ${codeFacts.inventoryIdentifiers} identifiers.`);

  log(pc.dim('Synthesizing timeline, features, results, architecture...'));
  const synthesis = await synthesize(extractions, gitFacts, codeFacts, cfg, store);

  const stats = {
    files: extractions.length,
    failed: extractions.filter((e) => e.extraction_failed).length,
    features: synthesis.features.length,
    metrics: synthesis.results.length,
    events: synthesis.timeline.months.reduce((n, m) => n + m.events.length, 0),
  };

  log(pc.dim('Rendering dashboard...'));
  const projectName = grounding.project_purpose
    ? deriveName(cfg.root)
    : deriveName(cfg.root);
  const html = renderDashboard({
    projectName,
    grounding,
    synthesis,
    extractions,
    codeFacts,
    patterns,
    runStamp: new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
    stats,
  });
  store.writeText('pulse.html', html);
  const htmlPath = `${cfg.outDir}/pulse.html`;

  store.writeJson(`runs/${Date.now()}.json`, {
    at: new Date().toISOString(),
    files: files.length,
    extracted: extractions.length,
    failed: stats.failed,
    features: stats.features,
  });

  return { htmlPath, stats };
}

function deriveName(root: string): string {
  return basename(root);
}

function progressBar(done: number, total: number, width = 20): string {
  const filled = Math.round((done / Math.max(total, 1)) * width);
  return pc.cyan('█'.repeat(filled)) + pc.dim('░'.repeat(width - filled));
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

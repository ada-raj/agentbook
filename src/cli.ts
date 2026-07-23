#!/usr/bin/env node
import { Command } from 'commander';
import pc from 'picocolors';
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, type CliFlags } from './config.js';
import { resolveAuth } from './auth/claude.js';
import { run, estimate } from './pipeline.js';
import { Store } from './cache/store.js';
import { runGrounding } from './extract/grounding.js';
import { ask } from './ask/index.js';

const program = new Command();

program
  .name('mdpulse')
  .description('Reads your repo\'s markdown corpus and renders a verified project dashboard, on your Claude Code subscription.')
  .version('1.0.0');

function commonFlags(cmd: Command): Command {
  return cmd
    .option('-C, --dir <path>', 'repo root', process.cwd())
    .option('--concurrency <n>', 'parallel extractions', (v) => parseInt(v, 10))
    .option('--max-files <n>', 'safety cap on files processed', (v) => parseInt(v, 10))
    .option('--extract-model <model>', 'haiku | sonnet', 'haiku')
    .option('--commit-cache', 'do not gitignore .mdpulse (shared team cache)');
}

function cfgFrom(opts: any) {
  const root = resolve(opts.dir || process.cwd());
  const flags: CliFlags = {
    concurrency: opts.concurrency,
    maxFiles: opts.maxFiles,
    extractModel: opts.extractModel,
    commitCache: opts.commitCache,
  };
  return loadConfig(root, flags);
}

function requireAuth(): void {
  const auth = resolveAuth();
  if (!auth.ok) {
    console.error(pc.red('✖ ') + auth.detail);
    process.exit(1);
  }
  const via = auth.method === 'subscription' ? 'Claude Code subscription' : 'ANTHROPIC_API_KEY';
  console.error(pc.dim(`auth: ${via}${auth.cliVersion ? ` (claude ${auth.cliVersion})` : ''}`));
}

async function doRun(opts: any, openBrowser: boolean) {
  requireAuth();
  const cfg = cfgFrom(opts);
  const log = (s: string) => console.error(s);
  console.error(pc.bold(pc.cyan('\n◐ mdpulse\n')));
  const t0 = Date.now();
  const { htmlPath, stats } = await run(cfg, log);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.error(
    '\n' +
      pc.green('✓ ') +
      pc.bold('Dashboard ready') +
      pc.dim(` in ${secs}s`) +
      `\n  ${pc.underline(htmlPath)}\n` +
      pc.dim(`  ${stats.files} files · ${stats.features} features · ${stats.metrics} metric series · ${stats.events} timeline events` +
        (stats.failed ? ` · ${stats.failed} failed` : '')) +
      '\n',
  );
  if (openBrowser) openInBrowser(htmlPath);
}

commonFlags(program.command('run'))
  .description('extract what changed, synthesize, render, and open the dashboard')
  .action((opts) => doRun(opts, true).catch(fail));

commonFlags(program.command('build'))
  .description('same as run but does not open the browser (for CI)')
  .action((opts) => doRun(opts, false).catch(fail));

commonFlags(program.command('status'))
  .description('cache stats, files pending, estimated tokens for next run')
  .action((opts) => {
    const cfg = cfgFrom(opts);
    if (!existsSync(cfg.outDir)) {
      console.log(pc.dim('No .mdpulse cache yet. Run `mdpulse` to create it.'));
    }
    const { pending, total, tokens } = estimate(cfg);
    const auth = resolveAuth();
    console.log(pc.bold('\nmdpulse status\n'));
    console.log(`  repo:        ${cfg.root}`);
    console.log(`  auth:        ${auth.ok ? pc.green(auth.method) : pc.red('none')}`);
    console.log(`  documents:   ${total}`);
    console.log(`  cached:      ${total - pending}`);
    console.log(`  pending:     ${pending}`);
    console.log(`  est. tokens: ~${(tokens / 1000).toFixed(0)}k on ${cfg.extractModel}`);
    const wall = Math.ceil((pending * 3) / cfg.concurrency);
    console.log(`  est. time:   ~${wall}s at concurrency ${cfg.concurrency}`);
    console.log('');
  });

commonFlags(program.command('ask'))
  .description('answer a question over the extracted index, with citations')
  .argument('<question>', 'natural-language question')
  .action(async (question, opts) => {
    requireAuth();
    const cfg = cfgFrom(opts);
    const store = new Store(cfg.outDir);
    const extractions = store.allExtractions();
    if (!extractions.length) {
      console.error(pc.red('No index found. Run `mdpulse` first.'));
      process.exit(1);
    }
    const grounding = await runGrounding(cfg, store);
    console.error(pc.dim('searching index...\n'));
    const answer = await ask(question, extractions, grounding, cfg);
    console.log(answer);
  });

commonFlags(program.command('clean'))
  .description('wipe cache and index')
  .action((opts) => {
    const cfg = cfgFrom(opts);
    if (existsSync(cfg.outDir)) {
      rmSync(cfg.outDir, { recursive: true, force: true });
      console.log(pc.green('✓ ') + `removed ${cfg.outDir}`);
    } else {
      console.log(pc.dim('nothing to clean.'));
    }
  });

// Default command (bare `mdpulse`) === run.
if (process.argv.length <= 2) {
  doRun({ dir: process.cwd(), extractModel: 'haiku' }, true).catch(fail);
} else {
  program.parseAsync(process.argv).catch(fail);
}

function fail(err: unknown) {
  console.error('\n' + pc.red('✖ ') + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
}

function openInBrowser(path: string) {
  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    const child = spawn(opener, [path], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* headless env: the path is printed above */
  }
}

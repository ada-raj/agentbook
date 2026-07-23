// Auth + model access (Decision D1).
//
// mdpulse never holds an API key of its own. It reuses the auth the user
// already has by invoking the Claude Code CLI in headless mode, exactly the
// path the "npx and it works" promise depends on. If a Claude Code
// subscription session is logged in, that is used; otherwise the CLI falls
// back to ANTHROPIC_API_KEY. Either way we shell out to the same binary and
// the credential resolution is the CLI's job, not ours.

import { spawn, execFileSync } from 'node:child_process';

export type ModelClass = 'haiku' | 'sonnet';

export interface ModelCallOptions {
  model: ModelClass;
  system?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface AuthStatus {
  ok: boolean;
  method: 'subscription' | 'api_key' | 'none';
  detail: string;
  cliVersion?: string;
}

const CLI = process.env.MDPULSE_CLAUDE_BIN || 'claude';

/** Resolve whether we can talk to a model at all, and how. */
export function resolveAuth(): AuthStatus {
  let cliVersion: string | undefined;
  try {
    cliVersion = execFileSync(CLI, ['--version'], { encoding: 'utf8', timeout: 15000 })
      .trim()
      .split('\n')[0];
  } catch {
    if (process.env.ANTHROPIC_API_KEY) {
      return {
        ok: true,
        method: 'api_key',
        detail: 'ANTHROPIC_API_KEY is set but the `claude` CLI was not found on PATH. Install it: npm i -g @anthropic-ai/claude-code',
      };
    }
    return {
      ok: false,
      method: 'none',
      detail: 'The `claude` CLI was not found and ANTHROPIC_API_KEY is not set.\nFix: install Claude Code (npm i -g @anthropic-ai/claude-code) and run `claude` once to log in, or export ANTHROPIC_API_KEY.',
    };
  }

  // The CLI exists. It will resolve a subscription session if one is logged
  // in, and otherwise use ANTHROPIC_API_KEY. We report the most likely method
  // for the status line; the real resolution happens inside the CLI.
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      ok: true,
      method: 'api_key',
      detail: 'Using ANTHROPIC_API_KEY via the Claude Code CLI.',
      cliVersion,
    };
  }
  return {
    ok: true,
    method: 'subscription',
    detail: 'Using your logged-in Claude Code subscription session.',
    cliVersion,
  };
}

const MODEL_FLAG: Record<ModelClass, string> = {
  haiku: 'haiku',
  sonnet: 'sonnet',
};

/**
 * One model call. Returns the model's text output (the `result` field of the
 * CLI's JSON envelope). Retries with exponential backoff + jitter on transient
 * failures and rate limits, per ARCHITECTURE §9.
 */
export async function modelCall(prompt: string, opts: ModelCallOptions): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const maxRetries = opts.maxRetries ?? 4;

  let lastErr = '';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await runOnce(prompt, opts, timeoutMs);
    } catch (err: any) {
      lastErr = String(err?.message ?? err);
      const retriable =
        /rate|overload|429|throttl|timeout|ETIMEDOUT|ECONNRESET|socket|network|5\d\d/i.test(lastErr);
      if (attempt === maxRetries || !retriable) break;
      const base = Math.min(2000 * 2 ** attempt, 60_000);
      const jitter = Math.floor(base * 0.25 * deterministicJitter(attempt, prompt.length));
      await sleep(base + jitter);
    }
  }
  throw new Error(`model call failed after ${maxRetries + 1} attempts: ${lastErr}`);
}

function runOnce(prompt: string, opts: ModelCallOptions, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--model',
      MODEL_FLAG[opts.model],
      '--output-format',
      'json',
    ];
    if (opts.system) {
      args.push('--append-system-prompt', opts.system);
    }

    const child = spawn(CLI, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    let out = '';
    let errOut = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error('timeout'));
    }, timeoutMs);

    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (errOut += d));
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`claude exited ${code}: ${errOut.slice(0, 400) || out.slice(0, 400)}`));
      }
      try {
        const env = JSON.parse(out);
        if (env.is_error) {
          return reject(new Error(`model error: ${env.subtype || env.result || 'unknown'}`));
        }
        if (typeof env.result !== 'string') {
          return reject(new Error('no result field in CLI output'));
        }
        resolve(env.result);
      } catch (e: any) {
        reject(new Error(`could not parse CLI output: ${e.message}; raw: ${out.slice(0, 200)}`));
      }
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Deterministic pseudo-jitter (temperature-0 / byte-stable ethos: no Math.random).
function deterministicJitter(attempt: number, seed: number): number {
  const x = Math.sin(attempt * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

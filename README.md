# mdpulse

**Your repo is full of markdown your AI agents wrote. mdpulse reads all of it and gives you back the project.**

mdpulse is a local-first CLI that runs on your existing Claude Code subscription. It reads your entire markdown corpus — plans, specs, session logs, backtests, mermaid diagrams — and renders a single self-contained HTML dashboard: a timeline of what actually happened, a feature map reconstructed from your own forgotten plans **and verified against your current code**, results trends over time, and the architecture story.

No API key required. No server. No data leaves your machine except through the Claude auth you already pay for.

```bash
npx mdpulse
```

It finds your Claude Code login, reads the repo, and opens the dashboard.

## What you get

| Section | What it shows |
|---|---|
| **Overview** | Headline counts, latest digest, domain glossary |
| **Timeline** | Month-by-month narrative from content dates + git history, with an activity strip |
| **Feature Map** | Every feature ever mentioned, each cross-checked against the current tree: *Confirmed shipped*, *Doc drift*, *Planned, no code*, *Implemented but undocumented*, or *Unverified* for prose-only claims |
| **Results** | Backtests / benchmarks as trends over time, regressions flagged |
| **Architecture** | Parsed mermaid diagrams in order, with change notes |
| **Open Loops** | Planned work with no result, threads that never concluded |
| **Files** | Per-file summaries; files that failed extraction are surfaced, never dropped |

Every synthesized claim links back to its source file. Nothing is asserted without evidence.

## Commands

```bash
mdpulse                      # extract changed files, synthesize, render, open dashboard
mdpulse build                # same, without opening the browser (for CI)
mdpulse status               # cached vs pending files, estimated tokens for next run
mdpulse ask "when did surge detection move to volume weighting?"
mdpulse clean                # wipe cache and index
```

Useful flags: `--dir <path>`, `--concurrency <n>`, `--max-files <n>`, `--extract-model haiku|sonnet`, `--commit-cache`.

## How it works

1. **Grounding** — one Sonnet call reads your README, CLAUDE.md/AGENTS.md, manifests, and tree so extraction is interpreted in domain context.
2. **Extraction (map)** — every markdown/mermaid file is classified and extracted into a strict, zod-validated JSON schema on a fast model (Haiku). Cached by content hash; a file is read by the model at most once per content version. Interrupt-safe and resumable.
3. **CodeFacts** — a deterministic, zero-model verification layer builds a symbol/path inventory of `HEAD` (git) and checks each identifier-like feature entity for presence in code, with a word-boundary `git grep` fallback. Prose-only entities are `not_verifiable` by design — precision over recall.
4. **Synthesis (reduce)** — extractions + code evidence become the timeline, feature map (resolved through a documented-status × code-status matrix), results, architecture, open loops, and digest.
5. **Render** — a deterministic TypeScript renderer emits one self-contained `pulse.html` (mermaid bundled, canvas charts, no network needed to view). The model never writes presentation code.

## Auth

mdpulse holds no key of its own. It invokes the Claude Code CLI in headless mode, which resolves your logged-in **subscription session** (Pro/Max) if present, and otherwise falls back to `ANTHROPIC_API_KEY`. If neither resolves, it prints the one-line fix and exits.

## Requirements

- Node 20+
- The `claude` CLI (`npm i -g @anthropic-ai/claude-code`), logged in — or `ANTHROPIC_API_KEY`
- A git repo (works without git, but timeline and code-verification quality drop)

## Privacy

No backend, no telemetry. File contents are sent only to Anthropic through your own authenticated session. The cache and dashboard live in `.mdpulse/`, gitignored by default (`--commit-cache` to opt in to a shared team cache).

## Build from source

```bash
npm install
npm run build      # tsc + bundle render assets into dist/
node dist/cli.js status --dir /path/to/repo
```

## License

MIT.

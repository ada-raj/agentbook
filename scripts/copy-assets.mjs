import { mkdirSync, cpSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Bundles the dashboard's render assets into dist/. mermaid.min.js is NOT
// committed to the repo (it is a ~3MB vendored blob); it is fetched once at
// build time and cached in src/render/assets/ so subsequent builds are offline.
// The published npm package ships the fetched copy inside dist/, so the
// dashboard itself never needs the network to render.

const MERMAID_VERSION = '10.9.3';
const MERMAID_URL = `https://cdn.jsdelivr.net/npm/mermaid@${MERMAID_VERSION}/dist/mermaid.min.js`;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcAssets = join(root, 'src/render/assets');
const destAssets = join(root, 'dist/render/assets');
const srcMermaid = join(srcAssets, 'mermaid.min.js');

mkdirSync(srcAssets, { recursive: true });

if (!existsSync(srcMermaid) || readFileSync(srcMermaid, 'utf8').length < 100_000) {
  console.log(`fetching mermaid@${MERMAID_VERSION} (one-time build asset)...`);
  const res = await fetch(MERMAID_URL);
  if (!res.ok) {
    console.error(`failed to fetch mermaid: HTTP ${res.status} from ${MERMAID_URL}`);
    console.error('Provide src/render/assets/mermaid.min.js manually, or check network access.');
    process.exit(1);
  }
  const js = Buffer.from(await res.arrayBuffer());
  writeFileSync(srcMermaid, js);
  console.log(`  saved ${(js.length / 1024 / 1024).toFixed(1)} MB -> ${srcMermaid}`);
}

mkdirSync(destAssets, { recursive: true });
cpSync(srcAssets, destAssets, { recursive: true });
console.log('bundled render assets ->', destAssets);

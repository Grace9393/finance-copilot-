/**
 * bundle-api.mjs — prebundle the Vercel serverless functions.
 *
 * Each api/*.ts entry is bundled with esbuild into a fully self-contained
 * api-dist/<name>.mjs (all npm dependencies inlined, only node builtins
 * external). Vercel then deploys the bundles directly — no runtime
 * node_modules resolution, which repeatedly broke with the includeFiles +
 * per-function-install approach (ERR_MODULE_NOT_FOUND for csv-parse/jszip).
 *
 * Run: node scripts/bundle-api.mjs   (wired into the root "build" script)
 */

import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = path.join(root, 'api');
const outDir = path.join(root, 'api-dist');
mkdirSync(outDir, { recursive: true });

// pdfjs sets up its in-process "fake worker" by dynamically importing
// pdf.worker.mjs next to the calling module — ship it beside the bundles
// (vercel.json includeFiles carries it into the deployed functions).
copyFileSync(
  path.join(root, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs'),
  path.join(outDir, 'pdf.worker.mjs')
);
console.log('copied pdfjs worker -> api-dist/pdf.worker.mjs');

const entries = readdirSync(apiDir).filter((f) => f.endsWith('.ts'));

for (const entry of entries) {
  const name = entry.replace(/\.ts$/, '');
  await build({
    entryPoints: [path.join(apiDir, entry)],
    outfile: path.join(outDir, `${name}.mjs`),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    // pdfjs-dist (inside pdf-parse) and cheerio use dynamic requires that
    // esbuild resolves at bundle time; node builtins stay external.
    external: [],
    logLevel: 'warning',
    // Some CJS deps probe require/__dirname — provide ESM-safe shims.
    banner: {
      js: [
        "import { createRequire as __cr } from 'node:module';",
        "import { fileURLToPath as __f2p } from 'node:url';",
        "import __path from 'node:path';",
        'const require = __cr(import.meta.url);',
        'const __filename = __f2p(import.meta.url);',
        'const __dirname = __path.dirname(__filename);'
      ].join('\n')
    }
  });
  console.log(`bundled api/${entry} -> api-dist/${name}.mjs`);
}

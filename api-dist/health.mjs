import { createRequire as __cr } from 'node:module';
import { fileURLToPath as __f2p } from 'node:url';
import __path from 'node:path';
const require = __cr(import.meta.url);
const __filename = __f2p(import.meta.url);
const __dirname = __path.dirname(__filename);

// api/health.ts
function handler(_req, res) {
  res.json({ status: "ok" });
}
export {
  handler as default
};

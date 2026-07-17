import { createRequire as __cr } from 'node:module';
import { fileURLToPath as __f2p } from 'node:url';
import __path from 'node:path';
const require = __cr(import.meta.url);
const __filename = __f2p(import.meta.url);
const __dirname = __path.dirname(__filename);
globalThis.DOMMatrix ??= class DOMMatrix {
  constructor(init) {
    if (Array.isArray(init) && init.length === 6) { [this.a, this.b, this.c, this.d, this.e, this.f] = init; }
    else { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; }
  }
  static fromMatrix(m) { return new DOMMatrix([m?.a ?? 1, m?.b ?? 0, m?.c ?? 0, m?.d ?? 1, m?.e ?? 0, m?.f ?? 0]); }
  scale() { return this; } translate() { return this; } multiply() { return this; } invertSelf() { return this; }
};
globalThis.ImageData ??= class ImageData { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(0); } };
globalThis.Path2D ??= class Path2D { addPath() {} moveTo() {} lineTo() {} closePath() {} };

// api/health.ts
function handler(_req, res) {
  res.json({ status: "ok" });
}
export {
  handler as default
};

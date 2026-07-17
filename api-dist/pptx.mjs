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

// api/pptx.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, unlink, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
var config = { api: { bodyParser: false } };
var execFileAsync = promisify(execFile);
async function readBody(req) {
  const preRead = req.body;
  if (Buffer.isBuffer(preRead) && preRead.length > 0) return preRead;
  if (typeof preRead === "string" && preRead.length > 0) return Buffer.from(preRead, "latin1");
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
function parseMultipart(buffer, boundary) {
  const boundaryBuf = Buffer.from("--" + boundary);
  const parts = [];
  let start = 0;
  while (start < buffer.length) {
    const idx = buffer.indexOf(boundaryBuf, start);
    if (idx === -1) break;
    const partStart = idx + boundaryBuf.length + 2;
    const nextIdx = buffer.indexOf(boundaryBuf, partStart);
    if (nextIdx === -1) break;
    parts.push(buffer.slice(partStart, nextIdx - 2));
    start = nextIdx;
  }
  let file = null;
  let title = "";
  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;
    const headerStr = part.slice(0, headerEnd).toString();
    const data = part.slice(headerEnd + 4);
    const cdMatch = headerStr.match(/Content-Disposition:[^\r\n]*?[;\s]name="([^"]*)"(?:[^\r\n]*?[;\s]filename="([^"]*)")?/i);
    const ctMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);
    if (!cdMatch) continue;
    const fieldName = cdMatch[1];
    if (fieldName === "file" && cdMatch[2]) {
      file = { filename: cdMatch[2], mimetype: ctMatch?.[1]?.trim() ?? "application/octet-stream", data };
    } else if (fieldName === "title") {
      title = data.toString("utf-8").trim();
    }
  }
  return { file, title };
}
async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const contentType = req.headers["content-type"] ?? "";
  const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
  if (!boundaryMatch) {
    res.status(400).json({ error: "Expected multipart/form-data" });
    return;
  }
  let rawBody;
  try {
    rawBody = await readBody(req);
  } catch {
    res.status(400).json({ error: "Failed to read request body" });
    return;
  }
  const { file, title } = parseMultipart(rawBody, boundaryMatch[1]);
  if (!file) {
    res.status(400).json({ error: "No file found in upload" });
    return;
  }
  if (!file.mimetype.startsWith("image/")) {
    res.status(415).json({ error: `Expected an image file, got: ${file.mimetype}` });
    return;
  }
  const tmpDir = await mkdtemp(path.join(tmpdir(), "pptx-"));
  const ext = path.extname(file.filename) || ".png";
  const imgPath = path.join(tmpDir, `input${ext}`);
  const outPath = path.join(tmpDir, "output.pptx");
  try {
    await writeFile(imgPath, file.data);
    const scriptPath = path.resolve(process.cwd(), "server/scripts/image_to_pptx.py");
    const args = [scriptPath, imgPath, outPath];
    if (title) args.push("--title", title);
    try {
      await execFileAsync("python3", args, { timeout: 3e4 });
    } catch {
      await execFileAsync("python", args, { timeout: 3e4 });
    }
    const pptxBuffer = await readFile(outPath);
    const base64 = pptxBuffer.toString("base64");
    const outputFilename = `${path.basename(file.filename, ext) || "presentation"}.pptx`;
    res.json({
      filename: outputFilename,
      base64,
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      slideCount: 1,
      warnings: []
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "PPTX generation failed" });
  } finally {
    await unlink(imgPath).catch(() => void 0);
    await unlink(outPath).catch(() => void 0);
  }
}
export {
  config,
  handler as default
};

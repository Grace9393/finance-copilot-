import type { VercelRequest, VercelResponse } from '@vercel/node';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const config = { api: { bodyParser: false } };

const execFileAsync = promisify(execFile);

// ── Multipart parser (same pattern as upload.ts) ──────────────────────────────

async function readBody(req: VercelRequest): Promise<Buffer> {
  // Vercel's request helper may have consumed the stream already and exposed
  // the raw body on req.body — prefer that when present.
  const preRead = (req as { body?: unknown }).body;
  if (Buffer.isBuffer(preRead) && preRead.length > 0) return preRead;
  if (typeof preRead === 'string' && preRead.length > 0) return Buffer.from(preRead, 'latin1');
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

interface MultipartFile {
  filename: string;
  mimetype: string;
  data: Buffer;
}

interface MultipartFields {
  file: MultipartFile | null;
  title: string;
}

function parseMultipart(buffer: Buffer, boundary: string): MultipartFields {
  const boundaryBuf = Buffer.from('--' + boundary);
  const parts: Buffer[] = [];
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

  let file: MultipartFile | null = null;
  let title = '';

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerStr = part.slice(0, headerEnd).toString();
    const data = part.slice(headerEnd + 4);
    // Lazy match with a [;\s] guard before name= — a greedy [^\r\n]* here
    // backtracks into filename="…" and returns the filename as the field name.
    const cdMatch = headerStr.match(/Content-Disposition:[^\r\n]*?[;\s]name="([^"]*)"(?:[^\r\n]*?[;\s]filename="([^"]*)")?/i);
    const ctMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);
    if (!cdMatch) continue;
    const fieldName = cdMatch[1];
    if (fieldName === 'file' && cdMatch[2]) {
      file = { filename: cdMatch[2], mimetype: ctMatch?.[1]?.trim() ?? 'application/octet-stream', data };
    } else if (fieldName === 'title') {
      title = data.toString('utf-8').trim();
    }
  }

  return { file, title };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const contentType = req.headers['content-type'] ?? '';
  const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
  if (!boundaryMatch) {
    res.status(400).json({ error: 'Expected multipart/form-data' });
    return;
  }

  let rawBody: Buffer;
  try {
    rawBody = await readBody(req);
  } catch {
    res.status(400).json({ error: 'Failed to read request body' });
    return;
  }

  const { file, title } = parseMultipart(rawBody, boundaryMatch[1]);
  if (!file) {
    res.status(400).json({ error: 'No file found in upload' });
    return;
  }

  if (!file.mimetype.startsWith('image/')) {
    res.status(415).json({ error: `Expected an image file, got: ${file.mimetype}` });
    return;
  }

  // Write temp files, run Python script, read output back
  const tmpDir = await mkdtemp(path.join(tmpdir(), 'pptx-'));
  const ext = path.extname(file.filename) || '.png';
  const imgPath = path.join(tmpDir, `input${ext}`);
  const outPath = path.join(tmpDir, 'output.pptx');

  try {
    await writeFile(imgPath, file.data);

    const scriptPath = path.resolve(process.cwd(), 'server/scripts/image_to_pptx.py');
    const args = [scriptPath, imgPath, outPath];
    if (title) args.push('--title', title);

    try {
      await execFileAsync('python3', args, { timeout: 30000 });
    } catch {
      // Fallback to `python` on Windows / some environments
      await execFileAsync('python', args, { timeout: 30000 });
    }

    const pptxBuffer = await readFile(outPath);
    const base64 = pptxBuffer.toString('base64');
    const outputFilename = `${path.basename(file.filename, ext) || 'presentation'}.pptx`;

    res.json({
      filename: outputFilename,
      base64,
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      slideCount: 1,
      warnings: [] as string[],
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'PPTX generation failed' });
  } finally {
    // Clean up temp files (best-effort)
    await unlink(imgPath).catch(() => undefined);
    await unlink(outPath).catch(() => undefined);
  }
}

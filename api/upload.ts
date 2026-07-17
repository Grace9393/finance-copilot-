import type { VercelRequest, VercelResponse } from '@vercel/node';
import { parseFileBuffer } from '../server/src/ingest.js';

export const config = { api: { bodyParser: false } };

async function readBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipart(buffer: Buffer, boundary: string): { filename: string; mimetype: string; data: Buffer } | null {
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
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerStr = part.slice(0, headerEnd).toString();
    const data = part.slice(headerEnd + 4);
    const cdMatch = headerStr.match(/Content-Disposition:[^\r\n]*name="([^"]*)"(?:[^\r\n]*filename="([^"]*)")?/i);
    const ctMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);
    if (cdMatch?.[1] === 'file') {
      return { filename: cdMatch[2] ?? 'upload', mimetype: ctMatch?.[1]?.trim() ?? 'application/octet-stream', data };
    }
  }
  return null;
}

/**
 * Serverless wrapper for POST /api/upload — parsing is shared with the
 * Express route and /api/source via server/src/ingest.ts (xlsx / xls / xlsm /
 * csv / json / pdf / docx / pptx / txt / md / html / images).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const contentType = req.headers['content-type'] ?? '';
    const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
    if (!boundaryMatch) { res.status(400).json({ error: 'Expected multipart/form-data' }); return; }
    const rawBody = await readBody(req);
    const file = parseMultipart(rawBody, boundaryMatch[1]);
    if (!file) { res.status(400).json({ error: 'No file found in upload' }); return; }
    res.json(await parseFileBuffer(file.data, file.filename, file.mimetype));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    res.status(message.startsWith('Unsupported') ? 415 : 422).json({ error: message });
  }
}

import { Router } from 'express';
import multer from 'multer';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);
const moduleDir = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(moduleDir, '..', '..', 'scripts', 'image_to_pptx.py');

export const pptxRouter = Router();

// Accept image uploads up to 20 MB in memory
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

pptxRouter.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const { buffer, originalname, mimetype } = req.file;

    // Accept images (and PDFs/Office files for future extension)
    if (!mimetype.startsWith('image/') && mimetype !== 'application/pdf') {
      res.status(415).json({ error: `Unsupported type for PPTX conversion: ${mimetype}` });
      return;
    }

    // Write input to a temp file
    const tmpDir = join(tmpdir(), 'finance-copilot-pptx');
    if (!existsSync(tmpDir)) await mkdir(tmpDir, { recursive: true });

    const id = randomUUID();
    const ext = originalname.split('.').pop() ?? 'png';
    const inputPath  = join(tmpDir, `${id}.${ext}`);
    const outputPath = join(tmpDir, `${id}.pptx`);
    const title = (req.body as { title?: string }).title ?? '';

    await writeFile(inputPath, buffer);

    try {
      // Run python script — stdout is JSON summary
      const { stdout, stderr } = await execFileAsync(
        'python',
        [SCRIPT, inputPath, outputPath, '--title', title],
        { timeout: 60_000 }
      );

      if (stderr && !stdout) {
        throw new Error(stderr.trim());
      }

      let summary: { slide_count?: number; title?: string; warnings?: string[]; error?: string } = {};
      try { summary = JSON.parse(stdout.trim()); } catch { /* non-fatal */ }

      if (summary.error) throw new Error(summary.error);

      // Read the generated PPTX and return as base64
      const pptxBuffer = await readFile(outputPath);
      const base64 = pptxBuffer.toString('base64');

      res.json({
        filename: `${title || originalname.replace(/\.[^.]+$/, '')}.pptx`,
        base64,
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        slideCount: summary.slide_count ?? 1,
        warnings: summary.warnings ?? []
      });
    } finally {
      // Clean up temp files
      unlink(inputPath).catch(() => {});
      unlink(outputPath).catch(() => {});
    }
  } catch (err) {
    next(err);
  }
});

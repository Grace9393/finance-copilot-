import { Router } from 'express';
import multer from 'multer';
import { buildPptxFromFile } from '../pptxGen.js';

export const pptxRouter = Router();

// Accept uploads up to 20 MB in memory
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

/**
 * POST /api/pptx (multipart, field "file", optional "title")
 *
 * Converts an image or PDF into an editable IBM-Carbon-branded PowerPoint.
 * Pure-JS generation (pptxgenjs) — identical behaviour locally and on
 * serverless; the previous python-script approach could not run on Vercel.
 */
pptxRouter.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }
    const { buffer, originalname, mimetype } = req.file;
    const title = (req.body as { title?: string }).title || undefined;
    res.json(await buildPptxFromFile(buffer, originalname, mimetype, title));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'PPTX generation failed';
    res.status(message.startsWith('Unsupported') ? 415 : 422).json({ error: message });
  }
});

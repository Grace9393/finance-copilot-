import { Router } from 'express';
import multer from 'multer';
import { parseFileBuffer } from '../ingest.js';

export const uploadRouter = Router();

// Store files in memory (max 20 MB)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

/**
 * POST /api/upload  (multipart, field "file")
 *
 * Accepts xlsx / xls / xlsm / csv / json / pdf / docx / pptx / txt / md /
 * html / images — parsing is shared with /api/source via ingest.ts.
 */
uploadRouter.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }
    const { buffer, originalname, mimetype } = req.file;
    res.json(await parseFileBuffer(buffer, originalname, mimetype));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload parsing failed';
    res.status(message.startsWith('Unsupported') ? 415 : 422).json({ error: message });
  }
});

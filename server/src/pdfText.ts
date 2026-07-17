/**
 * pdfText.ts — shared PDF text extraction on the pdf-parse v2 API.
 *
 * pdf-parse v2 exports a PDFParse class ({ data } → parser.getText()), not the
 * v1 callable — every extraction goes through this helper so the call
 * convention lives in one place.
 */

import { PDFParse } from 'pdf-parse';

export interface PdfTextResult {
  text: string;
  pages: number;
}

export async function pdfToText(buffer: Buffer): Promise<PdfTextResult> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    const pages = Array.isArray((result as { pages?: unknown[] }).pages)
      ? (result as { pages: unknown[] }).pages.length
      : 0;
    return { text: result.text ?? '', pages };
  } finally {
    await (parser as { destroy?: () => Promise<void> }).destroy?.();
  }
}

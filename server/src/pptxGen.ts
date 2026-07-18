/**
 * pptxGen.ts — pure-JS PowerPoint generation (pptxgenjs), shared by the
 * Express route and the Vercel serverless function.
 *
 * Replaces the previous python-script approach, which could not run on
 * serverless (spawn python ENOENT). Everything here bundles with esbuild.
 *
 *  - Images  → one IBM-Carbon-branded slide: image in the left panel,
 *              editable annotation placeholders on the right.
 *  - PDFs    → title slide + editable bullet slides from the extracted text.
 */

import PptxGenJSImport from 'pptxgenjs';
import { pdfToText } from './pdfText.js';

// pptxgenjs ships CJS whose type declarations clash with NodeNext resolution —
// the runtime default import IS the class, so cast the constructor and keep
// instances loosely typed.
/* eslint-disable @typescript-eslint/no-explicit-any */
const PptxGenJS = (((PptxGenJSImport as any).default ?? PptxGenJSImport) as unknown) as new () => any;
type Deck = any;
type DeckSlide = any;

export interface PptxResult {
  filename: string;
  base64: string;
  mimeType: string;
  slideCount: number;
  warnings: string[];
}

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const CARBON = {
  dark: '161616',
  blue: '0F62FE',
  grey: '525252',
  light: 'F4F4F4',
  white: 'FFFFFF'
};

function newDeck(): Deck {
  const deck = new PptxGenJS();
  deck.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
  deck.layout = 'WIDE';
  return deck;
}

function addHeader(deck: Deck, slide: DeckSlide, title: string): void {
  slide.background = { color: CARBON.white };
  slide.addShape(deck.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.95, fill: { color: CARBON.dark } });
  slide.addShape(deck.ShapeType.rect, { x: 0, y: 0.95, w: 13.33, h: 0.06, fill: { color: CARBON.blue } });
  slide.addText(title, {
    x: 0.45, y: 0.12, w: 12.4, h: 0.7,
    color: CARBON.white, bold: true, fontSize: 22, fontFace: 'Arial', valign: 'middle'
  });
  slide.addText('Made with IBM Bob · Finance Studio', {
    x: 8.9, y: 7.12, w: 4.2, h: 0.3,
    color: CARBON.grey, fontSize: 9, fontFace: 'Arial', align: 'right'
  });
}

function addAnnotationPanel(deck: Deck, slide: DeckSlide): void {
  const placeholders = [
    ['Key insight', 'Click to add the headline takeaway from this visual.'],
    ['Supporting detail', 'Click to add the numbers or context behind it.'],
    ['Recommended action', 'Click to add what leadership should do next.']
  ];
  placeholders.forEach(([heading, hint], i) => {
    const y = 1.35 + i * 1.95;
    slide.addShape(deck.ShapeType.roundRect, {
      x: 9.05, y, w: 3.85, h: 1.75, fill: { color: CARBON.light },
      line: { color: 'E0E0E0', width: 1 }, rectRadius: 0.06
    });
    slide.addText(heading, { x: 9.25, y: y + 0.12, w: 3.5, h: 0.35, color: CARBON.blue, bold: true, fontSize: 13, fontFace: 'Arial' });
    slide.addText(hint, { x: 9.25, y: y + 0.5, w: 3.5, h: 1.1, color: CARBON.grey, fontSize: 11, fontFace: 'Arial' });
  });
}

async function writeDeck(deck: Deck, filename: string, slideCount: number, warnings: string[]): Promise<PptxResult> {
  const base64 = (await deck.write({ outputType: 'base64' })) as string;
  return { filename, base64, mimeType: PPTX_MIME, slideCount, warnings };
}

function baseName(originalname: string): string {
  return originalname.replace(/\.[^.]+$/, '');
}

async function imageToPptx(buffer: Buffer, originalname: string, mimetype: string, title?: string): Promise<PptxResult> {
  const deck = newDeck();
  const slide = deck.addSlide();
  const slideTitle = title || baseName(originalname);
  addHeader(deck, slide, slideTitle);

  slide.addImage({
    data: `data:${mimetype};base64,${buffer.toString('base64')}`,
    x: 0.45, y: 1.35, w: 8.35, h: 5.6,
    sizing: { type: 'contain', w: 8.35, h: 5.6 }
  });
  addAnnotationPanel(deck, slide);

  return writeDeck(deck, `${slideTitle}.pptx`, 1, []);
}

async function pdfToPptx(buffer: Buffer, originalname: string, title?: string): Promise<PptxResult> {
  const warnings: string[] = [];
  const parsed = await pdfToText(buffer);
  const text = (parsed.text ?? '').trim();
  if (!text) throw new Error('PDF appears to be image-only (no extractable text) — export a page as PNG/JPG and convert that instead.');

  const deck = newDeck();
  const slideTitle = title || baseName(originalname);

  // Title slide
  const cover = deck.addSlide();
  addHeader(deck, cover, slideTitle);
  cover.addText(slideTitle, { x: 0.9, y: 2.6, w: 11.5, h: 1.2, color: CARBON.dark, bold: true, fontSize: 40, fontFace: 'Arial' });
  cover.addText(`Generated from ${originalname} · ${parsed.pages || '?'} pages · fully editable`, {
    x: 0.9, y: 3.9, w: 11.5, h: 0.5, color: CARBON.grey, fontSize: 16, fontFace: 'Arial'
  });

  // Content slides: chunk paragraphs into bullet groups
  const paragraphs = text.split(/\n{2,}|\f/).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p.length > 40);
  const perSlide = 5;
  const maxSlides = 6;
  const groups: string[][] = [];
  for (let i = 0; i < paragraphs.length && groups.length < maxSlides; i += perSlide) {
    groups.push(paragraphs.slice(i, i + perSlide));
  }
  if (paragraphs.length > maxSlides * perSlide) {
    warnings.push(`Content truncated: ${paragraphs.length} paragraphs, first ${maxSlides * perSlide} included`);
  }

  groups.forEach((group, gi) => {
    const slide = deck.addSlide();
    addHeader(deck, slide, `${slideTitle} — ${gi + 1} of ${groups.length}`);
    slide.addText(
      group.map((p) => ({
        text: p.length > 300 ? p.slice(0, 300) + '…' : p,
        options: { bullet: { characterCode: '2022' }, fontSize: 13, color: CARBON.dark, fontFace: 'Arial', paraSpaceAfter: 10 }
      })),
      { x: 0.7, y: 1.35, w: 12, h: 5.7, valign: 'top' }
    );
  });

  return writeDeck(deck, `${slideTitle}.pptx`, 1 + groups.length, warnings);
}

/** Convert an uploaded file (image or PDF) into an editable branded deck. */
export async function buildPptxFromFile(buffer: Buffer, originalname: string, mimetype: string, title?: string): Promise<PptxResult> {
  if (mimetype.startsWith('image/')) return imageToPptx(buffer, originalname, mimetype, title);
  if (mimetype === 'application/pdf' || /\.pdf$/i.test(originalname)) return pdfToPptx(buffer, originalname, title);
  throw new Error(`Unsupported type for PPTX conversion: ${mimetype || originalname}`);
}

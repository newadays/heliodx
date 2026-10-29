/**
 * §5.10 · Burned-in text check, in the browser. OCR (tesseract.js, loaded
 * only when needed; its engine and English model are fetched once from a
 * CDN — no image data is sent) reads the film's edges, where annotations
 * live, and returns one box per edge with readable text. Single letters (L/R
 * side markers) and positioning words are ignored.
 */
import type { Box } from "./process";

const IGNORE = /^(PA|AP|L|R|LT|RT|ERECT|SUPINE|PORTABLE|CHEST|UPRIGHT|LAT|LATERAL|INSP|EXP)$/i;

type Worker = Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>;
let workerPromise: Promise<Worker> | null = null;
/** Set once the engine failed or hung, so later files skip straight to the manual check. */
let unavailable = false;

function worker(): Promise<Worker> {
  workerPromise ??= import("tesseract.js").then((t) => t.createWorker("eng"));
  return workerPromise;
}

/** Rejects with `label` timed out after `ms`, so no step can hang the queue. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)} s`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** First use downloads the engine and English model (about 13 MB). */
export const TEXT_CHECK_TIMEOUT_MS = 60_000;

export function warmTextCheck(): void {
  void worker().catch((error) => {
    console.error("[upload] text check engine failed to load", error);
    workerPromise = null;
  });
}

export interface TextHit {
  box: Box;
  words: string[];
}

const BANDS: { name: string; x: number; y: number; w: number; h: number }[] = [
  { name: "top", x: 0, y: 0, w: 1, h: 0.18 },
  { name: "bottom", x: 0, y: 0.82, w: 1, h: 0.18 },
  { name: "left", x: 0, y: 0.18, w: 0.16, h: 0.64 },
  { name: "right", x: 0.84, y: 0.18, w: 0.16, h: 0.64 },
];

/** Readable text on the film's edges, one padded box per edge that has some. */
export async function findText(canvas: HTMLCanvasElement): Promise<TextHit[]> {
  if (unavailable) throw new Error("text check unavailable in this browser session");
  let w: Worker;
  try {
    w = await withTimeout(worker(), TEXT_CHECK_TIMEOUT_MS, "text check engine");
  } catch (error) {
    unavailable = true;
    throw error;
  }
  const scale = Math.min(1, 1600 / Math.max(canvas.width, canvas.height));
  const W = Math.round(canvas.width * scale);
  const H = Math.round(canvas.height * scale);
  const hits: TextHit[] = [];
  for (const band of BANDS) {
    const crop = document.createElement("canvas");
    crop.width = Math.round(band.w * W);
    crop.height = Math.round(band.h * H);
    crop.getContext("2d")!.drawImage(canvas, band.x * canvas.width, band.y * canvas.height, band.w * canvas.width, band.h * canvas.height, 0, 0, crop.width, crop.height);
    const { data } = await w.recognize(crop, {}, { blocks: true });
    const words = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
    const real = words.filter((wd) => wd.confidence >= 70 && /[A-Za-z0-9]{2,}/.test(wd.text) && !IGNORE.test(wd.text.replace(/[^A-Za-z]/g, "")) && wd.bbox.y1 - wd.bbox.y0 >= 0.006 * H);
    if (!real.length) continue;
    hits.push({ box: redactionBox(real, words, { width: crop.width, height: crop.height }, band), words: real.map((r) => r.text) });
  }
  return hits;
}

type OcrWord = { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } };

/**
 * The 0–1 box to fill for a band's hits. It grows to every OCR word (any
 * confidence, positioning words included) on the lines touching the hits,
 * because labels stack ("AP / ERECT" over a name) and OCR boxes sit off the
 * glyphs: on 29 Oct a hit just below "AP ERECT" left half of "ERECT" showing.
 * Then padded by most of a line height vertically and generously sideways
 * (OCR often drops a word's first or last letters, "OHN" for "JOHN").
 */
export function redactionBox(hits: OcrWord[], all: OcrWord[], crop: { width: number; height: number }, band: { x: number; y: number; w: number; h: number }): Box {
  const span = (ws: OcrWord[]) => ({
    x0: Math.min(...ws.map((w) => w.bbox.x0)),
    y0: Math.min(...ws.map((w) => w.bbox.y0)),
    x1: Math.max(...ws.map((w) => w.bbox.x1)),
    y1: Math.max(...ws.map((w) => w.bbox.y1)),
  });
  const lineOf = (ws: OcrWord[]) => Math.max(...ws.map((w) => w.bbox.y1 - w.bbox.y0));
  let group = [...hits];
  let s = span(group);
  // Pull in words whose line touches the group (within one line height), until nothing changes.
  for (let grew = true; grew; ) {
    const line = lineOf(group);
    const near = all.filter((w) => !group.includes(w) && w.bbox.y1 >= s.y0 - line && w.bbox.y0 <= s.y1 + line && w.bbox.x1 >= s.x0 - 4 * line && w.bbox.x0 <= s.x1 + 4 * line);
    grew = near.length > 0;
    group = [...group, ...near];
    s = span(group);
  }
  const lineH = (lineOf(group) / crop.height) * band.h;
  const padX = Math.max(0.03, lineH * 1.5);
  const padY = Math.max(0.02, lineH * 0.8);
  const bx = Math.max(0, band.x + (s.x0 / crop.width) * band.w - padX);
  const by = Math.max(0, band.y + (s.y0 / crop.height) * band.h - padY);
  const bw = ((s.x1 - s.x0) / crop.width) * band.w + 2 * padX;
  const bh = ((s.y1 - s.y0) / crop.height) * band.h + 2 * padY;
  return { x: bx, y: by, w: Math.min(1 - bx, bw), h: Math.min(1 - by, bh) };
}

/** "top-right corner" for the banner. */
export function whereIs(box: Box): string {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const v = cy < 0.33 ? "top" : cy > 0.67 ? "bottom" : "middle";
  const h = cx < 0.33 ? "left" : cx > 0.67 ? "right" : "centre";
  if (v === "middle" && h === "centre") return "centre";
  if (v === "middle") return `${h} edge`;
  if (h === "centre") return `${v} edge`;
  return `${v}-${h} corner`;
}

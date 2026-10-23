/** Drawing a receipt onto a canvas, 384 dots wide.
 *
 *  This is the renderer both print paths share: the Bluetooth transport thresholds the
 *  same canvas into ESC/POS raster, and the PDF embeds the same bits. One layout, so a
 *  preview cannot disagree with what comes out of the printer -- it is not a
 *  reconstruction of the receipt, it is the receipt.
 *
 *  Everything is drawn right-aligned or centred, because the paper is RTL. Text
 *  measurement comes from the canvas rather than being estimated, since Persian glyph
 *  widths vary far more than Latin ones and an estimate that is close for «کره» is not
 *  close for «ماست موسیر زیتون».
 */

export type Measure = (text: string) => number;

/** Breaks text to fit a width, on spaces where possible.
 *
 *  Breaking mid-word matters more in Persian than in Latin text: an unjoined fragment
 *  at a line end renders as a different letterform, so «کره» split badly does not look
 *  like a wrapped word, it looks like a typo. A single token too long to fit anywhere
 *  is broken anyway -- the alternative is silent clipping off the edge of the paper.
 */
export function wrapText(measure: Measure, text: string, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";

  const breakLongWord = (word: string) => {
    let piece = "";
    for (const ch of word) {
      if (piece && measure(piece + ch) > maxWidth) {
        lines.push(piece);
        piece = ch;
      } else {
        piece += ch;
      }
    }
    return piece;
  };

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) lines.push(current);

    if (measure(word) > maxWidth) {
      current = breakLongWord(word);
    } else {
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

/** Shortens to one line with an ellipsis. For a cell that must not wrap. */
export function truncateToWidth(measure: Measure, text: string, maxWidth: number): string {
  if (measure(text) <= maxWidth) return text;

  let out = text;
  while (out.length > 1 && measure(`${out}…`) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

export interface ReceiptLine {
  name: string;
  /** Already formatted, e.g. «۲ بسته × ۴۴۰٬۰۰۰». */
  detail: string;
  /** Already formatted, e.g. «۸۸۰٬۰۰۰». */
  amount: string;
}

export interface ReceiptData {
  businessName: string;
  orderNo: string;
  dateLabel: string;
  customerName: string;
  address?: string | null;
  phone?: string | null;
  lines: ReceiptLine[];
  totalLabel: string;
  /** The total written out (F116), printed under the figure so it cannot be misread. */
  totalWords?: string | null;
  paidLabel?: string | null;
  dueLabel?: string | null;
  driverName?: string | null;
  footer?: string | null;
}

/** Minimal 2D context surface, so this module needs no DOM types to be read or tested.
 *
 *  fillStyle is widened to include objects only so a real CanvasRenderingContext2D --
 *  whose fillStyle is `string | CanvasGradient | CanvasPattern` -- satisfies this
 *  without dragging lib.dom into a module that is otherwise pure. Nothing here ever
 *  assigns anything but a colour string.
 */
export interface Ctx {
  canvas: { width: number; height: number };
  font: string;
  fillStyle: string | object;
  textAlign: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
}

const PAD = 8;
const LINE = 22;
const SMALL = 18;

/** Draws the receipt and returns the height it used, in dots.
 *
 *  Two passes are avoided by drawing straight down and returning the cursor: the canvas
 *  is created generously tall, drawn into, and then only the used rows are packed. A
 *  measured-then-drawn version would need the font metrics twice for no benefit.
 */
export function drawReceipt(ctx: Ctx, data: ReceiptData, width: number): number {
  const inner = width - PAD * 2;
  const right = width - PAD;
  const measure: Measure = (t) => ctx.measureText(t).width;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, ctx.canvas.height);
  ctx.fillStyle = "#000000";

  let y = PAD + 18;

  ctx.textAlign = "center";
  ctx.font = "bold 22px Vazirmatn, Tahoma, sans-serif";
  ctx.fillText(data.businessName, width / 2, y);
  y += LINE + 4;

  ctx.font = "16px Vazirmatn, Tahoma, sans-serif";
  ctx.fillText(`${data.orderNo} · ${data.dateLabel}`, width / 2, y);
  y += LINE;

  const rule = () => {
    ctx.fillRect(PAD, y, inner, 1);
    y += 10;
  };
  rule();

  ctx.textAlign = "right";
  ctx.font = "bold 17px Vazirmatn, Tahoma, sans-serif";
  for (const line of wrapText(measure, data.customerName, inner)) {
    ctx.fillText(line, right, y);
    y += SMALL;
  }

  ctx.font = "14px Vazirmatn, Tahoma, sans-serif";
  for (const extra of [data.address, data.phone]) {
    if (!extra) continue;
    for (const line of wrapText(measure, extra, inner)) {
      ctx.fillText(line, right, y);
      y += SMALL - 2;
    }
  }

  y += 4;
  rule();

  ctx.font = "16px Vazirmatn, Tahoma, sans-serif";
  for (const line of data.lines) {
    // Amount on the left, name on the right: the amount column is the one people scan
    // down, so it gets the fixed edge and the name wraps around it.
    const amountWidth = measure(line.amount);
    ctx.textAlign = "left";
    ctx.fillText(line.amount, PAD, y);

    ctx.textAlign = "right";
    const nameWidth = inner - amountWidth - 12;
    for (const part of wrapText(measure, line.name, nameWidth)) {
      ctx.fillText(part, right, y);
      y += SMALL;
    }

    ctx.font = "13px Vazirmatn, Tahoma, sans-serif";
    ctx.fillText(line.detail, right, y);
    ctx.font = "16px Vazirmatn, Tahoma, sans-serif";
    y += SMALL + 2;
  }

  rule();

  ctx.font = "bold 20px Vazirmatn, Tahoma, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(data.totalLabel, PAD, y);
  ctx.textAlign = "right";
  ctx.fillText("جمع کل", right, y);
  y += LINE + 2;

  if (data.totalWords) {
    ctx.font = "13px Vazirmatn, Tahoma, sans-serif";
    for (const line of wrapText(measure, data.totalWords, inner)) {
      ctx.fillText(line, right, y);
      y += SMALL - 2;
    }
    y += 4;
  }

  ctx.font = "15px Vazirmatn, Tahoma, sans-serif";
  for (const [label, value] of [
    ["دریافت شد", data.paidLabel],
    ["مانده", data.dueLabel],
  ] as const) {
    if (!value) continue;
    ctx.textAlign = "left";
    ctx.fillText(value, PAD, y);
    ctx.textAlign = "right";
    ctx.fillText(label, right, y);
    y += SMALL;
  }

  if (data.driverName) {
    y += 4;
    ctx.textAlign = "right";
    ctx.font = "13px Vazirmatn, Tahoma, sans-serif";
    ctx.fillText(`تحویل: ${data.driverName}`, right, y);
    y += SMALL;
  }

  if (data.footer) {
    y += 6;
    ctx.textAlign = "center";
    ctx.font = "13px Vazirmatn, Tahoma, sans-serif";
    for (const line of wrapText(measure, data.footer, inner)) {
      ctx.fillText(line, width / 2, y);
      y += SMALL - 3;
    }
  }

  return Math.ceil(y + PAD);
}

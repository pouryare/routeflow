import ExcelJS from "exceljs";

// Column layout of the "ارسال امروز" sheet (a live filtered view of فروش rows whose
// وضعیت ارسال isn't yet "تحویل‌شده"). Matches what a user gets pasting straight out of
// that sheet in Excel (tab-separated cells) or uploading a standalone workbook
// containing just it.
const COL = {
  orderNo: 0,
  date: 1,
  customerName: 2,
  product: 3,
  qty: 4,
  amount: 5,
  address: 6,
  phone: 7,
  shippingStatus: 8,
  lat: 9,
  lng: 10,
  customerCode: 11,
  mapLink: 12,
} as const;

const HEADER_FIRST_CELL = "شماره سفارش";
const MAX_PLAUSIBLE_NAME_LEN = 120; // guards against the sheet's own instructional note row

export interface DeliveryLine {
  orderNo: string | null;
  date: string | null;
  customerName: string;
  product: string | null;
  qty: number | null;
  amount: number | null;
  address: string | null;
  phone: string | null;
  shippingStatus: string | null;
  lat: number | null;
  lng: number | null;
  customerCode: string | null;
  mapLink: string | null;
}

function parseNumberLoose(s: string | null | undefined): number | null {
  if (!s) return null;
  const cleaned = s.replace(/,/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function cellsToLine(cells: (string | null)[]): DeliveryLine | null {
  const customerName = (cells[COL.customerName] || "").trim();
  if (!customerName || customerName.length > MAX_PLAUSIBLE_NAME_LEN) return null;
  return {
    orderNo: cells[COL.orderNo] || null,
    date: cells[COL.date] || null,
    customerName,
    product: cells[COL.product] || null,
    qty: parseNumberLoose(cells[COL.qty]),
    amount: parseNumberLoose(cells[COL.amount]),
    address: cells[COL.address] || null,
    phone: cells[COL.phone] || null,
    shippingStatus: cells[COL.shippingStatus] || null,
    lat: parseNumberLoose(cells[COL.lat]),
    lng: parseNumberLoose(cells[COL.lng]),
    customerCode: cells[COL.customerCode] || null,
    mapLink: cells[COL.mapLink] || null,
  };
}

// Parses text pasted straight from Excel (tab-separated cells, one row per line).
// Tolerant of a leading header row and of a subset of the 13 columns being present.
export function parseDeliveryText(text: string): DeliveryLine[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);

  const out: DeliveryLine[] = [];
  for (const line of lines) {
    const cells = line.split("\t").map((c) => c.trim());
    if (cells[COL.orderNo] === HEADER_FIRST_CELL) continue;
    const parsed = cellsToLine(cells);
    // Require at least an order number or an amount, on top of a customer name, so a
    // stray pasted sentence (or the sheet's own merged instructional note row) can't
    // masquerade as a delivery line.
    if (parsed && (parsed.orderNo || parsed.amount !== null)) out.push(parsed);
  }
  return out;
}

/** Narrows an ExcelJS cell to the shape carrying `key`. The union it comes from does not
 *  narrow on `in` alone, and the predicate intersects rather than replaces so it stays a
 *  subtype of CellValue. */
function isShape<T>(v: ExcelJS.CellValue, key: string): v is ExcelJS.CellValue & T {
  return typeof v === "object" && v !== null && key in v;
}

// Parses an uploaded .xlsx containing an "ارسال امروز" sheet (or, if that name isn't
// found, the first worksheet -- covers a workbook saved with just this one sheet in it).
export async function parseDeliveryWorkbook(buffer: Buffer): Promise<DeliveryLine[]> {
  const workbook = new ExcelJS.Workbook();
  /* See the note in lib/importExcel.ts: Node 24's Buffer<ArrayBufferLike> and exceljs's
     older non-generic Buffer are structurally incompatible even though the value is
     right. Cast to the parameter's own type, not to `any`. */
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.getWorksheet("ارسال امروز") ?? workbook.worksheets[0];
  if (!sheet) return [];

  function cellText(v: ExcelJS.CellValue): string | null {
    if (v === null || v === undefined) return null;
    if (typeof v === "string") return v.trim() || null;
    if (typeof v === "number") return String(v);
    // ExcelJS's CellValue union does not narrow on a plain `in` check; these say which
    // shape is being reached for without reaching for `any`.
    if (isShape<{ result: unknown }>(v, "result")) {
      const r = v.result;
      return r === null || r === undefined ? null : String(r).trim() || null;
    }
    if (isShape<{ richText: { text?: unknown }[] }>(v, "richText")) {
      return v.richText.map((rt) => String(rt.text ?? "")).join("").trim() || null;
    }
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).trim() || null;
  }

  // actualRowCount can under-report vs rowCount depending on how a workbook was
  // written -- see the same note in lib/importExcel.ts.
  const lastRow = Math.max(sheet.actualRowCount, sheet.rowCount);

  let headerRow = -1;
  for (let r = 1; r <= lastRow; r++) {
    if (cellText(sheet.getRow(r).getCell(COL.orderNo + 1).value) === HEADER_FIRST_CELL) {
      headerRow = r;
      break;
    }
  }
  if (headerRow === -1) return [];

  const out: DeliveryLine[] = [];
  for (let r = headerRow + 1; r <= lastRow; r++) {
    const row = sheet.getRow(r);
    const cells = Array.from({ length: 13 }, (_, i) => cellText(row.getCell(i + 1).value));
    const parsed = cellsToLine(cells);
    if (parsed && (parsed.orderNo || parsed.amount !== null)) out.push(parsed);
  }
  return out;
}

export interface DeliveryItem {
  product: string;
  qty: number | null;
  amount: number | null;
}

export interface DeliveryStop {
  key: string;
  customerName: string;
  customerCode: string | null;
  orderNos: string[];
  items: DeliveryItem[];
  totalAmount: number;
  address: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  mapLink: string | null;
}

// One stop per customer (matched by customer code when present, else exact name):
// the sheet has one row per product line, so a multi-item order needs collapsing back
// into a single delivery stop before it's useful for routing.
export function groupIntoStops(lines: DeliveryLine[]): DeliveryStop[] {
  const map = new Map<string, DeliveryStop>();
  for (const l of lines) {
    const key = l.customerCode || l.customerName;
    let stop = map.get(key);
    if (!stop) {
      stop = {
        key,
        customerName: l.customerName,
        customerCode: l.customerCode,
        orderNos: [],
        items: [],
        totalAmount: 0,
        address: l.address,
        phone: l.phone,
        lat: l.lat,
        lng: l.lng,
        mapLink: l.mapLink,
      };
      map.set(key, stop);
    }
    if (l.orderNo && !stop.orderNos.includes(l.orderNo)) stop.orderNos.push(l.orderNo);
    if (l.product) stop.items.push({ product: l.product, qty: l.qty, amount: l.amount });
    if (l.amount) stop.totalAmount += l.amount;
    if (!stop.address && l.address) stop.address = l.address;
    if (!stop.phone && l.phone) stop.phone = l.phone;
    if (stop.lat === null && l.lat !== null) stop.lat = l.lat;
    if (stop.lng === null && l.lng !== null) stop.lng = l.lng;
  }
  return Array.from(map.values());
}

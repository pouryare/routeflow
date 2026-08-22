function escapeCsvField(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

const BOM = "﻿";

// UTF-8 BOM prefix so Excel (the tool everyone here actually opens this in) detects
// the encoding and renders Persian text correctly instead of mojibake.
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const lines = rows.map((row) =>
    row.map((cell) => escapeCsvField(cell === null || cell === undefined ? "" : String(cell))).join(",")
  );
  return BOM + lines.join("\r\n");
}

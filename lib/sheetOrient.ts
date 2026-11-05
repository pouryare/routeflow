/** Detail sheets: at the bottom by default, movable to the side (FB5, decided 2026-10-30). One saved
 *  choice per person on this device, shared by every detail sheet, so moving one moves them all. */
export type SheetOrient = "side" | "bottom";

const SHEET_ORIENT_KEY = "rf_detail_sheet_orient";
export const DEFAULT_SHEET_ORIENT: SheetOrient = "bottom";

export function parseSheetOrient(raw: string | null | undefined): SheetOrient {
  return raw === "side" || raw === "bottom" ? raw : DEFAULT_SHEET_ORIENT;
}

export function readSheetOrient(): SheetOrient {
  try {
    return parseSheetOrient(localStorage.getItem(SHEET_ORIENT_KEY));
  } catch {
    return DEFAULT_SHEET_ORIENT; // storage refused (private window): the default is still right
  }
}

export function saveSheetOrient(next: SheetOrient): void {
  try {
    localStorage.setItem(SHEET_ORIENT_KEY, next);
  } catch {
    /* not kept */
  }
}

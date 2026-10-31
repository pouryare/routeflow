export const HIDE_MONEY_KEY = "rf-hide-money";

/** The stored choice to hide amounts. Anything but "1" means shown, so a missing or broken value shows them. */
export function parseHideMoney(raw: string | null): boolean {
  return raw === "1";
}

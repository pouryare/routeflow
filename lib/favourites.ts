export const CUSTOMER_FAVOURITES_KEY = "rf-fav-customers";

/** The saved list of favourite ids. Anything that is not an array of whole numbers reads as empty. */
export function parseFavourites(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}

/** The list with `id` added, or taken out when it was already there. */
export function toggleFavourite(list: number[], id: number): number[] {
  return list.includes(id) ? list.filter((n) => n !== id) : [...list, id];
}

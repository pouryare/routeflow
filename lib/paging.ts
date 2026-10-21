/** Page arithmetic for server-rendered lists that page by `?page=N` (1-based). */

export interface Paging {
  page: number;
  pageCount: number;
  offset: number;
  limit: number;
}

/** `raw` is the untrusted query value. Anything that is not a positive integer is page 1;
 *  a page past the end is clamped to the last one rather than showing an empty table. */
export function pagingFor(raw: string | undefined, total: number, pageSize: number): Paging {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const n = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : 1;
  const page = Math.min(Math.max(1, n), pageCount);
  return { page, pageCount, offset: (page - 1) * pageSize, limit: pageSize };
}

/** The request's page number, before the total is known (it is needed to ask for the total). */
export function requestedPage(raw: string | undefined): number {
  return raw !== undefined && /^\d+$/.test(raw) ? Math.max(1, Number(raw)) : 1;
}

/** `base` plus the given params, dropping empty ones and the first page (the default). */
export function pageHref(base: string, params: Record<string, string | undefined>, page: number): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  if (page > 1) q.set("page", String(page));
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

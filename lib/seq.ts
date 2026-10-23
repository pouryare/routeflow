/* Array helpers for async callbacks, one item at a time and in order.
 *
 * Used where a loop body reads or writes the database. Promise.all would start every callback
 * at once and their statements would interleave, which on one transaction changes the order of
 * reads and writes the code was written for. The built-in some/every/filter cannot take an async
 * callback at all: a Promise is truthy, so `ids.some(async ...)` is always true. */

export async function mapSeq<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i++) out.push(await fn(items[i], i));
  return out;
}

export async function filterSeq<T>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<boolean>
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < items.length; i++) if (await fn(items[i], i)) out.push(items[i]);
  return out;
}

export async function someSeq<T>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<boolean>
): Promise<boolean> {
  for (let i = 0; i < items.length; i++) if (await fn(items[i], i)) return true;
  return false;
}

export async function everySeq<T>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<boolean>
): Promise<boolean> {
  for (let i = 0; i < items.length; i++) if (!(await fn(items[i], i))) return false;
  return true;
}

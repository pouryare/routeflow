/** F48: which credit-limit changes need the owner's sign-off. Lowering a limit is safe and applies at once;
 *  raising it, or removing it (null = no limit), is what a second person must approve. */
export function needsSignOff(oldLimit: number | null, newLimit: number | null): boolean {
  if (newLimit === null) return oldLimit !== null;
  return oldLimit === null ? false : newLimit > oldLimit;
}

/** A refusal the owner or manager should read (shown as the message). */
export class ChangeRequestError extends Error {}

import type { Role } from "@/lib/roles";
import { WHATS_NEW, type WhatsNewEntry } from "./notes";

/** The entries as this role sees them: lines for other roles dropped, emptied entries dropped. */
export function notesFor(role: Role, entries: WhatsNewEntry[] = WHATS_NEW): WhatsNewEntry[] {
  return entries
    .map((e) => ({ version: e.version, items: e.items.filter((i) => !i.roles || i.roles.includes(role)) }))
    .filter((e) => e.items.length > 0);
}

/** Every version this role has not marked seen, newest first, merged into one card's worth.
 *  `seen` is the newest version the person dismissed; versions are ISO dates, so they compare
 *  as strings. A new account has seen nothing, and gets only the latest entry rather than the
 *  whole history. Null when there is nothing new. */
export function unseenFor(role: Role, seen: string | undefined, entries: WhatsNewEntry[] = WHATS_NEW): WhatsNewEntry | null {
  const mine = notesFor(role, entries);
  const fresh = seen ? mine.filter((e) => e.version > seen) : mine.slice(0, 1);
  if (fresh.length === 0) return null;
  return { version: entries[0].version, items: fresh.flatMap((e) => e.items) };
}

/** Every version in the file, for the prefs whitelist. */
export const WHATS_NEW_VERSIONS: readonly string[] = WHATS_NEW.map((e) => e.version);

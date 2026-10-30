import { getDb } from "@/lib/db";
import { WHATS_NEW_VERSIONS } from "@/lib/whatsNew";

/** Per-member UI preferences for the Board & Pocket. Stored server-side (a blob on
 *  `users`) so a member's board choice follows them across devices. Merge-patched;
 *  unknown keys and bad values are rejected rather than stored. */
export interface BoardPrefs {
  board_mobile_mode?: "pager" | "stack";
  board_default_view?: "status" | "time" | "workflow";
  /** F112: the newest what's-new version this person dismissed. */
  whats_new_seen?: string;
  /** F117: this person's sound switch (lib/sound.ts). Unset is the default, on. */
  sound?: "on" | "off";
}

const ALLOWED: Record<keyof BoardPrefs, readonly string[]> = {
  board_mobile_mode: ["pager", "stack"],
  board_default_view: ["status", "time", "workflow"],
  whats_new_seen: WHATS_NEW_VERSIONS,
  sound: ["on", "off"],
};

export async function getPrefs(userId: number): Promise<BoardPrefs> {
  const row = await getDb()
    .prepare("SELECT prefs_json FROM users WHERE id = ?")
    .get(userId) as { prefs_json: string | null } | undefined;
  if (!row?.prefs_json) return {};
  try {
    const parsed = JSON.parse(row.prefs_json) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as BoardPrefs;
  } catch {
    return {};
  }
}

export async function setPrefs(userId: number, partial: BoardPrefs): Promise<BoardPrefs> {
  for (const [k, v] of Object.entries(partial)) {
    const allowed = (ALLOWED as Record<string, readonly string[] | undefined>)[k];
    if (!allowed) throw new Error(`prefs: unknown key ${k}`);
    if (!allowed.includes(String(v))) throw new Error(`prefs: bad value for ${k}: ${String(v)}`);
  }
  const merged = { ...await getPrefs(userId), ...partial };
  await getDb().prepare("UPDATE users SET prefs_json = ? WHERE id = ?").run(JSON.stringify(merged), userId);
  return merged;
}

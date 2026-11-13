import { getDb } from "@/lib/db";
import { DEFAULT_THRESHOLDS, THRESHOLDS, thresholdsProblem, type Thresholds } from "@/lib/thresholds";

const COLS = THRESHOLDS.map((t) => t.key).join(", ");

/** This company's numbers (D30). */
export async function thresholdsFor(organizationId: number): Promise<Thresholds> {
  const r = (await getDb().prepare(`SELECT ${COLS} FROM organizations WHERE id = ?`).get(organizationId)) as Record<string, number> | undefined;
  if (!r) return { ...DEFAULT_THRESHOLDS };
  return Object.fromEntries(THRESHOLDS.map((t) => [t.key, Number(r[t.key])])) as Thresholds;
}

/** Saves a full set; returns the problem in words, or null when saved. The audit trigger logs the change. */
export async function setThresholds(organizationId: number, v: Thresholds): Promise<string | null> {
  const problem = thresholdsProblem(v);
  if (problem) return problem;
  await getDb()
    .prepare(`UPDATE organizations SET ${THRESHOLDS.map((t) => `${t.key} = ?`).join(", ")} WHERE id = ?`)
    .run(...THRESHOLDS.map((t) => v[t.key]), organizationId);
  return null;
}

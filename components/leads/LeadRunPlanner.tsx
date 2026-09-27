"use client";

import { Icon } from "@/components/meridian/Icon";
import type { LeadRun } from "@/lib/repo/leadRuns";

/** Trigger button to open the LeadRunPlanner tab-flow modal.
 *
 *  The form itself lives in LeadRunPlannerTabFlow; this component is just the button
 *  that opens it, so the leads page stays clean and the assignment flow follows the
 *  same pattern as every other tap-flow in the app.
 */
export default function LeadRunPlanner({
  locationIds,
  busy,
  onOpen,
}: {
  locationIds: number[];
  busy?: boolean;
  onOpen: () => void;
}) {
  if (locationIds.length === 0) return null;

  return (
    <button
      type="button"
      className="flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-accent px-2 py-1.5 text-[length:var(--text-xs)] text-accent transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-accent hover:text-accent-ink disabled:opacity-50"
      disabled={busy}
      onClick={onOpen}
    >
      <Icon name="route" size="sm" /> سپردن مسیر
    </button>
  );
}

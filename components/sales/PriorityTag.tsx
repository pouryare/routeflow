import { priorityLabel, priorityTagged } from "@/lib/orderPriority";

/** A small tag for an urgent or key-account order (F132); renders nothing for the rest. */
export default function PriorityTag({ priority }: { priority: string | null | undefined }) {
  if (!priorityTagged(priority)) return null;
  const urgent = priority === "URGENT";
  return (
    <span
      className="inline-flex items-center rounded-[var(--radius-sm)] border px-[var(--space-1)] text-[length:var(--text-xs)] font-medium"
      style={{
        color: urgent ? "var(--crit)" : "var(--accent)",
        borderColor: urgent ? "var(--crit)" : "var(--accent)",
      }}
    >
      {priorityLabel(priority)}
    </span>
  );
}

import { formatDistanceKm } from "@/lib/geo";
import { Icon } from "@/components/meridian/Icon";

export function RestockHint({
  hint,
  busy,
  onAdd,
}: {
  hint: { warehouse: { name: string }; km: number };
  busy: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-dashed border-border-strong px-3 py-2">
      <span className="text-[length:var(--text-xs)] text-text-muted">
        {hint.warehouse.name} {formatDistanceKm(hint.km)} از این مسیر فاصله دارد — خط مستقیم
      </span>
      <button
        onClick={onAdd}
        disabled={busy}
        className="inline-flex items-center justify-center gap-[var(--space-2)] mr-auto rounded-[var(--radius-sm)] border border-accent px-2 py-1 text-[length:var(--text-xs)] text-accent transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:bg-accent hover:text-accent-ink disabled:opacity-50"
      >
        <Icon name="plus" size="sm" />
        {busy ? "در حال افزودن…" : "افزودن توقف"}
      </button>
    </div>
  );
}

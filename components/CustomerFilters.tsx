"use client";

import CollapsibleSection from "./CollapsibleSection";

export default function CustomerFilters({
  salespeople,
  salespersonFilter,
  onSalespersonFilterChange,
  totalCount,
  filteredCount,
}: {
  salespeople: string[];
  salespersonFilter: Set<string>;
  onSalespersonFilterChange: (s: Set<string>) => void;
  totalCount: number;
  filteredCount: number;
}) {
  function toggle(set: Set<string>, value: string, onChange: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  }

  const chipClass = (active: boolean) =>
    `rounded-[var(--radius-sm)] border px-2 py-0.5 text-[length:var(--text-xs)] transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
      active
        ? "border-accent bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-accent"
        : "border-border text-text-muted hover:border-border-strong hover:text-text"
    }`;

  return (
    <CollapsibleSection title={`فیلتر مشتری‌ها (${filteredCount} از ${totalCount})`} storageKey="filters">

      {salespeople.length > 0 && (
        <div>
          <p className="mb-1 text-[length:var(--text-xs)] text-text-faint">فروشنده</p>
          <div className="flex flex-wrap gap-1">
            {salespeople.map((s) => (
              <button key={s} onClick={() => toggle(salespersonFilter, s, onSalespersonFilterChange)} className={chipClass(salespersonFilter.has(s))}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </CollapsibleSection>
  );
}

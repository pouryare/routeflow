import EmptyState from "@/components/EmptyState";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";

/** FB4: the line an empty filtered list shows, naming how many the filter hides. */
export function hiddenLine(hidden: number): string {
  return hidden > 0 ? `${faNum(hidden)} مورد با این فیلتر پنهان است.` : "چیزی برای نمایش نیست.";
}

/** An empty list that is empty because of a filter says so: how many are hidden, and a button
 *  that clears the filter (FB4). With nothing hidden it is a plain empty state. */
export default function FilteredEmpty({ title, hidden, onClear }: { title: string; hidden: number; onClear: () => void }) {
  return (
    <EmptyState
      icon="filter"
      title={title}
      hint={hiddenLine(hidden)}
      action={
        hidden > 0 ? (
          <button type="button" className="btn ghost inline-flex min-h-[44px] items-center gap-[var(--space-2)]" onClick={onClear}>
            <Icon name="x" size="md" />
            پاک کردن فیلتر
          </button>
        ) : undefined
      }
    />
  );
}

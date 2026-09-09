import { Icon, type IconName } from "@/components/meridian/Icon";

/** What a list says when it has nothing in it.
 *
 *  An empty region of a page is ambiguous in a way a full one never is: it could mean
 *  there is nothing, or that the fetch failed, or that a filter is hiding everything, or
 *  that the feature was never set up. The reader cannot tell which, and the three wrong
 *  readings all point at "this is broken".
 *
 *  So each of these says the reason, and where there is an action that would fill it,
 *  names that too. Deliberately small and quiet -- an empty list is not an error, and
 *  dressing it up as one is its own kind of lie.
 */
export default function EmptyState({
  icon,
  title,
  hint,
  action,
  className = "",
}: {
  /** One glyph from the app's icon vocabulary. Gives the block a shape at a glance, so
   *  it reads as a considered state rather than as a rendering that stopped halfway. */
  icon: IconName;
  title: string;
  /** Why it is empty, or what would fill it. Omit when the title already says both. */
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-2 rounded-[var(--radius-md)] border border-dashed border-border px-4 py-6 text-center ${className}`}
    >
      <span aria-hidden="true" className="text-text-faint opacity-80">
        <Icon name={icon} size="lg" />
      </span>
      <p className="text-[length:var(--text-sm)] text-text-muted">{title}</p>
      {hint && <p className="max-w-sm text-[length:var(--text-xs)] leading-5 text-text-faint">{hint}</p>}
      {action}
    </div>
  );
}

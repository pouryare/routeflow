import { faDate, faNum } from "@/lib/format";
import { daysSince, freshnessTier } from "@/lib/freshness";
import { Icon } from "@/components/meridian/Icon";

/** How old the imported data is, said where it will be noticed.
 *
 *  Silent while the data is current -- a chip that is always there is a chip nobody
 *  reads, and "imported yesterday" is not news. It appears only once the answer has
 *  become something the reader should factor in.
 *
 *  Not a client component: it takes a timestamp and renders text. The pages that use it
 *  already know the timestamp, on the server or off their own state.
 */
export default function DataFreshness({
  syncedAt,
  now,
  className = "",
}: {
  syncedAt: string | null;
  /** Passed in rather than read here, so a server-rendered page has one clock reading
   *  for the whole render instead of one per component. */
  now?: Date;
  className?: string;
}) {
  const tier = freshnessTier(syncedAt, now);
  if (tier === "fresh") return null;

  const days = daysSince(syncedAt, now);
  const color = tier === "stale" ? "var(--crit)" : "var(--warn)";

  return (
    <p
      className={`flex items-start gap-1.5 text-[length:var(--text-xs)] leading-5 ${className}`}
      style={{ color }}
    >
      <Icon name="warn" size="sm" />
      <span>
        {tier === "unknown" ? (
          "هنوز هیچ داده‌ای از اکسل وارد نشده — ارقام این صفحه خالی است، نه صفر."
        ) : (
          <>
            داده‌ها {faNum(days as number)} روز پیش به‌روزرسانی شده
            {syncedAt && <> ({faDate(syncedAt)})</>}
            {tier === "stale" && " — بدهی‌ها و وضعیت‌ها احتمالاً دوره قبل را نشان می‌دهند."}
          </>
        )}
      </span>
    </p>
  );
}

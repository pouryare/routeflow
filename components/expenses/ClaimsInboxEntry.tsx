import Link from "next/link";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";

/** F102: the approval row on «امروز» has one button per kind of request (credit, discount, duplicates); this is the
 *  fourth: staff costs waiting for this manager. It opens the page where they are decided, and hides at zero. */
export default function ClaimsInboxEntry({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Link href="/my-expenses" className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--danger)] px-[var(--space-4)] text-[length:var(--text-sm)] text-[var(--foreground)]">
      <Icon name="wallet" size="md" />
      {`هزینه‌های کارکنان · ${faNum(count)} مورد منتظر شما`}
    </Link>
  );
}

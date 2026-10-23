import Link from "next/link";
import { Icon } from "@/components/meridian/Icon";
import type { AccountLink } from "@/lib/accountLinks";

/** A quiet row of the driver's other places under the /driver header (lib/driverLinks). Chips,
 *  not a menu: two or three items, each a full 44px target, no chrome added to a page that is
 *  read in a moving vehicle. */
export default function DriverLinks({ links }: { links: AccountLink[] }) {
  if (links.length === 0) return null;
  return (
    <nav aria-label="بخش‌های دیگر" className="mb-[var(--space-4)] flex flex-wrap gap-[var(--space-2)]">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="touch inline-flex min-h-11 items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--text-muted)] no-underline"
        >
          <Icon name={l.icon} size="sm" />
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

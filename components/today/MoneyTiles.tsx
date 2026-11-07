import Link from "next/link";
import { Icon, type IconName } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import type { MoneyTiles as Tiles } from "@/lib/repo/moneyTiles";

function Tile({ href, icon, label, value, sub }: { href: string; icon: IconName; label: string; value: number; sub?: string }) {
  return (
    <li className="min-w-0">
      <Link href={href} className="card flex min-h-[44px] flex-col gap-[var(--space-1)] p-[var(--space-3)] text-[var(--foreground)] no-underline">
        <span className="flex items-center gap-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--muted)]">
          <Icon name={icon} size="sm" />
          {label}
        </span>
        <span className="tnum truncate text-[length:var(--text-lg)] font-semibold">{faNum(value)}</span>
        {sub ? <span className="truncate text-[length:var(--text-xs)] text-[var(--muted)]">{sub}</span> : null}
      </Link>
    </li>
  );
}

/** A7, on the owner's home: five tiles in toman, each opening the page that holds its figure. */
export default function MoneyTiles({ t }: { t: Tiles }) {
  const ledger = (id: number | null) => (id ? `/accounting/ledger/${id}` : "/accounting/trial-balance");
  return (
    <section aria-label="پول امروز" className="mb-3" dir="rtl">
      <ul className="m-0 grid list-none grid-cols-2 gap-[var(--space-2)] p-0 sm:grid-cols-5">
        <Tile href={ledger(t.cash.accountId)} icon="wallet" label="صندوق" value={t.cash.balance} />
        <Tile href={ledger(t.bank.accountId)} icon="building" label="بانک" value={t.bank.balance} />
        <Tile href="/sales/payments" icon="banknote" label="طلب از مشتری‌ها" value={t.owedToUs.total}
          sub={t.owedToUs.overdue > 0 ? `${faNum(t.owedToUs.overdue)} بیش از ۳۰ روز` : "معوقی نیست"} />
        <Tile href="/accounting/payables" icon="receipt" label="بدهی ما" value={t.weOwe.total}
          sub={t.weOwe.suppliers > 0 ? `به ${faNum(t.weOwe.suppliers)} تأمین‌کننده` : "بدهی‌ای نیست"} />
        <Tile href="/sales/cheques" icon="calendar" label="چک‌های این هفته" value={t.chequesThisWeek.total}
          sub={t.chequesThisWeek.n > 0 ? `${faNum(t.chequesThisWeek.n)} چک تا ۷ روز` : "چکی سررسید نمی‌شود"} />
      </ul>
    </section>
  );
}

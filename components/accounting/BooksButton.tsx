"use client";

import { useState } from "react";
import Link from "next/link";
import BottomSheet from "@/components/mobile/BottomSheet";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import type { BooksDoc, BooksJournal } from "@/lib/repo/documentBooks";

const SOURCE: Record<string, string> = { SALE: "تحویل کالا", PAYMENT: "دریافت", REVERSAL: "ابطال", EXPENSE: "هزینه" };

/** B3: «ثبت‌های حسابداری» on an order, payment, cheque or expense, for the owner. Opens a sheet with
 *  the debit and credit lines this document made, each account linked to its ledger. */
export default function BooksButton({ doc, id, className = "" }: { doc: BooksDoc; id: number; className?: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ journals: BooksJournal[] } | "loading" | "error" | null>(null);

  async function show() {
    setOpen(true);
    setState("loading");
    const res = await fetch(`/api/accounting/books?doc=${doc}&id=${id}`).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { journals?: BooksJournal[] } | null;
    setState(res?.ok && j?.journals ? { journals: j.journals } : "error");
  }

  return (
    <>
      <button type="button" onClick={() => void show()}
        className={`inline-flex min-h-[44px] items-center gap-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)] hover:text-[var(--accent)] ${className}`}>
        <Icon name="file" size="sm" />
        ثبت‌های حسابداری
      </button>
      <BottomSheet open={open} title="ثبت‌های حسابداری" subtitle="بدهکار و بستانکاری که این سند ساخته است" onClose={() => setOpen(false)} closeLabel="بستن ثبت‌ها" bodyClassName="" expandable>
        <div dir="rtl" className="flex flex-col gap-[var(--space-3)] p-[var(--space-4)] text-[length:var(--text-sm)]">
          {state === "loading" ? <p className="m-0 text-[var(--text-muted)]">در حال خواندن…</p> : null}
          {state === "error" ? <p className="m-0 text-[var(--crit)]">ثبت‌ها خوانده نشد؛ دوباره تلاش کنید.</p> : null}
          {state && typeof state === "object" && state.journals.length === 0 ? (
            <p className="m-0 text-[var(--text-muted)]">این سند هنوز ثبتی در دفتر ندارد. سفارش با تحویل و دریافت با ثبت در دفتر می‌نشیند.</p>
          ) : null}
          {state && typeof state === "object"
            ? state.journals.map((j) => (
                <section key={j.journalId} className="card flex flex-col gap-[var(--space-2)] p-[var(--space-3)]">
                  <p className="m-0 flex justify-between gap-[var(--space-2)] text-[var(--text-muted)]">
                    <span>{SOURCE[j.sourceType] ?? j.sourceType}{j.reverses ? " · برگشت یک ثبت" : ""}{j.memo ? ` · ${j.memo}` : ""}</span>
                    <span className="tnum shrink-0">سند {faNum(j.journalId)} · {faJalaliDate(j.postedAt)}</span>
                  </p>
                  <ul className="m-0 flex list-none flex-col gap-[var(--space-1)] p-0">
                    {j.legs.map((l, i) => (
                      <li key={i} className="flex items-baseline justify-between gap-[var(--space-2)]">
                        <Link href={`/accounting/ledger/${l.accountId}`} className="min-h-[44px] truncate text-[var(--text)]">
                          {l.side === "D" ? "بدهکار" : "بستانکار"} · {l.nameFa} <span className="tnum text-[var(--text-muted)]">{l.code}</span>
                        </Link>
                        <span className="tnum shrink-0">{faNum(l.amountToman)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            : null}
        </div>
      </BottomSheet>
    </>
  );
}

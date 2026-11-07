"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import SectionHead from "@/components/meridian/SectionHead";
import { faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import { needsReview, supplierFromMemo, type RecentExpense } from "@/lib/flows/expense";
import FilterChips from "@/components/mobile/FilterChips";
import { autoOpenFlow, currentSearch } from "@/lib/flows/autoOpen";
import ExpenseFlow, { type ExpenseCategory, type ExpenseRepeat } from "./ExpenseFlow";
import BooksButton from "@/components/accounting/BooksButton";
import Link from "next/link";
import { placeHref } from "@/lib/entryPlace";

const BTN =
  "inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)] text-[var(--foreground)]";

/** «ثبت هزینه» on the expenses page: rent, fuel, a repair, in a few taps. Below it, the latest
 *  expenses, each with «تکرار این» (A10): the same category, supplier and amount, today's date. */
export default function ExpenseEntry({ categories, suppliers, recent = [], canSeeBooks = false }: {
  categories: ExpenseCategory[];
  suppliers: string[];
  recent?: RecentExpense[];
  canSeeBooks?: boolean;
}) {
  const [flow, setFlow] = useState<{ key: number; open: boolean; repeat?: ExpenseRepeat }>(() => autoOpenFlow("new", currentSearch()));
  const start = (repeat?: ExpenseRepeat) => setFlow((f) => ({ key: f.key + 1, open: true, repeat }));
  const [show, setShow] = useState<"all" | "review">("all");
  const toReview = recent.filter(needsReview).length;
  const listed = show === "review" ? recent.filter(needsReview) : recent;
  return (
    <>
      <div className="mb-4 flex">
        <button data-tour="open:expense" type="button" onClick={() => start()} className={`${BTN} self-start`}>
          <Icon name="plus" size="md" />
          ثبت هزینه
        </button>
      </div>
      {flow.key > 0 && (
        <ExpenseFlow
          key={flow.key}
          open={flow.open}
          categories={categories}
          suppliers={suppliers}
          repeat={flow.repeat}
          onClose={() => setFlow((f) => ({ ...f, open: false }))}
          onReopen={() => setFlow((f) => ({ ...f, open: true }))}
        />
      )}
      {recent.length > 0 && (
        <section className="mb-6">
          <SectionHead title="آخرین هزینه‌ها" as="h3" />
          {toReview > 0 && (
            <FilterChips
              groups={[{
                id: "review",
                label: "نمایش",
                mode: "single",
                neutral: "all",
                options: [
                  { id: "all", label: "همه" },
                  { id: "review", label: `نیاز به بررسی · ${faNum(toReview)}` },
                ],
                value: show,
                onChange: (v) => setShow(v as typeof show),
              }]}
            />
          )}
          <ul className="divide-y divide-[var(--border)] rounded-[var(--radius-md)] border border-[var(--border)]">
            {listed.map((r) => {
              const supplier = supplierFromMemo(r.memo);
              return (
                <li key={r.journalId} className="flex items-center gap-[var(--space-3)] px-[var(--space-3)] py-[var(--space-2)]">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline justify-between gap-[var(--space-2)] text-[length:var(--text-sm)]">
                      <span className="truncate font-medium">{r.categoryFa}</span>
                      <span className="tnum shrink-0">{faNum(r.amountToman)} تومان</span>
                    </p>
                    <p className="truncate text-[length:var(--text-xs)] text-[var(--muted)]">
                      {[faJalaliDate(r.postedAt), supplier ?? (r.memo || null), r.enteredBy, show === "review" && !r.hasReceipt ? "بدون رسید" : null, show === "review" && !r.memo?.trim() ? "بدون توضیح" : null].filter(Boolean).join(" · ")}
                      {r.hasReceipt ? (
                        <>
                          {" · "}
                          <Icon name="receipt" size="sm" label="رسید دارد" />
                        </>
                      ) : null}
                    </p>
                    <span className="flex flex-wrap items-center gap-[var(--space-2)]">
                      {r.place ? (
                        <Link href={placeHref(r.place)} className="inline-flex min-h-[44px] items-center gap-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--muted)]">
                          <Icon name="map-pin" size="sm" />
                          جای ثبت
                        </Link>
                      ) : null}
                      {canSeeBooks ? <BooksButton doc="expense" id={r.journalId} /> : null}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => start({ accountId: r.accountId, amountToman: r.amountToman, supplier })}
                    className={`${BTN} shrink-0`}
                  >
                    <Icon name="repeat" size="md" />
                    تکرار این
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}

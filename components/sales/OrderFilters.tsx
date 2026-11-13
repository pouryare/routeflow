"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FieldInput } from "@/components/FieldInput";
import FilterChips from "@/components/mobile/FilterChips";
import { Icon } from "@/components/meridian/Icon";
import { DAY_CHOICES, STATUS_GROUPS } from "@/lib/orderListFilter";
import { PAYMENT_STATUS_LABEL } from "@/lib/orderStateMachine";

/** FB1: search box and filter chips of the orders list. Every choice is kept in the address (?q=&status=&payment=&rep=&day=),
 *  so the page reads the list again and a filtered view can be shared. Pasting many order numbers or phones into the box finds all of them. */
export default function OrderFilters({ reps }: { reps: string[] }) {
  const router = useRouter();
  const path = usePathname();
  const search = useSearchParams();
  const [text, setText] = useState(search.get("q") ?? "");

  const go = (key: string, value: string) => {
    const q = new URLSearchParams(search.toString());
    q.delete("page");
    q.delete("limit");
    if (value) q.set(key, value);
    else q.delete(key);
    router.replace(q.size ? `${path}?${q}` : path);
  };
  const single = (id: string, label: string, options: { id: string; label: string }[], sheet = false) => ({
    id, label, mode: "single" as const, sheet, options,
    value: search.get(id) ?? "",
    onChange: (v: string | string[]) => go(id, v as string),
  });

  return (
    <div className="flex flex-col gap-[var(--space-2)] pb-3" data-tour="orders-filters">
      <form
        aria-label="جستجو در سفارش‌ها"
        className="flex items-center gap-[var(--space-2)]"
        onSubmit={(e) => {
          e.preventDefault();
          go("q", text.trim());
        }}
      >
        <FieldInput
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="جستجوی سفارش"
          placeholder="شمارهٔ سفارش، نام یا تلفن؛ چند مورد را پیست کنید"
          inputMode="search"
          className="min-h-[44px] flex-1 text-[length:var(--text-base)]"
        />
        <button type="submit" className="inline-flex min-h-[44px] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-sm)]">
          <Icon name="search" size="md" />
          جستجو
        </button>
      </form>
      <FilterChips
        groups={[
          single("status", "وضعیت", STATUS_GROUPS.map((g) => ({ id: g.id, label: g.label }))),
          single("day", "روز", DAY_CHOICES.map((d) => ({ id: d.id, label: d.label }))),
          single("payment", "پرداخت", Object.entries(PAYMENT_STATUS_LABEL).map(([id, label]) => ({ id, label })), true),
          ...(reps.length > 1 ? [single("rep", "فروشنده", reps.map((r) => ({ id: r, label: r })), true)] : []),
        ]}
      />
    </div>
  );
}

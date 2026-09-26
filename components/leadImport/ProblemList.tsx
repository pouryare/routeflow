"use client";

import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import type { LiveItem } from "./LiveItemList";

/** What a human still has to deal with, and nothing else.
 *
 *  Unresolved links and duplicates live here rather than in the run's list, because
 *  they are the only rows that need a decision. Everything that decoded cleanly was
 *  already saved, so keeping them on screen would be asking the user to review work that
 *  has already happened.
 *
 *  The address text is kept deliberately: a link that could not be placed is still a
 *  real venue with a real street address, and that string is what makes hand-placing it
 *  on the map possible later. */
export default function ProblemList({ items }: { items: LiveItem[] }) {
  if (items.length === 0) return null;

  const unresolved = items.filter((i) => i.status === "unresolved");
  const duplicates = items.filter((i) => i.status === "duplicate");

  return (
    <div>
      <p className="mb-1.5 text-[length:var(--text-xs)] text-text-muted">
        {faNum(items.length)} مورد نیاز به بررسی دارد
      </p>
      <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
        {[...unresolved, ...duplicates].map((item) => (
          <li
            key={item.id}
            className="flex items-start gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2"
          >
            <span className="mt-0.5 shrink-0 text-[color:var(--warn)]">
              <Icon name="warn" size="sm" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[length:var(--text-sm)] text-text">
                {item.name || "مکان بدون نام"}
              </p>
              {item.status === "duplicate" ? (
                <p className="truncate text-[length:var(--text-xs)] text-text-faint">
                  مشابه {item.duplicate_name || "موردی که قبلاً ذخیره شده"}
                </p>
              ) : (
                item.address && (
                  <p className="truncate text-[length:var(--text-xs)] text-text-faint">
                    {item.address}
                  </p>
                )
              )}
            </div>
            <span className="shrink-0 text-[length:var(--text-xs)] text-text-faint">
              {item.status === "duplicate" ? "تکراری" : "بدون مختصات"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

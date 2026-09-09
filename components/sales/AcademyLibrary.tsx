"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";

interface Card {
  id: number;
  outcome_code: string;
  customer_type: string | null;
  title_fa: string;
  script_fa: string;
}
interface Module {
  slug: string;
  title_fa: string;
  status: string;
}

export default function AcademyLibrary({
  cards,
  modules,
  done,
}: {
  cards: Card[];
  modules: Module[];
  done: string[];
}) {
  const [q, setQ] = useState("");
  const [complete, setComplete] = useState<string[]>(done);

  async function mark(slug: string) {
    await fetch("/api/sales/academy/lessons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lesson_slug: slug }),
    });
    setComplete((c) => [...new Set([...c, slug])]);
  }

  const filtered = cards.filter(
    (c) => !q || c.title_fa.includes(q) || c.script_fa.includes(q) || c.outcome_code.includes(q)
  );

  return (
    <div className="prose flex flex-col gap-[var(--space-4)]" dir="rtl">
      <section>
        <h3 className="m-0 mb-[var(--space-1)] text-[length:var(--text-sm)] font-medium">ماژول‌ها</h3>
        <ul className="m-0 list-none p-0 text-[length:var(--text-sm)]">
          {modules.map((m) => (
            <li key={m.slug} className="flex items-center justify-between border-b border-[var(--border)] py-[var(--space-1)]">
              <span className="text-[var(--text)]">
                {m.title_fa}
                {m.status === "stub" && <span className="mr-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-faint)]">(در حال تدوین)</span>}
              </span>
              <button
                type="button"
                onClick={() => void mark(m.slug)}
                disabled={complete.includes(m.slug)}
                className="rounded-full border border-[var(--border)] px-[var(--space-2)] py-[2px] text-[length:var(--text-xs)] text-[var(--text-muted)] disabled:opacity-50"
              >
                {complete.includes(m.slug) ? (
                  <>
                    تمام شد <Icon name="check" size="sm" />
                  </>
                ) : (
                  "تمام کردم"
                )}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div className="mb-[var(--space-2)] flex items-center justify-between">
          <h3 className="m-0 text-[length:var(--text-sm)] font-medium">کتابخانهٔ مخالفت</h3>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="جستجو…"
            className="rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-2)] py-[2px] text-[length:var(--text-xs)]"
          />
        </div>
        <div className="flex flex-col gap-[var(--space-2)]">
          {filtered.map((c) => (
            <div key={c.id} className="rounded-[var(--radius-md)] border border-[var(--border)] p-[var(--space-3)]">
              <div className="text-[length:var(--text-sm)] font-medium text-[var(--text)]">
                {c.title_fa}
                <span className="mr-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-faint)]">
                  {c.outcome_code}
                  {c.customer_type ? ` · ${c.customer_type}` : ""}
                </span>
              </div>
              <p className="m-0 mt-[var(--space-1)] text-[length:var(--text-xs)] leading-6 text-[var(--text-muted)]">
                {c.script_fa}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { normalizeSearch } from "@/lib/search/normalize";

/** A searchable list for a step whose answer is "which one": a customer, a product. The tap
 *  on a row is the answer, so there is no confirm button. */
export default function PickStep({ choices, optionId, extras = [], submit, placeholder = "جستجو…" }: {
  choices: { id: string; label: string }[];
  optionId: string;
  /** Other ways forward that name no one -- «کالا مشخص نیست». Each submits with no value. */
  extras?: { id: string; label: string }[];
  submit: (optionId: string, value?: string) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const { shown, more } = useMemo(() => {
    const n = normalizeSearch(q);
    const all = n ? choices.filter((c) => normalizeSearch(c.label).includes(n)) : choices;
    return { shown: all.slice(0, 8), more: all.length - 8 };
  }, [q, choices]);
  return (
    <div className="tf-pick">
      <input className="tf-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      <div className="tf-grid one">
        {shown.map((c) => (
          <button key={c.id} type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] tf-opt" onClick={() => submit(optionId, c.id)}>
            <Icon name="check" size="md" />
            {c.label}
          </button>
        ))}
      </div>
      {more > 0 ? <p className="tf-note">برای دیدن بقیه نام را جستجو کنید</p> : null}
      {extras.map((o) => (
        <button key={o.id} type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] tf-skip" onClick={() => submit(o.id)}>
          <Icon name="arrow-left" size="md" />
          {o.label}
        </button>
      ))}
    </div>
  );
}

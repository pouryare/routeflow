"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { normalizeSearch } from "@/lib/search/normalize";

/** A searchable list for a step whose answer is "which one": a customer, a product. The tap
 *  on a row is the answer, so there is no confirm button. */
export default function PickStep({ choices, optionId, submit, placeholder = "جستجو…" }: {
  choices: { id: string; label: string }[];
  optionId: string;
  submit: (optionId: string, value: string) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const n = normalizeSearch(q);
    return (n ? choices.filter((c) => normalizeSearch(c.label).includes(n)) : choices).slice(0, 8);
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
    </div>
  );
}

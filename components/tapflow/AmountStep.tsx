"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import type { ResolvedOption } from "@/lib/crm/flows/types";

/** One number, prefilled, with the likeliest alternatives as chips. The prefill is shown, never
 *  applied silently: the tap on the confirm button is the person's confirmation. */
export default function AmountStep({ prefill, chips, option, label, submit }: {
  prefill: number | null;
  chips?: { label: string; value: number }[];
  option: ResolvedOption;
  /** Accessible name of the field, from the step's own placeholder. */
  label: string;
  submit: (optionId: string, value: string) => void;
}) {
  const [text, setText] = useState(prefill === null ? "" : String(prefill));
  const n = Number(text);
  return (
    <div className="tf-amount">
      <input
        className="tf-input ltr"
        inputMode="numeric"
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))}
        autoFocus
      />
      <p className="tf-sub">{n > 0 ? `${faNum(n)} تومان` : "مبلغ را وارد کنید"}</p>
      {chips?.length ? (
        <div className="tf-grid">
          {chips.map((c) => (
            <button key={c.label} type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] tf-opt" onClick={() => setText(String(c.value))}>
              <Icon name="check" size="md" />
              {c.label}
              <small>{faNum(c.value)}</small>
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="inline-flex items-center justify-center gap-[var(--space-2)] tf-go"
        disabled={!(n > 0)}
        onClick={() => submit(option.id, String(n))}
      >
        <Icon name="check" size="md" />
        {option.label}
      </button>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import Keypad from "@/components/mobile/Keypad";
import { faNum } from "@/lib/format";
import { valueOf } from "@/lib/keypad";

/** A number field that never raises the OS keyboard: a 52 px readout that opens the keypad in a
 *  sheet, committed with «تأیید». Replaces a numeric text field for quantities, money and
 *  thresholds. `value` is the committed string ("" when empty). */
export default function KeypadField({
  label,
  value,
  onChange,
  unit,
  decimal = false,
  suggested,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  decimal?: boolean;
  suggested?: number;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const n = valueOf(value);

  return (
    <>
      <button
        type="button"
        className="picker-trigger"
        aria-haspopup="dialog"
        aria-label={`${label}: ${value === "" ? "خالی" : faNum(n, { maximumFractionDigits: 6 })}`}
        onClick={() => {
          setDraft(value);
          setOpen(true);
        }}
      >
        <span className={value === "" ? "picker-trigger__empty" : "keypadfield__value"}>
          {value === "" ? (placeholder ?? label) : `${faNum(n, { maximumFractionDigits: 6 })}${unit ? ` ${unit}` : ""}`}
        </span>
        <Icon name="edit" size="md" />
      </button>
      <BottomSheet open={open} title={label} onClose={() => setOpen(false)} closeLabel="بستن صفحه‌کلید">
        <div className="keypadfield__sheet">
          <Keypad
            value={draft}
            onChange={setDraft}
            decimal={decimal}
            unit={unit}
            suggested={suggested}
            onEnter={() => {
              onChange(draft);
              setOpen(false);
            }}
          />
          <button
            type="button"
            className="inline-flex items-center justify-center gap-[var(--space-2)] tf-go"
            onClick={() => {
              onChange(draft);
              setOpen(false);
            }}
          >
            <Icon name="check" size="md" />
            تأیید عدد
          </button>
        </div>
      </BottomSheet>
    </>
  );
}

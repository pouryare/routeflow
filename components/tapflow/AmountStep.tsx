"use client";

import { useState } from "react";
import { Button } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import Keypad from "@/components/mobile/Keypad";
import { AnswerButton } from "./Answer";
import { faNum } from "@/lib/format";
import type { ResolvedOption } from "@/lib/crm/flows/types";

/** One number, prefilled, with the likeliest alternatives as chips. The prefill is shown, never
 *  applied silently: the tap on the confirm button is the person's confirmation. */
export default function AmountStep({ prefill, chips, option, label, unit = "تومان", decimal = false, allowZero = false, submit }: {
  prefill: number | null;
  chips?: { label: string; value: number }[];
  option: ResolvedOption;
  /** Accessible name of the field, from the step's own placeholder. */
  label: string;
  /** Printed after the number (تومان for money, the product's unit for a count). */
  unit?: string;
  /** Accept one decimal point, for a count in kilograms. */
  decimal?: boolean;
  /** Zero is a real answer (a shelf that is empty), not a missing one. */
  allowZero?: boolean;
  submit: (optionId: string, value: string) => void;
}) {
  const [text, setText] = useState(prefill === null ? "" : String(prefill));
  const n = text === "" ? NaN : Number(text);
  const valid = Number.isFinite(n) && (allowZero ? n >= 0 : n > 0);
  return (
    <div className="tf-amount">
      <Keypad
        value={text}
        onChange={setText}
        onEnter={() => valid && submit(option.id, String(n))}
        decimal={decimal}
        unit={unit}
        suggested={!decimal && unit === "تومان" && n > 0 ? n : undefined}
      />
      <p className="tf-sub" aria-label={label}>{valid ? `${faNum(n, { maximumFractionDigits: 2 })} ${unit}` : "عدد را وارد کنید"}</p>
      {chips?.length ? (
        <div className="tf-grid">
          {chips.map((c) => (
            <AnswerButton key={c.label} icon="check" onPress={() => setText(String(c.value))}>
              {c.label}
              <small>{faNum(c.value)}</small>
            </AnswerButton>
          ))}
        </div>
      ) : null}
      <Button variant="primary" size="lg" fullWidth isDisabled={!valid} onPress={() => submit(option.id, String(n))}>
        <Icon name="check" size="md" />
        {option.label}
      </Button>
    </div>
  );
}

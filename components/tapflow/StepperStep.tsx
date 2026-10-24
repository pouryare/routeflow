"use client";

import { useState } from "react";
import { Button } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import { clampCount, type FlowItem } from "@/lib/flows/item";
import type { ResolvedOption } from "@/lib/crm/flows/types";
import { AnswerButton } from "./Answer";

/** One row per line, each prefilled with what was expected, so "everything was as ordered"
 *  needs no taps and a shortfall is one tap on the one line that came up short. The answer is
 *  `{ [itemId]: count }` as JSON, so it round-trips through `FlowAnswer.value`. */
export default function StepperStep({ items, option, submit }: {
  items: FlowItem[];
  option: ResolvedOption;
  submit: (optionId: string, value: string) => void;
}) {
  const [n, setN] = useState<Record<number, number>>(() => Object.fromEntries(items.map((i) => [i.id, i.qty ?? 0])));
  const bump = (i: FlowItem, d: number) => setN((s) => ({ ...s, [i.id]: clampCount(i.max ?? i.qty ?? 0, (s[i.id] ?? 0) + d) }));
  return (
    <div className="tf-stepper">
      {items.map((i) => (
        <div key={i.id} className="tf-row">
          <span>
            {i.label}
            {i.unit ? <small> · {i.unit}</small> : null}
          </span>
          <AnswerButton icon="minus" ariaLabel={`کم کردن ${i.label}`} onPress={() => bump(i, -1)}>
            کم
          </AnswerButton>
          <b>{faNum(n[i.id] ?? 0)}</b>
          <AnswerButton icon="plus" ariaLabel={`اضافه کردن ${i.label}`} onPress={() => bump(i, 1)}>
            زیاد
          </AnswerButton>
        </div>
      ))}
      <Button variant="primary" size="lg" fullWidth onPress={() => submit(option.id, JSON.stringify(n))}>
        <Icon name="check" size="md" />
        {option.label}
      </Button>
    </div>
  );
}

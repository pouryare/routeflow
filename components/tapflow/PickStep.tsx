"use client";

import { useMemo, useState } from "react";
import { AnswerButton, AnswerSearch, SkipButton } from "./Answer";
import { getRecentsUser } from "@/lib/recentsUser";
import { loadHistory, rank, record, saveHistory } from "@/lib/recents";

/** Clock read kept out of render: only called from the tap handler. */
const stamp = () => Date.now();

/** A searchable list for a step whose answer is "which one": a customer, a product. The tap
 *  on a row is the answer, so there is no confirm button. */
export default function PickStep({ choices, optionId, extras = [], submit, placeholder = "جستجو…", scope = optionId }: {
  choices: { id: string; label: string }[];
  optionId: string;
  /** Other ways forward that name no one -- «کالا مشخص نیست». Each submits with no value. */
  extras?: { id: string; label: string }[];
  submit: (optionId: string, value?: string) => void;
  placeholder?: string;
  /** Keeps this list's recents apart from other lists; defaults to the step's option id. */
  scope?: string;
}) {
  const [q, setQ] = useState("");
  const [history] = useState(() => loadHistory(getRecentsUser(), scope));
  const { shown, more } = useMemo(() => {
    const all = rank(choices, history, q, 0, choices.length);
    return { shown: all.slice(0, 8), more: all.length - 8 };
  }, [q, choices, history]);
  const pick = (id: string) => {
    saveHistory(getRecentsUser(), scope, record(history, id, stamp()));
    submit(optionId, id);
  };
  return (
    <div className="tf-pick">
      <AnswerSearch value={q} onChange={setQ} label={placeholder} placeholder={placeholder} />
      <div className="tf-grid one">
        {shown.map((c) => (
          <AnswerButton key={c.id} icon="check" onPress={() => pick(c.id)}>
            {c.label}
          </AnswerButton>
        ))}
      </div>
      {more > 0 ? <p className="tf-note">برای دیدن بقیه نام را جستجو کنید</p> : null}
      {extras.map((o) => (
        <SkipButton key={o.id} onPress={() => submit(o.id)}>
          {o.label}
        </SkipButton>
      ))}
    </div>
  );
}

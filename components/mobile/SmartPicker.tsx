"use client";

import { useMemo, useState } from "react";
import { HelpHint, HelpRow } from "@/components/meridian/HelpHint";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import { AnswerButton, AnswerList, AnswerSearch, SkipButton } from "@/components/tapflow/Answer";
import { getRecentsUser } from "@/lib/recentsUser";
import { loadHistory, rank, record, saveHistory, usual, type History } from "@/lib/recents";

/** Clock read kept out of render: only called from the tap handler. */
const stamp = () => Date.now();

/** Choose one thing from a list without typing: a customer, a product, a place.
 *
 *  Closed, it is a 52 px field showing the choice. Open, it is a sheet that starts with what this
 *  person picks most (their "usual", only things actually used before), then a search box and the
 *  ranked list. The search box is NOT focused when there is a usual to tap, so the keyboard stays
 *  down until someone asks for it. `scope` names the kind of thing ("customers"), keeping
 *  histories apart; the history is per person and per device (lib/recents). */
export default function SmartPicker({
  scope,
  label,
  items,
  value,
  onChange,
  placeholder,
  clearLabel,
  pinned,
}: {
  scope: string;
  /** What is being chosen, as a word -- the sheet's title and the field's accessible name. */
  label: string;
  items: { id: string; label: string }[];
  /** The chosen id, or "". */
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  /** If given, an extra row that clears the choice («بدون انتخاب»). */
  clearLabel?: string;
  /** Ids the screen knows belong first (F62: this customer's usual products), shown above
   *  this person's own «پرکاربردها» under their own heading. Nothing is hidden by it. */
  pinned?: { label: string; ids: string[] };
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [history, setHistory] = useState<History>({});

  const chosen = items.find((i) => i.id === value);
  const ranked = useMemo(() => rank(items, history, q, 0, 8), [items, history, q]);
  const more = useMemo(() => items.filter((i) => rank([i], history, q, 0, 1).length > 0).length - ranked.length, [items, history, q, ranked]);
  const first = useMemo(
    () => (q || !pinned ? [] : pinned.ids.map((id) => items.find((i) => i.id === id)).filter((i): i is (typeof items)[number] => !!i)),
    [items, pinned, q],
  );
  const frequent = useMemo(
    () => (q ? [] : usual(items, history, 5).filter((i) => !first.some((f) => f.id === i.id))),
    [items, history, q, first],
  );

  const show = () => {
    setHistory(loadHistory(getRecentsUser(), scope));
    setQ("");
    setOpen(true);
  };
  const pick = (id: string) => {
    const next = record(history, id, stamp());
    setHistory(next);
    saveHistory(getRecentsUser(), scope, next);
    onChange(id);
    setOpen(false);
  };

  return (
    <>
      <button type="button" className="picker-trigger" aria-haspopup="dialog" aria-label={chosen ? `${label}: ${chosen.label}` : label} onClick={show}>
        <span className={chosen ? "" : "picker-trigger__empty"}>{chosen ? chosen.label : (placeholder ?? `انتخاب ${label}`)}</span>
        <Icon name="chevron-down" size="md" />
      </button>
      <BottomSheet open={open} title={label} onClose={() => setOpen(false)} closeLabel="بستن فهرست">
        <div className="smartpicker">
          <HelpRow>
            <HelpHint title={`انتخاب ${label}`} label={`راهنمای انتخاب ${label}`}>
              <p className="mhelp__what">موردهایی که بیشتر انتخاب کرده‌اید بالای فهرست می‌آیند و با یک لمس انتخاب می‌شوند.</p>
              <p className="mhelp__how">برای پیدا کردن بقیه، نام را در کادر جستجو بنویسید.</p>
            </HelpHint>
          </HelpRow>
          {first.length > 0 && pinned && (
            <>
              <div className="tf-group">{pinned.label}</div>
              <div className="tf-grid">
                {first.map((i) => (
                  <AnswerButton key={i.id} icon="repeat" selected={i.id === value} onPress={() => pick(i.id)}>
                    {i.label}
                  </AnswerButton>
                ))}
              </div>
            </>
          )}
          {frequent.length > 0 && (
            <>
              <div className="tf-group">پرکاربردها</div>
              <div className="tf-grid">
                {frequent.map((i) => (
                  <AnswerButton key={i.id} icon="star" onPress={() => pick(i.id)}>
                    {i.label}
                  </AnswerButton>
                ))}
              </div>
            </>
          )}
          <AnswerSearch value={q} onChange={setQ} label={`جستجوی ${label}`} autoFocus={frequent.length === 0 && first.length === 0} />
          <AnswerList label={`فهرست ${label}`} items={ranked} selected={value} onPick={pick} />
          {more > 0 && <p className="tf-note">برای دیدن بقیه نام را جستجو کنید</p>}
          {clearLabel && value !== "" && (
            <SkipButton
              icon="x"
              onPress={() => {
                onChange("");
                setOpen(false);
              }}
            >
              {clearLabel}
            </SkipButton>
          )}
        </div>
      </BottomSheet>
    </>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
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
          {first.length > 0 && pinned && (
            <>
              <div className="tf-group">{pinned.label}</div>
              <div className="tf-grid">
                {first.map((i) => (
                  <button key={i.id} type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] tf-opt" aria-pressed={i.id === value} onClick={() => pick(i.id)}>
                    <Icon name="repeat" size="md" />
                    {i.label}
                  </button>
                ))}
              </div>
            </>
          )}
          {frequent.length > 0 && (
            <>
              <div className="tf-group">پرکاربردها</div>
              <div className="tf-grid">
                {frequent.map((i) => (
                  <button key={i.id} type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] tf-opt" onClick={() => pick(i.id)}>
                    <Icon name="star" size="md" />
                    {i.label}
                  </button>
                ))}
              </div>
            </>
          )}
          <input
            className="tf-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="جستجو…"
            aria-label={`جستجوی ${label}`}
            autoFocus={frequent.length === 0 && first.length === 0}
            autoComplete="off"
          />
          <div className="tf-grid one">
            {ranked.map((i) => (
              <button key={i.id} type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] tf-opt" aria-pressed={i.id === value} onClick={() => pick(i.id)}>
                <Icon name="check" size="md" />
                {i.label}
              </button>
            ))}
            {ranked.length === 0 && <p className="tf-note">چیزی پیدا نشد</p>}
          </div>
          {more > 0 && <p className="tf-note">برای دیدن بقیه نام را جستجو کنید</p>}
          {clearLabel && value !== "" && (
            <button
              type="button"
              className="inline-flex items-center justify-center gap-[var(--space-2)] tf-skip"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              <Icon name="x" size="md" />
              {clearLabel}
            </button>
          )}
        </div>
      </BottomSheet>
    </>
  );
}

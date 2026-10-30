"use client";

import { useEffect, useRef, useState } from "react";
import { JALALI_MONTHS, jalaliMonthLength, toJalali, todayJalali } from "@/lib/jalali";
import { reelDate } from "@/lib/dateReel";
import { faNum } from "@/lib/format";

const ROW = 44;

/** One drum: a column of rows that snaps so one sits in the middle band. */
function Drum({ items, index, onSettle, label }: { items: string[]; index: number; onSettle: (i: number) => void; label: string }) {
  const el = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (el.current) el.current.scrollTop = index * ROW;
  }, [index, items.length]);
  return (
    <div
      ref={el}
      className="datereel__drum"
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onScroll={(e) => {
        const top = e.currentTarget.scrollTop;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => onSettle(Math.max(0, Math.min(items.length - 1, Math.round(top / ROW)))), 120);
      }}
    >
      {items.map((t, i) => (
        <div key={t} role="option" aria-selected={i === index} className="datereel__row">{t}</div>
      ))}
    </div>
  );
}

/** Three drums (day, month, year) in Shamsi, over an ISO value. A day past the end of a short
 *  month is pulled back to the month's last day. `onChange` fires with the ISO day as the drums settle. */
export default function DateReel({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const start = (value && toJalali(value)) || todayJalali();
  const [jy, setY] = useState(start.jy);
  const [jm, setM] = useState(start.jm);
  const [jd, setD] = useState(start.jd);
  const years = Array.from({ length: 21 }, (_, i) => start.jy - 10 + i);
  const send = (y: number, m: number, d: number) => {
    const r = reelDate(y, m, d);
    setY(r.jy); setM(r.jm); setD(r.jd);
    onChange(r.iso);
  };
  const days = Array.from({ length: jalaliMonthLength(jy, jm) }, (_, i) => faNum(i + 1));
  return (
    <div className="datereel" dir="rtl">
      <div className="datereel__band" aria-hidden="true" />
      <Drum label="روز" items={days} index={jd - 1} onSettle={(i) => send(jy, jm, i + 1)} />
      <Drum label="ماه" items={[...JALALI_MONTHS]} index={jm - 1} onSettle={(i) => send(jy, i + 1, jd)} />
      <Drum label="سال" items={years.map((y) => faNum(y).replace(/٬/g, ""))} index={years.indexOf(jy)} onSettle={(i) => send(years[i], jm, jd)} />
    </div>
  );
}

"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import type { CustomStepApi } from "@/components/tapflow/TapFlow";
import { useChoiceFeedback } from "@/components/tapflow/useChoiceFeedback";
import { formatHours, WEEKDAY_LABEL, type HoursRange } from "@/lib/crm/hours";
import { faDigits } from "@/lib/crm/vocab";

const PRESETS: { label: string; days: number[] }[] = [
  { label: "همه‌روزه", days: [0, 1, 2, 3, 4, 5, 6] },
  { label: "شنبه تا چهارشنبه", days: [0, 1, 2, 3, 4] },
  { label: "به‌جز جمعه", days: [0, 1, 2, 3, 4, 5] },
];
const OPENS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 17, 18, 19];
const closesAfter = (from: number): number[] => [...Array.from({ length: 24 - from }, (_, i) => from + 1 + i), 1, 2];
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
const hourLabel = (h: number, closing: boolean) => (closing && h <= 2 ? `${faDigits(String(h))} بامداد` : faDigits(String(h)));

type Phase = "days" | "custom" | "from" | "to" | "more";

/** Working hours, one tap per screen: which days → opens → closes → another range? →
 *  done. Several ranges per day (۱۲–۱۶ و ۱۹–۲۴) and past-midnight closing are both normal
 *  for restaurants. */
export default function HoursPicker({ api }: { api: CustomStepApi }) {
  const [phase, setPhase] = useState<Phase>("days");
  const [days, setDays] = useState<number[]>([]);
  const [from, setFrom] = useState<number | null>(null);
  const [ranges, setRanges] = useState<HoursRange[]>([]);
  const feedback = useChoiceFeedback();
  const label = (t: string) => <p className="tf-group" style={{ fontSize: 14 }}>{t}</p>;
  // stay chips keep their own on/off state (weekday multi-select); pick chips light up for
  // the feedback beat, then run their onClick (state jump / next phase) after it.
  const chip = (key: string | number, text: string, on: boolean, onClick: () => void, cls = "") => (
    <button key={key} type="button" aria-pressed={on || feedback.selected === String(key)}
      className={`tf-opt ${cls}${on ? " on" : ""}${!on && feedback.selected === String(key) ? " on" : ""}`}
      disabled={feedback.selected !== null && feedback.selected !== String(key)}
      onClick={() => (on ? onClick() : feedback.choose(String(key), onClick))}>
      {text}
      {feedback.selected === String(key) ? <span className="tick" aria-hidden><Icon name="check" size="sm" /></span> : null}
    </button>
  );

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {ranges.length ? <div className="tf-card ok">{formatHours(ranges)}</div> : null}

      {phase === "days" && (
        <>
          {label(ranges.length ? "روزهای دیگر؟" : "کدام روزها باز است؟")}
          <div className="tf-grid">
            {PRESETS.map((p) => chip(p.label, p.label, false, () => { setDays(p.days); setPhase("from"); }))}
            {chip("custom", "روزهای خاص…", false, () => { setDays([]); setPhase("custom"); })}
          </div>
          {ranges.length === 0 ? <button type="button" className="tf-skip" onClick={() => api.submit("skip")}>نمی‌دانم</button> : null}
        </>
      )}

      {phase === "custom" && (
        <>
          {label("روزها را بزنید")}
          <div className="tf-grid three">
            {WEEKDAY_LABEL.map((d, i) => chip(i, d, days.includes(i), () => setDays((xs) => (xs.includes(i) ? xs.filter((x) => x !== i) : [...xs, i]))))}
          </div>
          <button type="button" className="tf-go" disabled={days.length === 0} onClick={() => setPhase("from")}>ادامه</button>
        </>
      )}

      {phase === "from" && (
        <>
          {label("از چه ساعتی؟")}
          <div className="tf-grid three">{OPENS.map((h) => chip(h, hourLabel(h, false), false, () => { setFrom(h); setPhase("to"); }))}</div>
        </>
      )}

      {phase === "to" && from !== null && (
        <>
          {label(`از ${faDigits(String(from))} تا چه ساعتی؟`)}
          <div className="tf-grid three">
            {closesAfter(from).map((h) => chip(h, hourLabel(h, true), false, () => {
              setRanges((rs) => [...rs, { days: [...days].sort((a, b) => a - b), from: hh(from), to: hh(h) }]);
              setPhase("more");
            }))}
          </div>
        </>
      )}

      {phase === "more" && (
        <>
          {label("بازهٔ دیگری هم دارد؟")}
          <div className="tf-grid">
            {chip("again", "بازهٔ دیگر در همین روزها", false, () => setPhase("from"))}
            {chip("other", "روزهای دیگر، ساعت دیگر", false, () => setPhase("days"))}
          </div>
          <button type="button" className="tf-go" onClick={() => api.submit("ok", JSON.stringify(ranges))}>تمام</button>
        </>
      )}
    </div>
  );
}

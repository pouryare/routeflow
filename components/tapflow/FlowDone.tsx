"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/meridian/Icon";
import { faDigits } from "@/lib/crm/vocab";
import { SkipButton } from "./Answer";

/** The done screen: what was saved, the likeliest next moves, and a return after `seconds`. */
export default function FlowDone({ chips, next, actions, seconds = 5, onReturn }: {
  chips: string[]; next?: string | null; actions?: ReactNode; seconds?: number; onReturn: () => void;
}) {
  const [left, setLeft] = useState(seconds);
  const ret = useRef(onReturn);
  const fired = useRef(false);
  useEffect(() => { ret.current = onReturn; });
  useEffect(() => {
    const t = window.setInterval(() => setLeft((l) => l - 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  const go = () => { if (!fired.current) { fired.current = true; ret.current(); } };
  useEffect(() => { if (left <= 0) go(); });

  return (
    <div className="tf-done">
      <div className="tf-tick"><Icon name="check" /></div>
      <p className="tf-q">ثبت شد</p>
      <div className="tf-chips">
        {chips.map((c) => <span key={c}>{c}</span>)}
        {next ? <span className="nx">{next}</span> : null}
      </div>
      {actions ? <div className="tf-acts">{actions}</div> : null}
      <p className="tf-sub">برگشت به فهرست در {faDigits(String(Math.max(left, 0)))}…</p>
      <SkipButton icon="undo" onPress={go}>همین حالا برگرد</SkipButton>
    </div>
  );
}

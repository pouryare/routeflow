"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import ReminderFlow from "@/components/flows/ReminderFlow";
import type { QuickAction } from "@/lib/mobileNav";

/** One «+ ثبت» button above the bar: the things done standing up, from any page. A reminder or
 *  note opens its tap flow right here; the rest take you to the page whose own flow opens on
 *  arrival (`?new=1`). Which actions appear is decided per role in `quickActionsFor`, so nothing
 *  here leads to a refusal. Phone only (CSS). */
export default function QuickActions({ actions }: { actions: QuickAction[] }) {
  const [sheet, setSheet] = useState(false);
  const [flow, setFlow] = useState<{ key: number; open: boolean; kind: "reminder" | "note" } | null>(null);
  if (actions.length === 0) return null;

  return (
    <>
      <button type="button" className="qa-fab" aria-haspopup="dialog" onClick={() => setSheet(true)}>
        <Icon name="plus" size="md" />
        <span>ثبت</span>
      </button>
      <BottomSheet open={sheet} title="چه چیزی ثبت کنیم؟" onClose={() => setSheet(false)}>
        <div className="tf-grid one">
          {actions.map((a) =>
            a.href ? (
              <Link key={a.id} href={a.href} className="inline-flex items-center justify-center gap-[var(--space-2)] tf-opt" onClick={() => setSheet(false)}>
                <Icon name={a.icon} size="md" />
                {a.label}
              </Link>
            ) : (
              <button
                key={a.id}
                type="button"
                className="inline-flex items-center justify-center gap-[var(--space-2)] tf-opt"
                onClick={() => {
                  setSheet(false);
                  setFlow((f) => ({ key: (f?.key ?? 0) + 1, open: true, kind: a.id === "note" ? "note" : "reminder" }));
                }}
              >
                <Icon name={a.icon} size="md" />
                {a.label}
              </button>
            ),
          )}
        </div>
      </BottomSheet>
      {flow && (
        <ReminderFlow
          key={flow.key}
          open={flow.open}
          kind={flow.kind}
          onAdded={() => {}}
          onClose={() => setFlow((f) => (f ? { ...f, open: false } : f))}
          onReopen={() => setFlow((f) => (f ? { ...f, open: true } : f))}
        />
      )}
    </>
  );
}

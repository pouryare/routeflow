"use client";

import { AnswerButton, AnswerLink } from "@/components/tapflow/Answer";
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
      <BottomSheet open={sheet} title="چه چیزی ثبت کنیم؟" onClose={() => setSheet(false)} closeLabel="بستن ثبت سریع">
        <div className="tf-grid one">
          {actions.map((a) =>
            a.href ? (
              <AnswerLink key={a.id} href={a.href} icon={a.icon} onPress={() => setSheet(false)}>{a.label}</AnswerLink>
            ) : (
              <AnswerButton
                key={a.id}
                icon={a.icon}
                onPress={() => {
                  setSheet(false);
                  setFlow((f) => ({ key: (f?.key ?? 0) + 1, open: true, kind: a.id === "note" ? "note" : "reminder" }));
                }}
              >
                {a.label}
              </AnswerButton>
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

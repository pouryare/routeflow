"use client";

import CollapsibleSection from "@/components/CollapsibleSection";
import { Icon } from "@/components/meridian/Icon";

export interface DueReminder {
  id: number;
  entity_type: "district" | "customer";
  entity_id: number;
  due_date: string;
  message: string;
  label: string;
}

/** The sidebar's «یادآوری‌های امروز» list. State and handlers stay in CoverageMap.. */
export default function DueRemindersSection({ dueReminders, openReminderEntity, resolveReminder }: {
  dueReminders: DueReminder[];
  openReminderEntity: (r: DueReminder) => void;
  resolveReminder: (id: number) => void;
}) {
  if (!(dueReminders.length > 0)) return null;
  return (
        <CollapsibleSection help="card.map-reminders"
          title="یادآوری‌های امروز" icon="bell"
          count={dueReminders.length}
          defaultOpen
        >
          <div className="flex flex-col gap-1.5">
            {dueReminders.map((r) => (
              <div
                key={r.id}
                className="flex items-start gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2"
              >
                <button
                  onClick={() => openReminderEntity(r)}
                  className="flex-1 text-right text-[length:var(--text-sm)] text-text hover:text-accent"
                >
                  <Icon name="clock" size="sm" />
                  <div className="font-medium">{r.label}</div>
                  <div className="text-[length:var(--text-xs)] text-text-muted">{r.message}</div>
                </button>
                <button
                  onClick={() => resolveReminder(r.id)}
                  aria-label="انجام شد"
                  className="shrink-0 text-good hover:opacity-80"
                >
                  <Icon name="check" size="sm" />
                </button>
              </div>
            ))}
          </div>
        </CollapsibleSection>
  );
}

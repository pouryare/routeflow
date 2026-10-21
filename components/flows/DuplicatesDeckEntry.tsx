"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/meridian/Icon";
import DecisionDeck from "@/components/mobile/DecisionDeck";
import { useUndoableAction } from "@/components/tapflow/useUndoableAction";
import { DUP_CHOICES, DUP_CONSEQUENCE, dupRequest } from "@/lib/decisions";
import { DUP_REASON_LABEL } from "@/lib/duplicates";
import { faNum } from "@/lib/format";
import type { DupPair, DupSideCard } from "@/lib/repo/crm/duplicates";

const side = (s: DupSideCard) => `${s.name} · ${faNum(s.orders)} سفارش${s.area ? ` · ${s.area}` : ""}`;

/** «مشتریان تکراری» for a manager: each pair of records that look like one business as a card —
 *  merge, or say they are two. The list is the page's snapshot at open time. */
export default function DuplicatesDeckEntry({ pairs }: { pairs: DupPair[] }) {
  const router = useRouter();
  const undoable = useUndoableAction();
  const [deck, setDeck] = useState({ key: 0, open: false });
  if (pairs.length === 0) return null;

  const decide = (p: DupPair, verdict: string) =>
    undoable.run({
      message: verdict === "merge" ? `«${p.drop.name}» در «${p.keep.name}» ادغام شد` : "دو مشتری جدا ثبت شدند",
      send: async () => {
        const res = await fetch("/api/crm/businesses/duplicates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(dupRequest(verdict, p.keep.id, p.drop.id)),
        });
        return res.ok ? { ok: true } : { ok: false, error: ((await res.json().catch(() => null)) as { error?: string } | null)?.error };
      },
      failure: "تصمیم ثبت نشد؛ دوباره تلاش کنید",
      onDone: () => router.refresh(),
    });

  return (
    <>
      <button
        type="button"
        onClick={() => setDeck((d) => ({ key: d.key + 1, open: true }))}
        className="inline-flex min-h-[44px] items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)] text-[var(--text)]"
      >
        <Icon name="users" size="md" />
        {`مشتریان تکراری · ${faNum(pairs.length)} مورد`}
      </button>
      {deck.key > 0 && (
        <DecisionDeck
          key={deck.key}
          open={deck.open}
          title="مشتریان تکراری"
          items={pairs}
          keyOf={(p) => `${p.keep.id}-${p.drop.id}`}
          choices={DUP_CHOICES}
          onDecide={decide}
          onClose={() => setDeck((d) => ({ ...d, open: false }))}
          render={(p) => (
            <>
              <strong>{DUP_REASON_LABEL[p.reason]}</strong>
              <span>نگه داشته می‌شود: {side(p.keep)}</span>
              <span>ادغام می‌شود: {side(p.drop)}</span>
              <span className="text-text-muted">ادغام: {DUP_CONSEQUENCE.merge} جدا: {DUP_CONSEQUENCE.separate}</span>
            </>
          )}
        />
      )}
    </>
  );
}

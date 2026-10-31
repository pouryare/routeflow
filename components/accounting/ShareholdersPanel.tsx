"use client";

import { Icon } from "@/components/meridian/Icon";
import { useState } from "react";
import SectionHead from "@/components/meridian/SectionHead";
import EmptyState from "@/components/EmptyState";
import BottomSheet from "@/components/mobile/BottomSheet";
import StickyAction from "@/components/mobile/StickyAction";
import KeypadField from "@/components/mobile/KeypadField";
import PersianDateField from "@/components/PersianDateField";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import AcctTable, { CELL, NUM } from "@/components/accounting/AcctTable";
import { GoButton } from "@/components/tapflow/Answer";
import { usePostAction } from "@/lib/usePostAction";
import { faNum } from "@/lib/format";

interface Shareholder { id: number; name: string; userId: number | null }
interface Share { partyId: number; percentBp: number }

const FORM_LABEL = { registered: "ثبت‌شده", unregistered: "ثبت‌نشده" } as const;
const percentOf = (bp: number) => faNum(bp / 100, { maximumFractionDigits: 2 });

/** The one typed field of the page: a name, and optionally which login this partner signs in with. */
function AddShareholderSheet({ open, users, onClose }: { open: boolean; users: { id: number; name: string }[]; onClose: () => void }) {
  const add = usePostAction();
  const [name, setName] = useState("");
  const [userId, setUserId] = useState("");
  return (
    <BottomSheet open={open} title="افزودن شریک" onClose={onClose} closeLabel="بستن افزودن شریک" dirty={name.trim() !== ""}>
      <label htmlFor="shareholder-name">نام شریک</label>
      <input id="shareholder-name" className="touch" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      {users.length > 0 && (
        <div className="filterchips"><div className="filterchips__row">
          <ChipGroup
            group={{
              id: "shareholder-user",
              label: "ورود به سامانه (اختیاری)",
              mode: "single",
              options: users.map((u) => ({ id: String(u.id), label: u.name })),
              value: userId,
              onChange: (v) => setUserId(v as string),
            }}
          />
        </div></div>
      )}
      {add.message && <p role="status" className={add.message.kind === "error" ? "text-danger" : "text-muted"}>{add.message.text}</p>}
      <GoButton
        isDisabled={add.busy || !name.trim()}
        onPress={async () => {
          const ok = await add.send("/api/accounting/shareholders", { name, user_id: userId ? Number(userId) : null }, "شریک اضافه شد");
          if (ok) { setName(""); setUserId(""); onClose(); }
        }}
      >
        {add.busy ? "در حال ثبت…" : "ثبت شریک"}
      </GoButton>
    </BottomSheet>
  );
}

/** Shareholders, shares and the legal form on one phone screen. Typing is only for a name; shares go
 *  in on the keypad, the start day and the legal form are taps. The «ذخیره» stays off until the shares
 *  total exactly 100%, because a set that does not add up would split more or less than the profit. */
export default function ShareholdersPanel({ legalForm, shareholders, groups, users, scopes, today }: {
  legalForm: "registered" | "unregistered";
  shareholders: Shareholder[];
  groups: { id: number; name: string }[];
  users: { id: number; name: string }[];
  scopes: Record<string, Share[]>;
  today: string;
}) {
  const form = usePostAction();
  const shares = usePostAction();
  const [addOpen, setAddOpen] = useState(false);
  const [sharesOpen, setSharesOpen] = useState(false);
  const [scope, setScope] = useState("company");
  const [from, setFrom] = useState(today);
  const [draft, setDraft] = useState<Record<number, string>>({});

  const current = scopes.company ?? [];
  const bpOf = (list: Share[], id: number) => list.find((s) => s.partyId === id)?.percentBp ?? 0;
  const startEditing = (nextScope: string) => {
    setScope(nextScope);
    setDraft(Object.fromEntries(shareholders.map((s) => [s.id, bpOf(scopes[nextScope] ?? [], s.id) ? String(bpOf(scopes[nextScope] ?? [], s.id) / 100) : ""])));
  };
  const total = shareholders.reduce((t, s) => t + Math.round(Number(draft[s.id] || 0) * 100), 0);
  const exact = total === 10000;

  const save = async () => {
    const ok = await shares.send(
      "/api/accounting/shareholders/shares",
      {
        group_id: scope === "company" ? null : Number(scope),
        valid_from: from,
        shares: shareholders.map((s) => ({ party_id: s.id, percent: Number(draft[s.id] || 0) })),
      },
      "سهم‌ها ثبت شد"
    );
    if (ok) setSharesOpen(false);
  };

  return (
    <div data-has-primary-bar>
      <SectionHead title="نوع شرکت" sub="ثبت‌شده: سهامی یا با مسئولیت محدود، با اندوختهٔ قانونی و تأیید مجمع. ثبت‌نشده: مشارکت مدنی." />
      <div className="filterchips"><div className="filterchips__row">
      <ChipGroup
        group={{
          id: "legal-form",
          label: "نوع شرکت",
          mode: "single",
          options: (["registered", "unregistered"] as const).map((id) => ({ id, label: FORM_LABEL[id] })),
          value: legalForm,
          neutral: "__none__",
          onChange: (v) => { if (v && v !== legalForm) void form.send("/api/accounting/legal-form", { legal_form: v }, "نوع شرکت ثبت شد"); },
        }}
      />
      </div></div>
      {form.message && <p role="status" className={form.message.kind === "error" ? "text-danger" : "text-muted"}>{form.message.text}</p>}

      <SectionHead
        title="شرکا"
        sub={shareholders.length ? `${faNum(shareholders.length)} شریک · سهم امروز` : undefined}
      />
      {shareholders.length === 0 ? (
        <EmptyState
          icon="users"
          title="هنوز شریکی ثبت نشده"
          hint="با «افزودن شریک» شروع کنید؛ بعد درصد سهم هرکدام را با تاریخ شروع ثبت کنید."
        />
      ) : (
        <AcctTable head={["شریک", "سهم امروز"]}>
          {shareholders.map((s) => (
            <tr key={s.id} className="border-t border-border">
              <td className={CELL}>{s.name}{s.userId != null && <small> · با ورود به سامانه</small>}</td>
              <td className={NUM}>{current.length ? `${percentOf(bpOf(current, s.id))}٪` : "—"}</td>
            </tr>
          ))}
        </AcctTable>
      )}
      {shareholders.length > 0 && (
        <button type="button" className="touch picker-trigger" onClick={() => { startEditing("company"); setSharesOpen(true); }}>
          <Icon name="settings" size="md" />
          تنظیم درصد سهم‌ها
        </button>
      )}

      <div className="sticky-action-gap" />
      <StickyAction label="افزودن شریک" icon="plus" onClick={() => setAddOpen(true)} />

      <AddShareholderSheet open={addOpen} users={users} onClose={() => setAddOpen(false)} />

      <BottomSheet open={sharesOpen} title="درصد سهم‌ها" subtitle="جمع باید دقیقاً ۱۰۰٪ شود" onClose={() => setSharesOpen(false)} closeLabel="بستن درصد سهم‌ها">
        {groups.length > 0 && (
          <div className="filterchips"><div className="filterchips__row">
          <ChipGroup
            group={{
              id: "share-scope",
              label: "برای",
              mode: "single",
              options: [{ id: "company", label: "کل شرکت" }, ...groups.map((g) => ({ id: String(g.id), label: g.name }))],
              value: scope,
              neutral: "__none__",
              onChange: (v) => startEditing((v as string) || "company"),
            }}
          />
          </div></div>
        )}
        <PersianDateField value={from} onChange={setFrom} ariaLabel="از تاریخ" />
        {shareholders.map((s) => (
          <KeypadField
            key={s.id}
            label={s.name}
            unit="٪"
            decimal
            value={draft[s.id] ?? ""}
            onChange={(v) => setDraft((d) => ({ ...d, [s.id]: v }))}
          />
        ))}
        <p role="status" className={exact ? "text-muted" : "text-danger"}>
          جمع: {percentOf(total)}٪{exact ? " (کامل)" : " (باید ۱۰۰٪ باشد)"}
        </p>
        {shares.message && <p role="status" className={shares.message.kind === "error" ? "text-danger" : "text-muted"}>{shares.message.text}</p>}
        <GoButton icon="save" isDisabled={shares.busy || !exact} onPress={save}>
          {shares.busy ? "در حال ثبت…" : "ذخیره از این تاریخ"}
        </GoButton>
      </BottomSheet>
    </div>
  );
}

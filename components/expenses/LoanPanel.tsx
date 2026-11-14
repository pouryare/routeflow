"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SectionHead from "@/components/meridian/SectionHead";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import KeypadField from "@/components/mobile/KeypadField";
import SmartPicker from "@/components/mobile/SmartPicker";
import { FieldInput } from "@/components/FieldInput";
import { GoButton } from "@/components/tapflow/Answer";
import { idemKeeper } from "@/lib/idemKey";
import { friendlyError } from "@/lib/userMessage";
import { faNum, faToman } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import { toNumber } from "@/lib/money";
import { LOAN_KIND_LABEL } from "@/lib/staffLoans";
import type { AdvanceRequest, LoanEntry, LoanPerson } from "@/lib/repo/staffLoans";

const btn = "inline-flex min-h-[44px] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border px-[var(--space-3)] text-[length:var(--text-sm)]";
const METHODS = [{ id: "CASH", label: "از صندوق" }, { id: "TRANSFER", label: "از بانک" }];

/** One call to the loan route; returns the error in words, or null when it worked. */
function useLoanCall() {
  const router = useRouter();
  const [idem] = useState(idemKeeper);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function call(body: object): Promise<boolean> {
    setBusy(true); setError(null);
    const res = await fetch("/api/staff-loans", { method: "POST", headers: { "Content-Type": "application/json", ...idem.headers() }, body: JSON.stringify(body) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) { idem.renew(); router.refresh(); return true; }
    setError(friendlyError(j?.error, "انجام نشد؛ دوباره تلاش کنید"));
    return false;
  }
  return { call, busy, error };
}

const ErrorLine = ({ text }: { text: string | null }) => (text ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }} role="status">{text}</p> : null);

/** The owner gives an advance or loan; a group manager asks for one (the owner approves). Same form, different button. */
export function AdvanceForm({ people, mode }: { people: { id: string; label: string }[]; mode: "give" | "request" }) {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState("");
  const [amount, setAmount] = useState("");
  const [hint, setHint] = useState("");
  const [note, setNote] = useState("");
  const [method, setMethod] = useState("CASH");
  const { call, busy, error } = useLoanCall();
  const a = toNumber(amount) ?? 0;
  async function save() {
    const h = toNumber(hint);
    const ok = await call({ action: mode, user_id: Number(who), amount_toman: a, method, note, monthly_hint: h && h > 0 ? h : null });
    if (ok) { setOpen(false); setWho(""); setAmount(""); setHint(""); setNote(""); }
  }
  return (
    <section data-tour="loan-give">
      <button type="button" onClick={() => setOpen(true)} className={`${btn} border-[var(--accent)]`}>
        <Icon name="wallet" size="md" /> {mode === "give" ? "مساعده یا وام به کارمند" : "درخواست مساعده برای کارمند"}
      </button>
      <BottomSheet open={open} title={mode === "give" ? "مساعده یا وام" : "درخواست مساعده"} onClose={() => setOpen(false)} closeLabel="بستن">
        <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
          <SmartPicker scope="loan-people" label="کارمند" items={people} value={who} onChange={setWho} placeholder="کارمند" />
          <KeypadField label="مبلغ" value={amount} onChange={setAmount} unit="تومان" />
          <KeypadField label="قسط پیشنهادی هر ماه (اختیاری)" value={hint} onChange={setHint} unit="تومان" />
          <FieldInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="توضیح (اختیاری)" aria-label="توضیح" maxLength={200} />
          {mode === "give" ? <ChipGroup wrap group={{ id: "loan-method", label: "پرداخت", mode: "single", neutral: "__none", value: method, onChange: (v) => { if (typeof v === "string") setMethod(v); }, options: METHODS }} /> : <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">مالک درخواست را می‌بیند و اگر تأیید کند پرداخت می‌شود.</p>}
          <ErrorLine text={error} />
          <GoButton icon="save" isDisabled={busy || !who || a <= 0} onPress={() => void save()}>{mode === "give" ? "پرداخت مساعده" : "ارسال درخواست"}</GoButton>
        </div>
      </BottomSheet>
    </section>
  );
}

/** The owner decides a manager's request: approve (and pay from the cash box or the bank) or reject with a reason. */
export function AdvanceRequestCard({ req }: { req: AdvanceRequest }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const { call, busy, error } = useLoanCall();
  return (
    <section className="card mb-[var(--space-3)] flex flex-col gap-[var(--space-2)] p-[var(--space-4)]" data-tour="loan-request">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{req.userName}</span>
        <span className="tnum font-medium">{faToman(req.amountToman)}</span>
      </div>
      <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">درخواست {req.requestedByName} · {faJalaliDate(req.createdAt)}{req.monthlyHint ? ` · قسط پیشنهادی ${faToman(req.monthlyHint)}` : ""}{req.note ? ` · ${req.note}` : ""}</p>
      {rejecting ? <FieldInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="دلیل رد" aria-label="دلیل رد" maxLength={200} /> : null}
      <ErrorLine text={error} />
      <div className="flex flex-wrap gap-[var(--space-2)]">
        {rejecting ? (
          <button type="button" disabled={busy || !reason.trim()} onClick={() => void call({ action: "decide", id: req.id, verdict: "reject", reason })} className={`${btn} border-[var(--danger)]`}><Icon name="x" size="md" /> ثبت رد</button>
        ) : (
          <>
            <button type="button" disabled={busy} onClick={() => void call({ action: "decide", id: req.id, verdict: "approve", method: "CASH" })} className={`${btn} border-[var(--accent)]`}><Icon name="check" size="md" /> تأیید و پرداخت نقدی</button>
            <button type="button" disabled={busy} onClick={() => void call({ action: "decide", id: req.id, verdict: "approve", method: "TRANSFER" })} className={`${btn} border-[var(--border)]`}><Icon name="check" size="md" /> تأیید و پرداخت از بانک</button>
            <button type="button" disabled={busy} onClick={() => setRejecting(true)} className={`${btn} border-[var(--border)]`}><Icon name="x" size="md" /> رد</button>
          </>
        )}
      </div>
    </section>
  );
}

/** The owner's row for one person who owes money: balance, the monthly hint, a reminder tag, and two buttons (repayment, forgive). */
export function LoanPersonCard({ person }: { person: LoanPerson }) {
  const [mode, setMode] = useState<"repay" | "writeoff" | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState("CASH");
  const { call, busy, error } = useLoanCall();
  const a = toNumber(amount) ?? 0;
  async function save() {
    const ok = mode === "repay"
      ? await call({ action: "repay", user_id: person.userId, amount_toman: a, method })
      : await call({ action: "writeoff", user_id: person.userId, amount_toman: a, reason });
    if (ok) { setMode(null); setAmount(""); setReason(""); }
  }
  return (
    <section className="card mb-[var(--space-3)] flex flex-col gap-[var(--space-2)] p-[var(--space-4)]" data-tour="loan-person">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{person.name}</span>
        <span className="tnum font-medium">{faToman(person.balanceToman)}</span>
      </div>
      <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">
        آخرین تغییر {faJalaliDate(person.lastMoveAt)}{person.monthlyHint ? ` · قسط پیشنهادی ${faToman(person.monthlyHint)}` : ""}
      </p>
      {person.reminderDue ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>مدتی است بازپرداختی نشده است</p> : null}
      {person.balanceToman > 0 ? (
        <div className="flex flex-wrap gap-[var(--space-2)]">
          <button type="button" onClick={() => setMode("repay")} className={`${btn} border-[var(--accent)]`}><Icon name="banknote" size="md" /> بازپرداخت نقدی</button>
          <button type="button" onClick={() => setMode("writeoff")} className={`${btn} border-[var(--border)]`}><Icon name="x" size="md" /> بخشودگی</button>
        </div>
      ) : null}
      <BottomSheet open={mode !== null} title={mode === "repay" ? `بازپرداخت ${person.name}` : `بخشودگی وام ${person.name}`} onClose={() => setMode(null)} closeLabel="بستن">
        <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
          <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">مانده وام: {faToman(person.balanceToman)}</p>
          <KeypadField label="مبلغ" value={amount} onChange={setAmount} unit="تومان" />
          {mode === "repay"
            ? <ChipGroup wrap group={{ id: "repay-method", label: "دریافت", mode: "single", neutral: "__none", value: method, onChange: (v) => { if (typeof v === "string") setMethod(v); }, options: [{ id: "CASH", label: "به صندوق" }, { id: "TRANSFER", label: "به بانک" }] }} />
            : <FieldInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="دلیل بخشودگی (به‌عنوان هزینه ثبت می‌شود)" aria-label="دلیل بخشودگی" maxLength={200} />}
          <ErrorLine text={error} />
          <GoButton icon="save" isDisabled={busy || a <= 0 || (mode === "writeoff" && !reason.trim())} onPress={() => void save()}>{mode === "repay" ? "ثبت بازپرداخت" : "ببخش"}</GoButton>
        </div>
      </BottomSheet>
      <ErrorLine text={mode ? null : error} />
    </section>
  );
}

/** A person's own view: what they owe the company and every movement, newest first. */
export function MyLoan({ balance, entries }: { balance: number; entries: LoanEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <>
      <SectionHead title="مساعده و وام من" sub={balance > 0 ? `مانده بدهی شما: ${faToman(balance)}` : "بدهی شما صفر است."} />
      <ul className="m-0 mb-[var(--space-4)] flex list-none flex-col gap-[var(--space-2)] p-0" data-tour="loan-mine">
        {entries.map((e) => (
          <li key={e.id} className="card flex flex-col gap-[var(--space-1)] p-[var(--space-3)]">
            <div className="flex justify-between gap-2">
              <span>{LOAN_KIND_LABEL[e.kind]}</span>
              <span className="tnum">{e.kind === "advance" ? "+" : "−"}{faNum(e.amountToman)}</span>
            </div>
            <span className="text-[length:var(--text-sm)] text-[var(--muted)]">{faJalaliDate(e.createdAt)}{e.monthlyHint ? ` · قسط پیشنهادی ${faToman(e.monthlyHint)}` : ""}{e.note ? ` · ${e.note}` : ""}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

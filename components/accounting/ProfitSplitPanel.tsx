"use client";

import { useState } from "react";
import SectionHead from "@/components/meridian/SectionHead";
import EmptyState from "@/components/EmptyState";
import BottomSheet from "@/components/mobile/BottomSheet";
import KeypadField from "@/components/mobile/KeypadField";
import PersianDateField from "@/components/PersianDateField";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import AcctTable, { CELL, NUM } from "@/components/accounting/AcctTable";
import { GoButton } from "@/components/tapflow/Answer";
import { usePostAction } from "@/lib/usePostAction";
import { faNum, faToman } from "@/lib/format";
import type { SplitPreview } from "@/lib/repo/profitSplit";

interface Balance { partyId: number; name: string; dividendsOwedToman: number; advancesToman: number }
type Rule = "sales_share" | "company";

const METHODS = [{ id: "CASH", label: "نقد" }, { id: "CARD_TO_CARD", label: "کارت به کارت" }, { id: "POS", label: "کارتخوان" }];
const Row = ({ children }: { children: React.ReactNode }) => <div className="filterchips"><div className="filterchips__row">{children}</div></div>;

/** What a partner has taken and is owed, the yearly split (preview, then post) and the rule for shared costs.
 *  Nothing here edits a journal: the split and the payments each post their own, and a year can be split once. */
export default function ProfitSplitPanel({ legalForm, balances, years, costAccounts, today, hasShareholders }: {
  legalForm: "registered" | "unregistered";
  balances: Balance[];
  years: number[];
  costAccounts: { id: number; name: string; mode: Rule }[];
  today: string;
  hasShareholders: boolean;
}) {
  const split = usePostAction();
  const pay = usePostAction();
  const rule = usePostAction();
  const [year, setYear] = useState("");
  const [preview, setPreview] = useState<SplitPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [approvedOn, setApprovedOn] = useState(today);
  const [payOpen, setPayOpen] = useState(false);
  const [party, setParty] = useState("");
  const [kind, setKind] = useState("advance");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [paidOn, setPaidOn] = useState(today);
  const [error, setError] = useState<string | null>(null);

  const load = async (y: string) => {
    setYear(y);
    setPreview(null);
    setError(null);
    if (!y) return;
    setLoading(true);
    try {
      const res = await fetch("/api/accounting/profit-split", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ year: Number(y) }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.error ?? "محاسبه نشد؛ دوباره تلاش کنید");
      else setPreview(json.preview);
    } finally {
      setLoading(false);
    }
  };

  if (!hasShareholders) return null;
  const canPost = preview && !preview.alreadyDone && preview.distributedToman + preview.reserveToman > 0;

  return (
    <>
      <SectionHead title="علی‌الحساب و سود پرداخت‌نشده" sub="آنچه هر شریک برداشته و آنچه هنوز به او نداده‌ایم" />
      <AcctTable head={["شریک", "علی‌الحساب", "سود مانده"]}>
        {balances.map((b) => (
          <tr key={b.partyId} className="border-t border-border">
            <td className={CELL}>{b.name}</td>
            <td className={NUM}>{b.advancesToman ? faNum(b.advancesToman) : "—"}</td>
            <td className={NUM}>{b.dividendsOwedToman ? faNum(b.dividendsOwedToman) : "—"}</td>
          </tr>
        ))}
      </AcctTable>
      <button type="button" className="touch picker-trigger" onClick={() => setPayOpen(true)}>ثبت پرداخت به شریک</button>

      <SectionHead title="تقسیم سود سال" sub={legalForm === "registered" ? "شرکت ثبت‌شده: اندوختهٔ قانونی کم می‌شود و تاریخ تأیید مجمع لازم است" : "طبق توافق شرکا"} />
      <Row>
        <ChipGroup group={{ id: "split-year", label: "سال", mode: "single", options: years.map((y) => ({ id: String(y), label: faNum(y, { useGrouping: false }) })), value: year, onChange: (v) => void load(v as string) }} />
      </Row>
      {loading && <p role="status" className="text-muted">در حال محاسبه…</p>}
      {error && <p role="alert" className="text-danger">{error}</p>}
      {!year && !loading && <EmptyState icon="chart" title="سالی را انتخاب کنید" hint="سود همان سال از دفتر خوانده می‌شود و پیش از ثبت، پیش‌نمایش آن را می‌بینید." />}
      {preview && (
        <div data-testid="split-preview">
          <p>سود سال: <b className="tnum">{faToman(preview.totalProfitToman)}</b></p>
          {preview.groups.length > 0 && (
            <AcctTable head={["گروه", "سود", "بازپرداخت زیان", "به شرکای گروه"]}>
              {preview.groups.map((g) => (
                <tr key={g.groupId} className="border-t border-border">
                  <td className={CELL}>{g.name}</td>
                  <td className={NUM}>{faNum(g.profitToman)}</td>
                  <td className={NUM}>{g.repaidToman ? faNum(g.repaidToman) : g.lossAfterToman ? `${faNum(g.lossAfterToman)} مانده` : "—"}</td>
                  <td className={NUM}>{faNum(g.distributableToman)}</td>
                </tr>
              ))}
            </AcctTable>
          )}
          {preview.reserveToman > 0 && <p>اندوختهٔ قانونی: <b className="tnum">{faToman(preview.reserveToman)}</b></p>}
          {preview.parties.length > 0 && (
            <AcctTable head={["شریک", "سهم از سود", "علی‌الحساب کسر‌شده", "قابل پرداخت"]}>
              {preview.parties.map((p) => (
                <tr key={p.partyId} className="border-t border-border">
                  <td className={CELL}>{p.name}</td>
                  <td className={NUM}>{faNum(p.grossToman)}</td>
                  <td className={NUM}>{p.advanceNettedToman ? faNum(p.advanceNettedToman) : "—"}</td>
                  <td className={NUM}>{faNum(p.netPayableToman)}</td>
                </tr>
              ))}
            </AcctTable>
          )}
          {preview.warnings.map((w) => <p key={w} role="status" className="text-muted">{w}</p>)}
          {preview.alreadyDone && <p role="status" className="text-muted">سود این سال قبلاً تقسیم شده است.</p>}
          {!preview.alreadyDone && !canPost && preview.totalProfitToman >= 0 && preview.warnings.length === 0 && (
            <p role="status" className="text-muted">برای تقسیم در این سال سودی نیست.</p>
          )}
          {canPost && preview.needsApproval && <PersianDateField value={approvedOn} onChange={setApprovedOn} ariaLabel="تاریخ تأیید مجمع" />}
          {split.message && <p role="status" className={split.message.kind === "error" ? "text-danger" : "text-muted"}>{split.message.text}</p>}
          {canPost && (
            <GoButton
              isDisabled={split.busy || (preview.needsApproval && !approvedOn)}
              onPress={async () => {
                const ok = await split.send("/api/accounting/profit-split", { year: Number(year), commit: true, approved_on: preview.needsApproval ? approvedOn : null }, "تقسیم سود ثبت شد");
                if (ok) void load(year);
              }}
            >
              {split.busy ? "در حال ثبت…" : "ثبت تقسیم سود"}
            </GoButton>
          )}
        </div>
      )}

      {costAccounts.length > 0 && (
        <>
          <SectionHead title="هزینه‌های مشترک" sub="هزینه‌ای که گروهی ندارد: بین گروه‌ها به نسبت فروش تقسیم شود یا در سطح شرکت بماند" />
          {costAccounts.map((a) => (
            <div key={a.id}>
              <p>{a.name}</p>
              <Row>
                <ChipGroup
                  group={{
                    id: `rule-${a.id}`, label: a.name, mode: "single", neutral: "__none__", value: a.mode,
                    options: [{ id: "sales_share", label: "به نسبت فروش" }, { id: "company", label: "سطح شرکت" }],
                    onChange: (v) => { if (v && v !== a.mode) void rule.send("/api/accounting/cost-rules", { account_id: a.id, mode: v }, "قاعده ثبت شد"); },
                  }}
                />
              </Row>
            </div>
          ))}
          {rule.message && <p role="status" className={rule.message.kind === "error" ? "text-danger" : "text-muted"}>{rule.message.text}</p>}
        </>
      )}

      <BottomSheet open={payOpen} title="پرداخت به شریک" onClose={() => setPayOpen(false)} closeLabel="بستن پرداخت به شریک">
        <Row>
          <ChipGroup group={{ id: "pay-kind", label: "نوع", mode: "single", neutral: "__none__", value: kind, options: [{ id: "advance", label: "علی‌الحساب" }, { id: "dividend", label: "پرداخت سود" }], onChange: (v) => setKind((v as string) || "advance") }} />
        </Row>
        <Row>
          <ChipGroup group={{ id: "pay-party", label: "شریک", mode: "single", value: party, options: balances.map((b) => ({ id: String(b.partyId), label: b.name })), onChange: (v) => setParty(v as string) }} />
        </Row>
        <KeypadField label="مبلغ" unit="تومان" value={amount} onChange={setAmount} />
        <Row>
          <ChipGroup group={{ id: "pay-method", label: "روش", mode: "single", neutral: "__none__", value: method, options: METHODS, onChange: (v) => setMethod((v as string) || "CASH") }} />
        </Row>
        <PersianDateField value={paidOn} onChange={setPaidOn} ariaLabel="تاریخ پرداخت" />
        {pay.message && <p role="status" className={pay.message.kind === "error" ? "text-danger" : "text-muted"}>{pay.message.text}</p>}
        <GoButton
          isDisabled={pay.busy || !party || !Number(amount)}
          onPress={async () => {
            const ok = await pay.send("/api/accounting/shareholders/payments", { party_id: Number(party), kind, amount_toman: Number(amount), method, paid_on: paidOn }, "پرداخت ثبت شد");
            if (ok) { setAmount(""); setPayOpen(false); }
          }}
        >
          {pay.busy ? "در حال ثبت…" : "ثبت پرداخت"}
        </GoButton>
      </BottomSheet>
    </>
  );
}

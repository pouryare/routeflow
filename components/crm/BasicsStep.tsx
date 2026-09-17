"use client";

import { useEffect, useState } from "react";
import type { CustomStepApi } from "@/components/tapflow/TapFlow";
import { useToast } from "@/components/ToastProvider";
import { basicsOf, linkOf, pinOf } from "@/lib/crm/flows/addLead";
import { FOOD_APP_SOURCES, faDigits } from "@/lib/crm/vocab";
import { normPhone } from "@/lib/crm/phone";
import type { DupMatch } from "@/lib/repo/crm/dedupe";

/** Name + phone, with the duplicate check running as the rep types (spec D7). */
export default function BasicsStep({ api, prefillPhone, onOpenExisting, onRequested }: {
  api: CustomStepApi; prefillPhone?: string | null; onOpenExisting: (id: number) => void; onRequested: () => void;
}) {
  const toast = useToast();
  const prior = basicsOf(api.state.values);
  const link = linkOf(api.state.values);
  const pin = pinOf(api.state.values);
  const lat = pin?.lat ?? null;
  const lng = pin?.lng ?? null;
  const [name, setName] = useState(prior?.name ?? link?.name ?? "");
  const [phone, setPhone] = useState(prior?.phone ?? prefillPhone ?? "");
  const [branchOf, setBranchOf] = useState<number | null>(prior?.branch_of ?? null);
  const [matches, setMatches] = useState<DupMatch[]>([]);

  useEffect(() => {
    const t = window.setTimeout(async () => {
      const qs = new URLSearchParams();
      if (phone.trim()) qs.set("phone", phone.trim());
      if (name.trim()) qs.set("name", name.trim());
      if (lat !== null && lng !== null) { qs.set("lat", String(lat)); qs.set("lng", String(lng)); }
      if (!qs.has("phone") && !qs.has("name")) { setMatches([]); return; }
      const j = (await fetch(`/api/crm/businesses/dedupe?${qs}`).then((r) => r.json()).catch(() => null)) as { ok?: boolean; matches?: DupMatch[] } | null;
      if (j?.ok) setMatches(j.matches ?? []);
    }, 400);
    return () => window.clearTimeout(t);
  }, [name, phone, lat, lng]);

  const phoneHits = matches.filter((m) => m.kind === "phone");
  const nameHits = matches.filter((m) => m.kind === "name");
  const branchOk = branchOf !== null && phoneHits.some((m) => m.reachable && m.id === branchOf);
  const phoneInvalid = !!phone.trim() && !normPhone(phone);
  const blocked = (phoneHits.length > 0 && !branchOk) || phoneInvalid;
  const request = async () => {
    const res = await fetch("/api/crm/reassign-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) });
    toast(res.ok ? "درخواست واگذاری برای مدیرتان فرستاده شد" : "درخواست فرستاده نشد", res.ok ? "success" : "error");
    if (res.ok) onRequested();
  };
  const foodApp = api.state.acc.source ? FOOD_APP_SOURCES.has(api.state.acc.source) : false;

  return (
    <>
      <input className="tf-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="نام کسب‌وکار" aria-label="نام کسب‌وکار" autoFocus={!name} />
      <input className="tf-input ltr" value={phone} onChange={(e) => { setPhone(e.target.value); setBranchOf(null); }} placeholder={foodApp ? "تلفن (اگر دارید)" : "0912 ___ ____"} aria-label="تلفن" type="tel" inputMode="tel" aria-invalid={phoneInvalid} aria-describedby={phoneInvalid ? "lead-phone-error" : undefined} />
      {phoneInvalid ? <p id="lead-phone-error" role="alert" className="tf-error">شماره تلفن معتبر وارد کنید؛ فقط رقم و پیش‌شمارهٔ ایران مجاز است.</p> : null}
      {phoneHits.map((m, i) =>
        m.reachable ? (
          branchOk && m.id === branchOf ? (
            <div key={i} className="tf-card ok">به‌عنوان شعبهٔ دیگرِ «{m.name}» ثبت می‌شود.</div>
          ) : (
            <div key={i} className="tf-card block">
              <b>این شماره مال «{m.name}» است</b>
              <span>{[m.area, m.owner_name && `مسئول: ${m.owner_name}`].filter(Boolean).join(" · ")}</span>
              <div className="acts">
                <button type="button" className="btn solid" onClick={() => onOpenExisting(m.id!)}>باز کردن همان</button>
                <button type="button" className="btn ghost" onClick={() => setBranchOf(m.id)}>شعبهٔ دیگری است</button>
                <button type="button" className="btn ghost" onClick={() => setPhone("")}>شماره را اصلاح کنم</button>
              </div>
            </div>
          )
        ) : (
          <div key={i} className="tf-card block">
            <b>این کسب‌وکار قبلاً ثبت شده</b>
            <span>{[m.owner_name && `مسئول: ${m.owner_name}`, m.area].filter(Boolean).join(" · ")}</span>
            <div className="acts">
              <button type="button" className="btn solid" onClick={() => void request()}>درخواست واگذاری</button>
              <button type="button" className="btn ghost" onClick={() => setPhone("")}>شماره را اصلاح کنم</button>
            </div>
          </div>
        )
      )}
      {nameHits.map((m, i) => (
        <div key={`n${i}`} className="tf-card warn">
          <b>نام مشابه: {m.name ?? "کسب‌وکار ثبت‌شده"}</b>
          <span>{m.distance_km !== null ? `${faDigits(String(Math.round(m.distance_km * 1000)))} متر دورتر · ` : ""}اگر همان نیست، ادامه دهید</span>
          {m.reachable && m.id ? <div className="acts"><button type="button" className="btn ghost" onClick={() => onOpenExisting(m.id!)}>باز کن</button></div> : null}
        </div>
      ))}
      <button type="button" className="tf-go" disabled={name.trim().length < 2 || blocked}
        onClick={() => api.submit("ok", JSON.stringify({ name: name.trim(), phone: phone.trim() || null, branch_of: branchOk ? branchOf : null }))}>
        ادامه
      </button>
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import type { CustomStepApi } from "@/components/tapflow/TapFlow";
import { useToast } from "@/components/ToastProvider";
import { basicsOf, linkOf, pinOf } from "@/lib/crm/flows/addLead";
import { FOOD_APP_SOURCES, faDigits } from "@/lib/crm/vocab";
import { normPhone, sanitizePhoneInput } from "@/lib/crm/phone";
import type { DupMatch } from "@/lib/repo/crm/dedupe";

/** Name + phone, with the duplicate check running as the rep types (spec D7).
 *  Phone UX: letters/other symbols are removed as they are typed or pasted, the red error
 *  waits for blur so an unfinished number is never flagged mid-entry, and Continue stays
 *  disabled until the duplicate check for the CURRENT input resolves — a failed lookup
 *  shows a retry card instead of silently passing. */
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
  const [instagram, setInstagram] = useState(prior?.instagram ?? (link && /instagram\.com\//.test(link.maps_url) ? link.maps_url : ""));
  const [branchOf, setBranchOf] = useState<number | null>(prior?.branch_of ?? null);
  const [matches, setMatches] = useState<DupMatch[]>([]);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [checkedKey, setCheckedKey] = useState("");
  const [checkFailed, setCheckFailed] = useState(false);

  const emptyKey = !phone.trim() && !name.trim() && !instagram.trim() && lat === null;
  const queryKey = emptyKey ? "" : `${phone.trim()}|${instagram.trim()}|${name.trim()}|${lat ?? ""},${lng ?? ""}`;
  useEffect(() => {
    if (emptyKey) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const qs = new URLSearchParams();
      if (phone.trim()) qs.set("phone", phone.trim());
      if (instagram.trim()) qs.set("instagram", instagram.trim());
      if (name.trim()) qs.set("name", name.trim());
      if (lat !== null && lng !== null) { qs.set("lat", String(lat)); qs.set("lng", String(lng)); }
      const j = (await fetch(`/api/crm/businesses/dedupe?${qs}`).then((r) => r.json()).catch(() => null)) as { ok?: boolean; matches?: DupMatch[] } | null;
      if (cancelled) return;
      if (j?.ok) { setMatches(j.matches ?? []); setCheckedKey(queryKey); setCheckFailed(false); }
      else setCheckFailed(true);
    }, 400);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [emptyKey, queryKey, phone, name, instagram, lat, lng]);
  // Derived, not set: an empty query shows no results, and results from a previous query
  // stay hidden (and non-blocking) while the new check is in flight.
  const checkPending = !emptyKey && checkedKey !== queryKey;
  const checkFailedShown = !emptyKey && checkFailed;

  const shown = emptyKey || checkPending ? [] : matches;
  const phoneHits = shown.filter((m) => m.kind === "phone" || m.kind === "instagram");
  const nameHits = shown.filter((m) => m.kind === "name");
  const branchOk = branchOf !== null && phoneHits.some((m) => m.reachable && m.id === branchOf);
  const invalid = phoneTouched && !!phone.trim() && !normPhone(phone);
  const blocked = (phoneHits.length > 0 && !branchOk) || invalid || checkPending || checkFailedShown;
  const request = async () => {
    const res = await fetch("/api/crm/reassign-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) });
    toast(res.ok ? "درخواست واگذاری برای مدیرتان فرستاده شد" : "درخواست فرستاده نشد", res.ok ? "success" : "error");
    if (res.ok) onRequested();
  };
  const foodApp = api.state.acc.source ? FOOD_APP_SOURCES.has(api.state.acc.source) : false;

  return (
    <>
      <input className="tf-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="نام کسب‌وکار" aria-label="نام کسب‌وکار" autoFocus={!name} />
      <input className="tf-input ltr" value={phone}
        onChange={(e) => { setPhone(sanitizePhoneInput(e.target.value)); setBranchOf(null); }}
        onBlur={() => setPhoneTouched(true)}
        placeholder={foodApp ? "تلفن (اگر دارید)" : "0912 ___ ____"} aria-label="تلفن" type="tel" inputMode="tel"
        aria-invalid={invalid} aria-describedby={invalid ? "lead-phone-error" : undefined} />
      {invalid ? <p id="lead-phone-error" role="alert" className="tf-error">شماره تلفن معتبر وارد کنید؛ فقط رقم و پیش‌شمارهٔ ایران مجاز است.</p> : null}
      <input className="tf-input ltr" value={instagram} onChange={(e) => { setInstagram(e.target.value); setBranchOf(null); }} placeholder="اینستاگرام: ‎@page (اختیاری)" aria-label="صفحهٔ اینستاگرام" inputMode="url" autoCapitalize="none" />
      {checkFailedShown ? (
        <div className="tf-card block">
          <b>بررسی تکراری‌بودن انجام نشد</b>
          <span>اتصال برقرار نشد؛ پیش از ذخیره دوباره بررسی کنید.</span>
          <div className="acts"><button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" onClick={() => setCheckFailed(false)}>
          <Icon name="undo" size="md" />
          بررسی دوباره</button></div>
        </div>
      ) : null}
      {phoneHits.map((m, i) =>
        m.reachable ? (
          branchOk && m.id === branchOf ? (
            <div key={i} className="tf-card ok">به‌عنوان شعبهٔ دیگرِ «{m.name}» ثبت می‌شود.</div>
          ) : (
            <div key={i} className="tf-card block">
              <b>{m.kind === "phone" ? "این شماره" : "این صفحهٔ اینستاگرام"} مال «{m.name}» است</b>
              <span>{[m.area, m.owner_name && `مسئول: ${m.owner_name}`].filter(Boolean).join(" · ")}</span>
              <div className="acts">
                <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid" onClick={() => onOpenExisting(m.id!)}>
                <Icon name="external-link" size="md" />
                باز کردن همان</button>
                <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" onClick={() => setBranchOf(m.id)}>
                <Icon name="building" size="md" />
                شعبهٔ دیگری است</button>
                <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" onClick={() => { if (m.kind === "phone") setPhone(""); else setInstagram(""); setBranchOf(null); }}>
                <Icon name="edit" size="md" />
                {m.kind === "phone" ? "شماره را اصلاح کنم" : "صفحه را اصلاح کنم"}</button>
              </div>
            </div>
          )
        ) : (
          <div key={i} className="tf-card block">
            <b>این کسب‌وکار قبلاً ثبت شده</b>
            <span>{[m.owner_name && `مسئول: ${m.owner_name}`, m.area].filter(Boolean).join(" · ")}</span>
            <div className="acts">
              {m.kind === "phone" && <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid" onClick={() => void request()}>
              <Icon name="handshake" size="md" />
              درخواست واگذاری</button>}
              <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" onClick={() => { if (m.kind === "phone") setPhone(""); else setInstagram(""); setBranchOf(null); }}>
              <Icon name="arrow-left" size="md" />
              {m.kind === "phone" ? "شماره را اصلاح کنم" : "صفحه را اصلاح کنم"}</button>
            </div>
          </div>
        )
      )}
      {nameHits.map((m, i) => (
        <div key={`n${i}`} className="tf-card warn">
          <b>نام مشابه: {m.name ?? "کسب‌وکار ثبت‌شده"}</b>
          <span>{m.distance_km !== null ? `${faDigits(String(Math.round(m.distance_km * 1000)))} متر دورتر · ` : ""}اگر همان نیست، ادامه دهید</span>
          {m.reachable && m.id ? <div className="acts"><button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" onClick={() => onOpenExisting(m.id!)}>
          <Icon name="external-link" size="md" />
          باز کن</button></div> : null}
        </div>
      ))}
      <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] tf-go" disabled={name.trim().length < 2 || blocked}
        onClick={() => api.submit("ok", JSON.stringify({ name: name.trim(), phone: phone.trim() || null, instagram: instagram.trim() || null, branch_of: branchOk ? branchOf : null }))}>
        <Icon name="arrow-left" size="md" />
        ادامه
      </button>
    </>
  );
}

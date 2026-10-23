"use client";
import { ChipGroup } from "@/components/mobile/FilterChips";
import { useRef, useState } from "react";
import { friendlyError } from "@/lib/userMessage";
import { Icon } from "@/components/meridian/Icon";
import Link from "next/link";
import type { Profile, ContactRow } from "@/lib/repo/crm/profile";
import type { TimelineItem } from "@/lib/crm/timeline";
import { faJalaliDateTime } from "@/lib/jalali";
import { BUSINESS_TYPES, BUSINESS_TYPE_LABEL, CONTACT_ROLES, CONTACT_ROLE_LABEL, isOneOf } from "@/lib/crm/vocab";
import { SIZE_BAND_LABEL, SUPPLY_CHANNEL_LABEL, VISIT_WINDOW_LABEL } from "@/lib/crm/intel";
import TapFlow from "@/components/tapflow/TapFlow";
import BottomSheet from "@/components/mobile/BottomSheet";
import CheckField from "@/components/CheckField";
import { EMPTY_CONTEXT, type FlowContext, type FlowState } from "@/lib/crm/flows/types";
import { intelFlow } from "@/lib/crm/flows/intel";
import { startFlow } from "@/lib/crm/flows/machine";
import { isWorkingHours } from "@/lib/crm/hours";
import { normPhone, sanitizePhoneInput } from "@/lib/crm/phone";
import { useToast } from "@/components/ToastProvider";
import CustomerBento from "@/components/meridian/CustomerBento";
import CustomerPriceHistory from "@/components/PriceHistoryList";
import BusinessDetails from "./BusinessDetails";
import CustomerOpenItems from "./CustomerOpenItems";
import HoursPicker from "./HoursPicker";
import type { FlowConfig } from "@/lib/crm/flows/types";

const hoursFlowConfig: FlowConfig = {
  id: "edit_hours", start: () => "hours", skipStep: "skip", budget: { common: 4, longest: 4 },
  steps: {
    hours: { id: "hours", kind: "hours", q: "ساعت کاری", sub: "برنامهٔ تازه جایگزین ساعت‌های قبلی می‌شود", options: [{ id: "ok", label: "ثبت ساعت‌ها", tone: "rec", next: "confirm" }, { id: "skip", label: "پاک کردن ساعت‌ها", next: "clear" }] },
    clear: { id: "clear", kind: "choice", q: "ساعت‌های ثبت‌شده پاک شود؟", options: [{ id: "ok", label: "بله، پاک شود", tone: "bad", next: "confirm" }] },
    confirm: { id: "confirm", kind: "choice", q: "ثبت شود؟", options: [{ id: "ok", label: "ثبت ساعت کاری", tone: "rec", save: true }] },
    skip: { id: "skip", kind: "choice", q: "برنامهٔ تازه‌ای نمی‌دانید؟", options: [{ id: "ok", label: "بدون تغییر بازگرد", next: "confirm" }] },
  },
};
type History = { items: TimelineItem[]; nextBefore: string | null };
type Edit = { kind: "business"; field: string; value: string } | { kind: "contact"; contact: ContactRow | null } | { kind: "verify" } | { kind: "tags" };
const TOUCH = { minHeight: 44, minWidth: 44 };
const FIELDS = [{ key: "business_name", label: "نام کسب‌وکار" }, { key: "phone", label: "تلفن" }, { key: "address", label: "آدرس" }, { key: "area_label", label: "محله" }, { key: "business_type", label: "نوع کسب‌وکار" }, { key: "instagram", label: "اینستاگرام" }, { key: "website", label: "وب‌سایت" }];
const usesNames = (profile: Profile): string[] => {
  try { const ids = JSON.parse(profile.business.uses_products_json ?? "[]") as unknown; return Array.isArray(ids) ? profile.products.filter(p => ids.includes(p.id)).map(p => p.name) : []; } catch { return []; }
};
/** `canOrder` is lib/roles canSell for the viewer, decided by the page that has the session: a
 *  rep manager reads profiles but the order API refuses their sale, so they get no order button. */
export default function BusinessProfile({ initial, initialTimeline, canOrder }: { initial: Profile; initialTimeline: History; canOrder: boolean }) {
  const [profile, setProfile] = useState(initial), [history, setHistory] = useState(initialTimeline);
  const [edit, setEdit] = useState<Edit | null>(null), [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [intel, setIntel] = useState<{ ctx: FlowContext; st: FlowState } | null>(null);
  const [hours, setHours] = useState<{ ctx: FlowContext; st: FlowState } | null>(null);
  const lock = useRef(false), toast = useToast();
  const base = `/api/crm/businesses/${profile.business.id}`;
  async function reload() {
    const [p, t] = await Promise.all([fetch(base), fetch(`${base}/timeline`)]);
    if (!p.ok || !t.ok) throw new Error("اطلاعات تازه خوانده نشد؛ دوباره تلاش کنید");
    const [pj, tj] = await Promise.all([p.json(), t.json()]);
    if (!pj.ok || !tj.ok) throw new Error("اطلاعات تازه خوانده نشد");
    setProfile(pj.profile); setHistory({ items: tj.items, nextBefore: tj.nextBefore });
  }
  async function save(path: string, method: string, body?: unknown) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(friendlyError(j.error, "تغییر ثبت نشد؛ دوباره تلاش کنید"));
      setEdit(null); toast("ثبت شد", "success"); await reload();
    } catch (e) { setError(e instanceof Error ? e.message : "اتصال برقرار نشد. اینترنت را بررسی کنید و دوباره تلاش کنید."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function patch(body: Record<string, unknown>) {
    if (lock.current) throw new Error("ثبت دیگری در جریان است؛ دوباره تلاش کنید");
    lock.current = true; setBusy(true);
    try {
      const r = await fetch(base, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(friendlyError(j.error, "تغییر ثبت نشد؛ دوباره تلاش کنید"));
      try { await reload(); } catch { setError("تغییر ثبت شد، اما اطلاعات تازه خوانده نشد؛ بارگذاری دوباره را بزنید"); }
      toast("ثبت شد", "success");
    } finally { lock.current = false; setBusy(false); }
  }
  function openHours() {
    const ctx: FlowContext = { ...EMPTY_CONTEXT };
    setHours({ ctx, st: startFlow(hoursFlowConfig, ctx) });
  }
  async function more() {
    if (lock.current || !history.nextBefore) return;
    lock.current = true; setBusy(true);
    try {
      const r = await fetch(`${base}/timeline?before=${encodeURIComponent(history.nextBefore)}`), j = await r.json();
      if (!r.ok || !j.ok) throw new Error();
      setHistory(h => ({ items: [...h.items, ...j.items], nextBefore: j.nextBefore }));
    } catch { setError("تاریخچه خوانده نشد؛ دوباره تلاش کنید"); }
    finally { lock.current = false; setBusy(false); }
  }
  return <main dir="rtl" style={{ padding: "24px 16px 96px", display: "grid", gap: 18, maxWidth: 900, margin: "auto" }}>
    <div className="profile-topbar">
      <Link href="/crm" className="btn ghost" style={TOUCH}>بازگشت به فهرست</Link>
      {canOrder && <Link className="btn solid" style={TOUCH} href={`/sales/orders/new?customer=${profile.business.id}`}>ثبت سفارش تازه</Link>}
    </div>
    <h1>{profile.business.business_name}</h1>
    {error && <div role="alert">{error} <button className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" style={TOUCH} disabled={busy} onClick={() => { setError(null); void reload().catch(e => setError(e.message)); }}>
    <Icon name="undo" size="md" />
    بارگذاری دوباره</button></div>}
    {(profile.business.verification ?? "unverified") === "unverified" && <section className="tile"><strong>اطلاعات تأییدنشده</strong><p>نام و راه تماس را در تماس یا بازدید بررسی کنید.</p>{profile.canWrite && <button className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid" style={TOUCH} onClick={() => setEdit({ kind: "verify" })}>
    <Icon name="check" size="md" />
    تأیید اطلاعات</button>}</section>}
    {profile.onboarding?.isNew && profile.onboarding.missing.length > 0 && <section className="tile" aria-label="آماده‌سازی مشتری تازه"><h2>آماده‌سازی مشتری تازه</h2>
      <p>پیش از نخستین تحویل این‌ها را کامل کنید. سفارش بدون آن‌ها هم ثبت می‌شود.</p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
        {profile.onboarding.items.map(i => <li key={i.key} style={{ display: "flex", gap: 8, alignItems: "center", color: i.done ? "var(--text-muted)" : "var(--warn)" }}>
          <Icon name={i.done ? "check" : "warn"} size="sm" />{i.label}{i.done ? " · ثبت شده" : " · ثبت نشده"}</li>)}
      </ul>
    </section>}
    <BusinessDetails business={profile.business} canWrite={profile.canWrite} disabled={busy} onPatch={patch} onHours={openHours} />
    <section className="tile"><h2>شناخت پیش از بازدید</h2>
      <div style={{ display: "grid", gap: 6 }}>
        <span>اندازه · {isOneOf(["small", "medium", "large", "takeaway", "unknown"], profile.business.size_band ?? undefined) ? SIZE_BAND_LABEL[profile.business.size_band as "small"] : "ثبت نشده"}</span>
        <span>منبع خرید · {isOneOf(["factory", "distributor", "wholesale", "retail", "unknown"], profile.business.supply_channel ?? undefined) ? SUPPLY_CHANNEL_LABEL[profile.business.supply_channel as "factory"] : "ثبت نشده"}</span>
        <span>مصرف فعلی · {usesNames(profile).join("، ") || "ثبت نشده"}</span>
        <span>زمان بازدید · {isOneOf(["morning", "afternoon", "evening", "any", "unknown"], profile.business.visit_window ?? undefined) ? VISIT_WINDOW_LABEL[profile.business.visit_window as "morning"] : "ثبت نشده"}</span>
        <span>یادداشت · {profile.business.visit_note || "ثبت نشده"}</span>
      </div>
      {profile.canWrite && <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" style={TOUCH} disabled={busy} onClick={() => {
        const ctx: FlowContext = { ...EMPTY_CONTEXT, products: profile.products, vars: { name: profile.business.business_name } };
        setIntel({ ctx, st: startFlow(intelFlow, ctx) });
      }}>
      <Icon name="check" size="md" />
      ثبت شناخت</button>}
    </section>
    <section className="tile"><h2>برچسب‌ها</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{profile.tags.length ? profile.tags.map(t => <span key={t} className="pill">{t}</span>) : <p>برچسبی ثبت نشده است.</p>}</div>
      {profile.canWrite && <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" style={TOUCH} disabled={busy} onClick={() => setEdit({ kind: "tags" })}>
      <Icon name="edit" size="md" />
      ویرایش برچسب‌ها</button>}
    </section>
    <section className="tile"><h2>مخاطبان</h2>{!profile.contacts.length && <p>هنوز مخاطبی ثبت نشده است.</p>}
      {profile.contacts.map(c => <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <span style={{ flex: 1 }}>{c.name || "بدون نام"} · {isOneOf(CONTACT_ROLES, c.role) ? CONTACT_ROLE_LABEL[c.role] : "سایر"}{c.is_primary ? " · مخاطب اصلی" : ""}<br />{c.phone_norm ? `0${c.phone_norm}` : "بدون تلفن"}</span>
        {profile.canWrite && <button className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" style={TOUCH} onClick={() => setEdit({ kind: "contact", contact: c })}>
        <Icon name="edit" size="md" />
        ویرایش مخاطب</button>}
      </div>)}
      {profile.canWrite && <button className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid" style={TOUCH} onClick={() => setEdit({ kind: "contact", contact: null })}>
      <Icon name="plus" size="md" />
      افزودن مخاطب</button>}
    </section><CustomerBento data={profile.summary} />
    {profile.open && <CustomerOpenItems data={profile.open} />}
    <CustomerPriceHistory customerId={profile.business.id} />
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Link className="btn ghost" style={TOUCH} href={`/sales/orders?customer=${profile.business.id}`}>همهٔ سفارش‌ها</Link></div>
    <section className="tile"><h2>تاریخچه</h2>{!history.items.length && <p>رویدادی ثبت نشده است.</p>}
      {history.items.map(i => <article key={`${i.kind}-${i.id}`} style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}>{i.href ? <Link href={i.href}>{i.title}</Link> : <strong>{i.title}</strong>}<p>{i.sub}</p><small><time dateTime={i.at} dir="ltr">{faJalaliDateTime(i.at)}</time> {i.who}</small></article>)}
      {history.nextBefore && <button className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" style={TOUCH} disabled={busy} onClick={() => void more()}>
      <Icon name="clock" size="md" />
      رویدادهای قدیمی‌تر</button>}
    </section>
    {edit && <ProfileEditor key={JSON.stringify(edit)} edit={edit} busy={busy} onClose={() => setEdit(null)} onSave={save} profile={profile} />}
    {intel && <TapFlow open title="شناخت پیش از بازدید" subtitle={profile.business.business_name} config={intelFlow} ctx={intel.ctx} state={intel.st}
      onState={st => setIntel(i => i && { ...i, st })} onClose={() => setIntel(null)}
      onSaved={st => {
        void (async () => {
          try {
            const r = await fetch(`${base}/intel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers: st.answers, client_uuid: crypto.randomUUID() }) });
            const j = await r.json();
            if (!r.ok || !j.ok) throw new Error(friendlyError(j.error, "تغییر ثبت نشد؛ دوباره تلاش کنید"));
            toast("شناخت ثبت شد", "success"); setIntel(null); await reload();
          } catch (e) { setError(e instanceof Error ? e.message : "اتصال برقرار نشد. اینترنت را بررسی کنید و دوباره تلاش کنید."); setIntel(null); }
        })();
      }} />}
    {hours && <TapFlow open title="ویرایش ساعت کاری" subtitle={profile.business.business_name} config={hoursFlowConfig} ctx={hours.ctx} state={hours.st}
      onState={st => setHours(h => h && { ...h, st })} onClose={() => setHours(null)}
      renderCustom={api => <HoursPicker api={{ ...api, submit: (option, value) => option === "skip" ? setHours(null) : api.submit(option, value) }} />}
      onSaved={st => {
        void (async () => {
          try {
            const raw = st.values.hours;
            const parsed: unknown = raw ? JSON.parse(raw) : null;
            if (raw && !isWorkingHours(parsed)) throw new Error("ساعت کاری نامعتبر است");
            await patch({ working_hours: parsed });
            setHours(null); toast("ساعت کاری ثبت شد", "success");
          } catch (e) { setError(e instanceof Error ? e.message : "اتصال برقرار نشد. اینترنت را بررسی کنید و دوباره تلاش کنید."); setHours(null); }
        })();
      }} />}
  </main>;
}
function ProfileEditor({ edit, busy, onClose, onSave, profile }: { edit: Edit; busy: boolean; onClose: () => void; onSave: (path: string, method: string, body?: unknown) => Promise<void>; profile: Profile }) {
  const c = edit.kind === "contact" ? edit.contact : null;
  const [value, setValue] = useState(edit.kind === "business" ? edit.value : "");
  const [tags, setTags] = useState(profile.tags.join("، "));
  const [name, setName] = useState(c?.name ?? ""), [phone, setPhone] = useState(c?.phone_norm ? `0${c.phone_norm}` : "");
  const [role, setRole] = useState(c?.role ?? "OTHER"), [primary, setPrimary] = useState(!!c?.is_primary);
  const [touched, setTouched] = useState(false), [archive, setArchive] = useState(false);
  const isPhone = edit.kind === "contact" || (edit.kind === "business" && edit.field === "phone");
  const currentPhone = edit.kind === "contact" ? phone : value;
  const bad = isPhone && !!currentPhone.trim() && !normPhone(currentPhone);
  const title = edit.kind === "verify" ? "نام و راه تماس این کسب‌وکار را بررسی کردید؟" : edit.kind === "tags" ? "برچسب‌ها (با ویرگول جدا کنید)" : edit.kind === "contact" ? "اطلاعات مخاطب" : FIELDS.find(f => f.key === edit.field)?.label;
  return <BottomSheet open title={title} onClose={() => { if (!busy) onClose(); }} closeLabel="بستن ویرایش" bodyClassName="profile-edit-sheet">
    <form onSubmit={e => { e.preventDefault(); if (bad || busy) return;
      if (edit.kind === "verify") void onSave("/verify", "POST", { confirmed: true });
      else if (edit.kind === "tags") void onSave("/tags", "PUT", { tags: tags.split(/[,،]/).map(t => t.trim()).filter(Boolean) });
      else if (edit.kind === "business") void onSave("", "PATCH", { [edit.field]: value || null });
      else void onSave(c ? `/contacts/${c.id}` : "/contacts", c ? "PATCH" : "POST", { name: name || null, phone: phone || null, role, is_primary: primary });
    }} style={{ display: "grid", gap: 12 }}>
      {edit.kind === "tags" && <input autoFocus className="tf-input" aria-label="برچسب‌ها" value={tags} onChange={e => setTags(e.target.value)} placeholder="با ویرگول جدا کنید" />}
      {edit.kind === "business" && (edit.field === "business_type" ? <ChipGroup wrap group={{ id: "business_type", label: "نوع کسب‌وکار", mode: "single", value, onChange: v => setValue(v as string), options: BUSINESS_TYPES.map(t => ({ id: t, label: BUSINESS_TYPE_LABEL[t] })) }} /> : <input autoFocus className="tf-input" aria-label={title} value={value} required={edit.field === "business_name"} inputMode={isPhone ? "tel" : "text"} dir={isPhone ? "ltr" : "rtl"} aria-invalid={touched && bad} onBlur={() => setTouched(true)} onChange={e => setValue(isPhone ? sanitizePhoneInput(e.target.value) : e.target.value)} />)}
      {edit.kind === "contact" && <><label>نام<input className="tf-input" value={name} onChange={e => setName(e.target.value)} /></label><label>تلفن<input className="tf-input" dir="ltr" inputMode="tel" value={phone} aria-invalid={touched && bad} onBlur={() => setTouched(true)} onChange={e => setPhone(sanitizePhoneInput(e.target.value))} /></label><div><span>سمت</span><ChipGroup wrap group={{ id: "contact_role", label: "سمت", mode: "single", neutral: "__none", value: role, onChange: v => { if (v && v !== "__none") setRole(v as string); }, options: CONTACT_ROLES.map(r => ({ id: r, label: CONTACT_ROLE_LABEL[r] })) }} /></div><CheckField checked={primary} onChange={setPrimary}>مخاطب اصلی</CheckField></>}
      {touched && bad && <p role="alert">شماره تلفن معتبر نیست</p>}
      <button type="submit" className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid" style={TOUCH} disabled={busy || bad}>
      <Icon name="edit" size="md" />
      {busy ? "در حال ثبت…" : edit.kind === "verify" ? "بله، اطلاعات درست است" : "ذخیرهٔ تغییر"}</button>
      <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" style={TOUCH} disabled={busy} onClick={onClose}>
      <Icon name="x" size="md" />
      انصراف از ویرایش</button>
      {c && <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" style={TOUCH} disabled={busy} onClick={() => archive ? void onSave(`/contacts/${c.id}`, "DELETE") : setArchive(true)}>
      <Icon name="edit" size="md" />
      {archive ? "بله، مخاطب بایگانی شود" : "بایگانی مخاطب"}</button>}
    </form></BottomSheet>;
}


"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import type { Profile, ContactRow } from "@/lib/repo/crm/profile";
import type { TimelineItem } from "@/lib/crm/timeline";
import { BUSINESS_TYPES, BUSINESS_TYPE_LABEL, CONTACT_ROLES, CONTACT_ROLE_LABEL, isOneOf } from "@/lib/crm/vocab";
import { SIZE_BAND_LABEL, SUPPLY_CHANNEL_LABEL, VISIT_WINDOW_LABEL } from "@/lib/crm/intel";
import TapFlow from "@/components/tapflow/TapFlow";
import { EMPTY_CONTEXT, type FlowContext, type FlowState } from "@/lib/crm/flows/types";
import { intelFlow } from "@/lib/crm/flows/intel";
import { startFlow } from "@/lib/crm/flows/machine";
import { normPhone, sanitizePhoneInput } from "@/lib/crm/phone";
import { useToast } from "@/components/ToastProvider";
import CustomerBento from "@/components/meridian/CustomerBento";
type History = { items: TimelineItem[]; nextBefore: string | null };
type Edit = { kind: "business"; field: string; value: string } | { kind: "contact"; contact: ContactRow | null } | { kind: "verify" } | { kind: "tags" };
const TOUCH = { minHeight: 44, minWidth: 44 };
const FIELDS = [{ key: "business_name", label: "نام کسب‌وکار" }, { key: "phone", label: "تلفن" }, { key: "address", label: "آدرس" }, { key: "area_label", label: "محله" }, { key: "business_type", label: "نوع کسب‌وکار" }, { key: "instagram", label: "اینستاگرام" }, { key: "website", label: "وب‌سایت" }];
const usesNames = (profile: Profile): string[] => {
  try { const ids = JSON.parse(profile.business.uses_products_json ?? "[]") as unknown; return Array.isArray(ids) ? profile.products.filter(p => ids.includes(p.id)).map(p => p.name) : []; } catch { return []; }
};
export default function BusinessProfile({ initial, initialTimeline }: { initial: Profile; initialTimeline: History }) {
  const [profile, setProfile] = useState(initial), [history, setHistory] = useState(initialTimeline);
  const [edit, setEdit] = useState<Edit | null>(null), [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [intel, setIntel] = useState<{ ctx: FlowContext; st: FlowState } | null>(null);
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
      if (!r.ok || !j.ok) throw new Error(j.error ?? "ذخیره نشد");
      setEdit(null); toast("ثبت شد", "success"); await reload();
    } catch (e) { setError(e instanceof Error ? e.message : "اتصال برقرار نشد"); }
    finally { lock.current = false; setBusy(false); }
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
    <Link href="/crm" className="btn ghost" style={TOUCH}>بازگشت به فهرست</Link><h1>{profile.business.business_name}</h1>
    {error && <div role="alert">{error} <button className="btn ghost" style={TOUCH} disabled={busy} onClick={() => { setError(null); void reload().catch(e => setError(e.message)); }}>بارگذاری دوباره</button></div>}
    {(profile.business.verification ?? "unverified") === "unverified" && <section className="tile"><strong>اطلاعات تأییدنشده</strong><p>نام و راه تماس را در تماس یا بازدید بررسی کنید.</p>{profile.canWrite && <button className="btn solid" style={TOUCH} onClick={() => setEdit({ kind: "verify" })}>تأیید اطلاعات</button>}</section>}
    <section className="tile"><h2>شناخت پیش از بازدید</h2>
      <div style={{ display: "grid", gap: 6 }}>
        <span>اندازه · {isOneOf(["small", "medium", "large", "takeaway", "unknown"], profile.business.size_band ?? undefined) ? SIZE_BAND_LABEL[profile.business.size_band as "small"] : "ثبت نشده"}</span>
        <span>منبع خرید · {isOneOf(["factory", "distributor", "wholesale", "retail", "unknown"], profile.business.supply_channel ?? undefined) ? SUPPLY_CHANNEL_LABEL[profile.business.supply_channel as "factory"] : "ثبت نشده"}</span>
        <span>مصرف فعلی · {usesNames(profile).join("، ") || "ثبت نشده"}</span>
        <span>زمان بازدید · {isOneOf(["morning", "afternoon", "evening", "any", "unknown"], profile.business.visit_window ?? undefined) ? VISIT_WINDOW_LABEL[profile.business.visit_window as "morning"] : "ثبت نشده"}</span>
        <span>یادداشت · {profile.business.visit_note || "ثبت نشده"}</span>
      </div>
      {profile.canWrite && <button type="button" className="btn ghost" style={TOUCH} disabled={busy} onClick={() => setIntel({ ctx: { ...EMPTY_CONTEXT, entry: "call", vars: { name: profile.business.business_name } }, st: startFlow(intelFlow, { ...EMPTY_CONTEXT, entry: "call", vars: { name: profile.business.business_name } }) })}>ثبت شناخت</button>}
    </section>
    <section className="tile"><h2>برچسب‌ها</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{profile.tags.length ? profile.tags.map(t => <span key={t} className="pill">{t}</span>) : <p>برچسبی ثبت نشده است.</p>}</div>
      {profile.canWrite && <button type="button" className="btn ghost" style={TOUCH} disabled={busy} onClick={() => setEdit({ kind: "tags" })}>ویرایش برچسب‌ها</button>}
    </section>
    <section className="tile"><h2>اطلاعات کسب‌وکار</h2><div style={{ display: "grid", gap: 8 }}>{FIELDS.map(f => {
      const value = f.key === "phone" ? profile.business.phone_norm ? `0${profile.business.phone_norm}` : "" : String(profile.business[f.key as keyof Profile["business"]] ?? "");
      const label = f.key === "business_type" && isOneOf(BUSINESS_TYPES, value) ? BUSINESS_TYPE_LABEL[value] : value;
      return <button key={f.key} type="button" className="btn ghost" style={TOUCH} disabled={!profile.canWrite} onClick={() => setEdit({ kind: "business", field: f.key, value })}>{f.label} · {label || "ثبت نشده"}</button>;
    })}</div></section>
    <section className="tile"><h2>مخاطبان</h2>{!profile.contacts.length && <p>هنوز مخاطبی ثبت نشده است.</p>}
      {profile.contacts.map(c => <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <span style={{ flex: 1 }}>{c.name || "بدون نام"} · {isOneOf(CONTACT_ROLES, c.role) ? CONTACT_ROLE_LABEL[c.role] : "سایر"}{c.is_primary ? " · مخاطب اصلی" : ""}<br />{c.phone_norm ? `0${c.phone_norm}` : "بدون تلفن"}</span>
        {profile.canWrite && <button className="btn ghost" style={TOUCH} onClick={() => setEdit({ kind: "contact", contact: c })}>ویرایش</button>}
      </div>)}
      {profile.canWrite && <button className="btn solid" style={TOUCH} onClick={() => setEdit({ kind: "contact", contact: null })}>افزودن مخاطب</button>}
    </section><CustomerBento data={profile.summary} />
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Link className="btn solid" style={TOUCH} href={`/sales/orders/new?customer=${profile.business.id}`}>ثبت سفارش تازه</Link><Link className="btn ghost" style={TOUCH} href={`/sales/orders?customer=${profile.business.id}`}>همهٔ سفارش‌ها</Link></div>
    <section className="tile"><h2>تاریخچه</h2>{!history.items.length && <p>رویدادی ثبت نشده است.</p>}
      {history.items.map(i => <article key={`${i.kind}-${i.id}`} style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}>{i.href ? <Link href={i.href}>{i.title}</Link> : <strong>{i.title}</strong>}<p>{i.sub}</p><small>{i.at} {i.who}</small></article>)}
      {history.nextBefore && <button className="btn ghost" style={TOUCH} disabled={busy} onClick={() => void more()}>رویدادهای قدیمی‌تر</button>}
    </section>
    {edit && <ProfileEditor key={JSON.stringify(edit)} edit={edit} busy={busy} onClose={() => setEdit(null)} onSave={save} profile={profile} />}
    {intel && <TapFlow open title="شناخت پیش از بازدید" subtitle={profile.business.business_name} config={intelFlow} ctx={intel.ctx} state={intel.st}
      onState={st => setIntel(i => i && { ...i, st })} onClose={() => setIntel(null)}
      onSaved={st => {
        void (async () => {
          try {
            const r = await fetch(`${base}/intel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers: st.answers, client_uuid: crypto.randomUUID() }) });
            const j = await r.json();
            if (!r.ok || !j.ok) throw new Error(j.error ?? "ذخیره نشد");
            toast("شناخت ثبت شد", "success"); setIntel(null); await reload();
          } catch (e) { setError(e instanceof Error ? e.message : "اتصال برقرار نشد"); setIntel(null); }
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
  return <><div className="meridian-scrim on" onClick={() => !busy && onClose()} aria-hidden="true" /><div className="sheet on" role="dialog" aria-modal="true" aria-labelledby="profile-edit-title" style={{ padding: 24, overflowY: "auto", maxHeight: "85dvh" }}>
    <h2 id="profile-edit-title">{title}</h2>
    <form onSubmit={e => { e.preventDefault(); if (bad || busy) return;
      if (edit.kind === "verify") void onSave("/verify", "POST", { confirmed: true });
      else if (edit.kind === "tags") void onSave("/tags", "PUT", { tags: tags.split(/[,،]/).map(t => t.trim()).filter(Boolean) });
      else if (edit.kind === "business") void onSave("", "PATCH", { [edit.field]: value || null });
      else void onSave(c ? `/contacts/${c.id}` : "/contacts", c ? "PATCH" : "POST", { name: name || null, phone: phone || null, role, is_primary: primary });
    }} style={{ display: "grid", gap: 12 }}>
      {edit.kind === "tags" && <input autoFocus className="tf-input" aria-label="برچسب‌ها" value={tags} onChange={e => setTags(e.target.value)} placeholder="با ویرگول جدا کنید" />}
      {edit.kind === "business" && (edit.field === "business_type" ? <select className="tf-input" aria-label="نوع کسب‌وکار" value={value} onChange={e => setValue(e.target.value)} required><option value="">انتخاب کنید</option>{BUSINESS_TYPES.map(t => <option key={t} value={t}>{BUSINESS_TYPE_LABEL[t]}</option>)}</select> : <input autoFocus className="tf-input" aria-label={title} value={value} required={edit.field === "business_name"} inputMode={isPhone ? "tel" : "text"} dir={isPhone ? "ltr" : "rtl"} aria-invalid={touched && bad} onBlur={() => setTouched(true)} onChange={e => setValue(isPhone ? sanitizePhoneInput(e.target.value) : e.target.value)} />)}
      {edit.kind === "contact" && <><label>نام<input className="tf-input" value={name} onChange={e => setName(e.target.value)} /></label><label>تلفن<input className="tf-input" dir="ltr" inputMode="tel" value={phone} aria-invalid={touched && bad} onBlur={() => setTouched(true)} onChange={e => setPhone(sanitizePhoneInput(e.target.value))} /></label><label>سمت<select className="tf-input" value={role} onChange={e => setRole(e.target.value)}>{CONTACT_ROLES.map(r => <option key={r} value={r}>{CONTACT_ROLE_LABEL[r]}</option>)}</select></label><label style={TOUCH}><input type="checkbox" checked={primary} onChange={e => setPrimary(e.target.checked)} /> مخاطب اصلی</label></>}
      {touched && bad && <p role="alert">شماره تلفن معتبر نیست</p>}
      <button type="submit" className="btn solid" style={TOUCH} disabled={busy || bad}>{busy ? "در حال ثبت…" : edit.kind === "verify" ? "بله، اطلاعات درست است" : "ذخیره"}</button>
      <button type="button" className="btn ghost" style={TOUCH} disabled={busy} onClick={onClose}>انصراف</button>
      {c && <button type="button" className="btn ghost" style={TOUCH} disabled={busy} onClick={() => archive ? void onSave(`/contacts/${c.id}`, "DELETE") : setArchive(true)}>{archive ? "بله، مخاطب بایگانی شود" : "بایگانی مخاطب"}</button>}
    </form></div></>;
}


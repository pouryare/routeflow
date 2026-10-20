"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Profile } from "@/lib/repo/crm/profile";
import { BUSINESS_TYPES, BUSINESS_TYPE_LABEL, PRICE_TIERS, PRICE_TIER_LABEL, isOneOf } from "@/lib/crm/vocab";
import { formatHours, parseHours } from "@/lib/crm/hours";
import { normPhone, sanitizePhoneInput } from "@/lib/crm/phone";
import { Icon } from "@/components/meridian/Icon";
import CustomerLocation from "./CustomerLocation";

export type DetailKey = "business_name" | "business_type" | "price_tier" | "phone" | "secondary_phone" | "whatsapp" | "instagram" | "website" | "area_label" | "address" | "maps_url" | "working_hours";
type Row = { key: DetailKey; label: string; kind: "text" | "phone" | "select"; options?: readonly string[] };
const TOUCH = { minHeight: 44, minWidth: 44 } as const;
const GROUPS: { title: string; hint: string; icon: "building" | "phone" | "map-pin"; tint: string; rows: Row[] }[] = [
  {
    title: "مشخصات پایه", hint: "هویت و ردهٔ کسب‌وکار", icon: "building", tint: "var(--plum)",
    rows: [
      { key: "business_name", label: "نام کسب‌وکار", kind: "text" },
      { key: "business_type", label: "نوع کسب‌وکار", kind: "select", options: BUSINESS_TYPES },
      { key: "price_tier", label: "ردهٔ قیمت", kind: "select", options: PRICE_TIERS },
    ],
  },
  {
    title: "راه‌های ارتباطی", hint: "شماره‌ها و حضور آنلاین", icon: "phone", tint: "var(--accent)",
    rows: [
      { key: "phone", label: "تلفن", kind: "phone" },
      { key: "secondary_phone", label: "تلفن دوم", kind: "phone" },
      { key: "whatsapp", label: "واتس‌اپ", kind: "phone" },
      { key: "instagram", label: "اینستاگرام", kind: "text" },
      { key: "website", label: "وب‌سایت", kind: "text" },
    ],
  },
  {
    title: "موقعیت و ساعت کاری", hint: "نشانی و برنامهٔ حضور", icon: "map-pin", tint: "var(--sage)",
    rows: [
      { key: "area_label", label: "محله", kind: "text" },
      { key: "maps_url", label: "پیوند نقشه", kind: "text" },
      { key: "address", label: "آدرس", kind: "text" },
    ],
  },
];
const SELECT_LABEL: Partial<Record<DetailKey, (v: string) => string>> = {
  business_type: v => (isOneOf(BUSINESS_TYPES, v) ? BUSINESS_TYPE_LABEL[v] : ""),
  price_tier: v => (isOneOf(PRICE_TIERS, v) ? PRICE_TIER_LABEL[v] : ""),
};

/** The nested bento of «اطلاعات کسب‌وکار»: grouped rows with explicit edit/add cues, inline
 *  editors, and a held five-second PATCH — «لغو» cancels before anything reaches the server.
 *  Hours are edited through the tap flow the parent opens; the map shows the saved pin only. */
export default function BusinessDetails({ business, canWrite, disabled, onPatch, onHours }: {
  business: Profile["business"]; canWrite: boolean; disabled: boolean;
  onPatch: (body: Record<string, unknown>) => Promise<void>; onHours: () => void;
}) {
  const [edit, setEdit] = useState<{ row: Row; value: string } | null>(null);
  const [pending, setPending] = useState<{ row: Row; prev: string; body: Record<string, unknown> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!pending && !sending) return;
    const unload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    const navigate = (e: MouseEvent) => {
      if ((e.target as Element)?.closest("a[href]")) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); };
  }, [pending, sending]);
  const valueOf = (key: DetailKey): string => {
    if (key === "phone") return business.phone_norm ? `0${business.phone_norm}` : "";
    if (key === "business_type" || key === "price_tier") return SELECT_LABEL[key]?.(String(business[key] ?? "")) ?? "";
    return String(business[key as keyof Profile["business"]] ?? "");
  };
  function send(row: Row, body: Record<string, unknown>) {
    setSending(true);
    void (async () => {
      try { await onPatch(body); setPending(null); }
      catch (e) {
        setPending(null); setError(e instanceof Error ? e.message : "اتصال برقرار نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.");
        setEdit({ row, value: String(body[row.key] ?? "") });
      } finally { setSending(false); }
    })();
  }
  function commit(row: Row, prev: string, body: Record<string, unknown>) {
    if (timer.current) clearTimeout(timer.current);
    setPending({ row, prev, body });
    timer.current = setTimeout(() => { setPending(null); send(row, body); }, 5000);
  }
  function submit() {
    if (!edit || disabled || pending || sending) return;
    const { row, value } = edit;
    const text = row.kind === "phone" ? sanitizePhoneInput(value).trim() : value.trim();
    if (row.key === "business_name" && text.length < 2) { setError("نام کسب‌وکار را وارد کنید"); return; }
    if (row.kind === "phone" && text && !normPhone(text)) { setError("شماره تلفن معتبر نیست"); return; }
    setError(null);
    setEdit(null);
    commit(row, text, { [row.key]: text === "" ? null : text });
  }
  function undo() {
    if (timer.current) clearTimeout(timer.current);
    if (!pending) return;
    const { row, prev } = pending;
    setPending(null);
    setEdit({ row, value: prev });
  }
  const rowEditor = (row: Row, value: string) => (
    <form className="inline-edit" onSubmit={e => { e.preventDefault(); submit(); }}
      onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); setEdit(null); setError(null); } }}>
      <label>
        {row.label}
        {row.kind === "select" ? (
          <span className="chip-grid" role="radiogroup" aria-label={row.label}>
            {(row.options ?? []).map(o => {
              const on = o === value;
              return <button key={o} type="button" role="radio" aria-checked={on} className={`chip${on ? " on" : ""}`} disabled={disabled || !!pending || sending}
                onClick={() => { setError(null); setEdit({ row, value: o }); }}>
                <Icon name="user" size="md" />
                {SELECT_LABEL[row.key]?.(o)}</button>;
            })}
          </span>
        ) : (
          <input autoFocus className="tf-input" aria-label={row.label} value={value} inputMode={row.kind === "phone" ? "tel" : "text"}
            dir={row.kind === "phone" ? "ltr" : undefined}
            onChange={e => setEdit(cur => cur && { ...cur, value: row.kind === "phone" ? sanitizePhoneInput(e.target.value) : e.target.value })} />
        )}
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="edit-actions">
        <button type="submit" className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid" style={TOUCH} disabled={disabled || !!pending || sending}>
        <Icon name="check" size="md" />
        ثبت تغییر</button>
        <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" style={TOUCH} disabled={disabled || !!pending || sending} onClick={() => { setEdit(null); setError(null); }}>
        <Icon name="x" size="md" />
        انصراف</button>
      </div>
    </form>
  );
  const rowDisplay = (row: Row) => {
    const v = valueOf(row.key);
    const inner = <>
      <span><span className="k">{row.label}</span><span className={`v${v ? "" : " empty"}`}>{v || "ثبت نشده"}</span></span>
      {canWrite && <span className="cue">{v ? "ویرایش" : "افزودن"}</span>}
    </>;
    if (!canWrite) return <div key={row.key} className="field-row">{inner}</div>;
    return (
      <button key={row.key} type="button" className={`field-row${v ? "" : " empty"}`} style={TOUCH} disabled={disabled || !!pending || sending}
        aria-label={`${v ? "ویرایش" : "افزودن"} ${row.label}`}
        onClick={() => { setError(null); setEdit({ row, value: row.kind === "select" ? String(business[row.key as keyof typeof business] ?? "") : valueOf(row.key) }); }}>
        <Icon name="phone" size="md" />
        {inner}
      </button>
    );
  };
  const hours = parseHours(business.working_hours_json);
  return (
    <section className="tile crm-details">
      <h2>اطلاعات کسب‌وکار</h2>
      {pending && <div className="pending-note" role="status"><span>{pending.row.label} ثبت می‌شود…</span><button type="button" style={TOUCH} onClick={undo}>
      <Icon name="x" size="md" />
      لغو</button></div>}
      <div className="details-grid">
        {GROUPS.map(g => (
          <section key={g.title} className={`bento-section${g.icon === "map-pin" ? " location-section wide" : ""}`} style={{ "--tint": g.tint } as CSSProperties}>
            <div className="section-head">
              <span className="icon" aria-hidden="true"><Icon name={g.icon} size="sm" /></span>
              <h3>{g.title}</h3>
            </div>
            <p className="section-hint">{g.hint}</p>
            <div className="field-list">
              {g.rows.map(row => (edit && edit.row.key === row.key ? <div key={row.key}>{rowEditor(row, edit.value)}</div> : rowDisplay(row)))}
              {g.icon === "map-pin" && <>
          <div className="field-list">
            {canWrite ? (
              <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] field-row" style={TOUCH} disabled={disabled || !!pending || sending}
                aria-label={hours.length ? "ویرایش ساعت کاری" : "افزودن ساعت کاری"} onClick={onHours}>
                <Icon name="clock" size="md" />
                <span><span className="k">ساعت کاری</span><span className={`v${hours.length ? "" : " empty"}`}>{formatHours(hours) || "ثبت نشده"}</span></span>
                <span className="cue">{hours.length ? "ویرایش" : "افزودن"}</span>
              </button>
            ) : <div className="field-row"><span><span className="k">ساعت کاری</span><span className="v">{formatHours(hours) || "ثبت نشده"}</span></span></div>}
          </div>
              </>}
              {g.icon === "map-pin" && <div className="wide"><CustomerLocation lat={business.lat} lng={business.lng} name={business.business_name} mapsUrl={business.maps_url} canWrite={canWrite} busy={disabled || !!pending || sending || !!edit} onConfirm={async (lat, lng, link) => { await onPatch({ lat, lng, maps_url: link ?? null }); }} /></div>}
            </div>
          </section>
        ))}

      </div>
    </section>
  );
}

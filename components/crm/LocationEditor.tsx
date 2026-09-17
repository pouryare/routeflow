"use client";
import { useEffect, useRef, useState } from "react";
import { isAllowedLinkHost, extractLatLng } from "@/lib/geoLinks";
import { Icon } from "@/components/meridian/Icon";
import CustomerLocationMap from "@/components/crm/CustomerLocationMap";
import { useMyPosition } from "@/components/MyPositionProvider";

const TOUCH = { minHeight: 44, minWidth: 44 } as const;
const URL_RE = /^https?:\/\//i;

export interface Draft { lat: number; lng: number; link?: string }

/** Pin drop seeded from the saved location, plus pasted map-service links.
 *
 *  State here is a draft: saving is always the host's decision, made through onConfirm.
 *  The draft survives size changes on purpose — expanding the map for precise placement
 *  must not restart the edit, and a failed save must not swallow it.
 */
export default function LocationEditor({ initial, onConfirm, onCancel, expandable = true, expanded: controlledExpanded, onExpandChange }: {
  initial: Draft | null;
  onConfirm: (lat: number, lng: number, link?: string) => void | Promise<void>;
  onCancel: () => void;
  expandable?: boolean;
  expanded?: boolean;
  onExpandChange?: (expanded: boolean) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(initial ? { ...initial } : null);
  const [link, setLink] = useState(initial?.link ?? "");
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { position } = useMyPosition();
  const [localExpanded, setExpanded] = useState(false);
  const expanded = controlledExpanded ?? localExpanded;
  const panel = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  const request = useRef(0);
  const changeExpanded = (value: boolean) => { setExpanded(value); onExpandChange?.(value); };
  useEffect(() => () => { request.current++; }, []);

  useEffect(() => {
    if (!expandable || !expanded) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); setExpanded(false); onExpandChange?.(false); }
      if (e.key === "Tab") {
        const nodes = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]');
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", escape, true);
    return () => { window.removeEventListener("keydown", escape, true); document.body.style.overflow = overflow; previous?.focus(); };
  }, [expandable, expanded, onExpandChange]);

  async function resolveLink(u: string) {
    if (lock.current) return;
    const version = ++request.current;
    setResolving(true); setError(null);
    try {
      if (!isAllowedLinkHost(new URL(u).hostname)) throw new Error("فقط پیوند گوگل‌مپ، نشان، بلد یا ویز پشتیبانی می‌شود");
      const direct = extractLatLng(u);
      const j = direct ? { ok: true, link: direct, error: undefined } : await (await fetch("/api/crm/resolve-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: u }) })).json();
      if (version !== request.current) return;
      const lat = j.link?.lat, lng = j.link?.lng;
      if (!j.ok || typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error(j.error ?? "مختصات از این لینک قابل استخراج نبود؛ روی نقشه انتخاب کنید");
      setDraft({ lat, lng, link: u });
    } catch (e) {
      if (version === request.current) setError(e instanceof Error ? e.message : "اتصال برقرار نشد");
    } finally {
      if (version === request.current) setResolving(false);
    }
  }

  const save = async () => {
    if (!draft || lock.current || resolving) return;
    lock.current = true;
    setSaving(true);
    setError(null);
    try {
      await onConfirm(draft.lat, draft.lng, draft.link);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ذخیره نشد");
    } finally {
      lock.current = false;
      setSaving(false);
    }
  };

  return (
    <div ref={panel} tabIndex={-1} className={`location-edit${expanded ? " location-edit-expanded" : ""}`} role={expanded ? "dialog" : undefined} aria-modal={expanded || undefined} aria-label="ویرایش موقعیت">
      <div className="location-edit-heading"><strong>ویرایش موقعیت</strong>{expandable && <button type="button" className="btn ghost" aria-label={expanded ? "بازگشت به ویرایش درون‌خطی" : "بزرگ‌نمایی ناحیهٔ ویرایش"} onClick={() => changeExpanded(!expanded)}><Icon name="maximize" size="sm" />{expanded ? "بازگشت" : "بزرگ‌نمایی"}</button>}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
        <input
          className="tf-input ltr"
          value={link}
          disabled={saving}
          onChange={(e) => { request.current++; setResolving(false); setLink(e.target.value); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (URL_RE.test(link.trim()) && !resolving) void resolveLink(link.trim()); } }}
          placeholder="پیوند گوگل‌مپ، نشان، بلد یا ویز"
          aria-label="پیوند موقعیت"
          inputMode="url"
        />
        <button type="button" className="btn ghost" style={TOUCH} disabled={!URL_RE.test(link.trim()) || resolving || saving}
          aria-label="خواندن پیوند موقعیت" onClick={() => void resolveLink(link.trim())}>
          {resolving ? "…" : "خواندن"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="map-frame" style={{ height: expanded ? "min(56dvh, 480px)" : 180 }}>
        <CustomerLocationMap
          lat={draft?.lat ?? initial?.lat ?? 35.7}
          lng={draft?.lng ?? initial?.lng ?? 51.4}
          name="ویرایش موقعیت"
          interactive
          picked={draft ? [draft.lat, draft.lng] : null}
          onPick={(lat, lng) => { if (lock.current) return; request.current++; setResolving(false); setDraft({ lat, lng }); }}
        />
        {position && (
          <button
            type="button"
            style={TOUCH}
            className="map-expand"
            disabled={saving}
            onClick={() => { request.current++; setResolving(false); setDraft({ lat: position.lat, lng: position.lng }); }}
          >
            اینجا هستم
          </button>
        )}
      </div>
      <p className="map-caption">{draft ? <span dir="ltr">{draft.lat.toFixed(5)}, {draft.lng.toFixed(5)}</span> : "روی نقشه بزنید تا موقعیت تعیین شود"}</p>
      <div className="edit-actions">
        <button type="button" className="btn solid" style={TOUCH} disabled={!draft || saving || resolving} onClick={() => void save()}>
          {saving ? "در حال ثبت…" : "ثبت موقعیت"}
        </button>
        <button type="button" className="btn ghost" style={TOUCH} disabled={saving} onClick={() => { request.current++; onCancel(); }}>انصراف</button>
      </div>
    </div>
  );
}

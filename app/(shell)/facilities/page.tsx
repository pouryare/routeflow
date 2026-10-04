"use client";

import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  FACILITY_KINDS,
  FACILITY_ICONS,
  FACILITY_LABEL,
  defaultIconFor,
  isPlaced,
  FacilityKind,
  FacilityRow,
} from "@/lib/facilityTypes";
import { facilityMarkerHtml } from "@/components/facilityArt";
import { distanceKm } from "@/lib/geo";
import { useToast } from "@/components/ToastProvider";
import { faFixed } from "@/lib/format";
import { parseIdParam } from "@/lib/deepLink";
import { coordText } from "@/lib/clipboard";
import CopyButton from "@/components/CopyButton";
import { SkeletonLabel, SkeletonRows } from "@/components/Skeleton";
import { Icon } from "@/components/meridian/Icon";

// Leaflet touches window on import, so the picker can't be server-rendered.
const LocationPinPicker = dynamic(() => import("@/components/LocationPinPicker"), { ssr: false });

const KIND_NAME: Record<FacilityKind, string> = {
  warehouse: "انبار",
  factory: "کارخانه",
  van: "ماشین",
  home: "خانه / مبدأ",
  office: "دفتر",
  shop: "فروشگاه",
  cold_storage: "سردخانه",
  parking: "پارکینگ",
  other: "مکان دیگر",
};


/** The shareable address of one site. Absolute so it survives being pasted into a chat
 *  app, which will not resolve a bare path. */
function siteLink(id: number): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/facilities?f=${id}`;
}

/** Repositioning and adding both open the same picker; this says which, and for whom.
 *  `null` means no picker is open. */
type PickerTarget = { mode: "edit"; facility: FacilityRow } | { mode: "create" } | null;

export default function FacilitiesPage() {
  const [facilities, setFacilities] = useState<FacilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [picker, setPicker] = useState<PickerTarget>(null);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<FacilityKind>("warehouse");
  // Seeded from the kind and re-seeded whenever it changes, so the radio group always shows
  // a valid selection for the kind currently chosen -- including after the kind is edited
  // on an existing place, where the stored icon may belong to the old kind's options.
  const [newIconKey, setNewIconKey] = useState(defaultIconFor("warehouse"));
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const toast = useToast();

  // /facilities?f=3 -- the link the map popup and the copy button hand out. Read once:
  // it names where to look on arrival, not a filter that stays applied.
  const [linkedId] = useState<number | undefined>(() =>
    typeof window === "undefined" ? undefined : parseIdParam(window.location.search, "f")
  );
  const linkedRef = useRef<HTMLElement>(null);

  // Runs when the list arrives, not on mount: the card being scrolled to does not exist
  // until the fetch resolves.
  useEffect(() => {
    if (linkedId === undefined || facilities.length === 0) return;
    linkedRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [linkedId, facilities]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/facilities");
      const data = await res.json();
      setFacilities(data.facilities ?? []);
    } catch {
      toast("خطا در بارگذاری مکان‌ها", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useRunAfterMount(load);

  async function patch(id: number, body: Record<string, unknown>, successMsg: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/facilities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "خطا در به‌روزرسانی");
      toast(successMsg, "success");
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "خطا در به‌روزرسانی", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function createFacility(lat: number, lng: number) {
    const name = newName.trim();
    if (!name) {
      toast("نام مکان را وارد کنید", "error");
      return;
    }
    try {
      const res = await fetch("/api/facilities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind: newKind, icon_key: newIconKey, lat, lng }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "خطا در افزودن مکان");
      toast("مکان اضافه شد", "success");
      setNewName("");
      setPicker(null);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "خطا در افزودن مکان", "error");
    }
  }

  /** Puts a deleted site back exactly as it was -- original id and slug, so the arrivals
   *  logged there stay attached, and the default-origin flag if it held one, since DELETE
   *  promotes a replacement and nothing else would move it back. */
  async function restore(deleted: FacilityRow) {
    try {
      const res = await fetch("/api/facilities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: deleted.name,
          kind: deleted.kind,
          lat: deleted.lat,
          lng: deleted.lng,
          address: deleted.address,
          maps_url: deleted.maps_url,
          notes: deleted.notes,
          restore: { id: deleted.id, slug: deleted.slug },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "خطا در بازگردانی");

      if (deleted.is_default_origin === 1) {
        await fetch(`/api/facilities/${data.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_default_origin: true }),
        });
      }

      toast(
        data.restored
          ? `«${deleted.name}» بازگردانده شد.`
          : `«${deleted.name}» بازگردانده شد، اما با شناسه جدید — بازدیدهای ثبت‌شده در آن به این ردیف وصل نیستند.`,
        data.restored ? "success" : "info"
      );
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "خطا در بازگردانی", "error");
    }
  }

  async function remove(id: number) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/facilities/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "خطا در حذف مکان");
      // The undo is offered rather than the deletion being confirmed up front: the
      // common case is that the delete was intended, and the rare mistake is repaired in
      // one tap instead of every correct delete costing a dialog.
      toast(
        `«${data.deleted?.name ?? "مکان"}» حذف شد.`,
        "success",
        data.deleted ? { label: "بازگردان", onClick: () => restore(data.deleted as FacilityRow) } : undefined
      );
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "خطا در حذف مکان", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
    <div dir="rtl" className="pagewrap">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.12em] text-accent">
              Our Sites
            </div>
            <h1 className="text-[length:var(--text-xl)] font-bold text-text">مکان‌های ما</h1>
          </div>
          <Link
            href="/map"
            className="shrink-0 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-sm)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent"
          >
            بازگشت به نقشه ←
          </Link>
        </div>

        <p className="text-[length:var(--text-sm)] leading-6 text-text-muted">
          انبارها و نقطه شروع مسیر شما. «مبدأ پیش‌فرض» جایی است که برنامه‌ریز مسیر، فاصله‌ها را از آنجا
          حساب می‌کند — هر بار فقط یک مکان می‌تواند مبدأ باشد. برای تغییر نام، روی نام مکان بزنید.
        </p>

        <section className="flex flex-col gap-2">
          {loading && (
            <>
              <SkeletonRows rows={2} />
              <SkeletonLabel>در حال بارگذاری مکان‌ها…</SkeletonLabel>
            </>
          )}

          {facilities.map((f) => {
            const isBusy = busyId === f.id;
            // A facility with no location has no distance to anything, so it is not a
            // candidate -- for itself or for its neighbour.
            const nearest = !isPlaced(f)
              ? undefined
              : (() => {
                  // const self: narrowing on a mutable binding is reset inside a closure.
                  const self = f;
                  return facilities
                    .filter(isPlaced)
                    .filter((x) => x.id !== self.id)
                    .map((other) => ({ other, km: distanceKm(self, other) }))
                    .sort((a, b) => a.km - b.km)[0];
                })();

            return (
              <article
                key={f.id}
                ref={f.id === linkedId ? linkedRef : undefined}
                className={`rounded-[var(--radius-lg)] border bg-surface-raised p-4 transition-[border-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                  f.id === linkedId
                    ? "border-accent elevate-accent"
                    : f.is_default_origin === 1
                      ? "border-border-strong elevate-accent"
                      : "border-border"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="mt-0.5 shrink-0"
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{ __html: facilityMarkerHtml(f.icon_key, f.kind) }}
                  />
                  <div className="min-w-0 flex-1">
                    {renamingId === f.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const name = renameDraft.trim();
                          setRenamingId(null);
                          if (name && name !== f.name) patch(f.id, { name }, "نام مکان تغییر کرد");
                        }}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <input
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          autoFocus
                          onKeyDown={(e) => e.key === "Escape" && setRenamingId(null)}
                          className="min-w-40 flex-1 rounded-[var(--radius-sm)] border border-accent bg-surface px-2 py-1 text-[length:var(--text-sm)] text-text outline-none"
                        />
                        <button
                          type="submit"
                          className="inline-flex items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-sm)] border border-accent bg-accent px-2 py-1 text-[length:var(--text-xs)] font-medium text-accent-ink"
                        >
                          <Icon name="edit" size="sm" />
                          ذخیره
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenamingId(null)}
                          className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted hover:border-crit hover:text-crit"
                        >
                          <Icon name="x" size="sm" />
                          انصراف
                        </button>
                      </form>
                    ) : (
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <button
                          onClick={() => {
                            setRenameDraft(f.name);
                            setRenamingId(f.id);
                          }}
                          title="تغییر نام"
                          className="text-right text-[length:var(--text-md)] font-medium text-text transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:text-accent"
                        >
                          <Icon name="edit" size="md" />
                          {f.name}
                        </button>
                        <span className="font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-faint">
                          {KIND_NAME[f.kind]}
                        </span>
                      </div>
                    )}
                    <p className="mt-0.5 text-[length:var(--text-xs)] text-text-muted">{FACILITY_LABEL[f.kind]}</p>
                    {f.address && (
                      <p className="mt-1.5 text-[length:var(--text-xs)] leading-5 text-text-muted">{f.address}</p>
                    )}
                    <p className="mt-1.5 flex items-center gap-2 text-right font-mono text-[length:var(--text-xs)] text-text-faint">
                      <span dir="ltr">{coordText(f.lat, f.lng)}</span>
                      {isPlaced(f) && <CopyButton value={coordText(f.lat, f.lng)} what="کپی مختصات" />}
                      <CopyButton value={() => siteLink(f.id)} what="کپی پیوند این مکان" />
                    </p>
                    {nearest && (
                      <p className="mt-1 font-mono text-[length:var(--text-xs)] text-text-faint">
                        {faFixed(nearest.km, 1)} کیلومتر تا {nearest.other.name} — خط مستقیم
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  <label
                    className={`flex items-center gap-1.5 text-[length:var(--text-xs)] ${
                      f.is_default_origin === 1 ? "text-accent" : "cursor-pointer text-text-muted hover:text-text"
                    }`}
                  >
                    <input
                      type="radio"
                      name="default-origin"
                      checked={f.is_default_origin === 1}
                      disabled={isBusy}
                      onChange={() => {
                        if (f.is_default_origin === 1) return;
                        patch(f.id, { is_default_origin: true }, `مبدأ پیش‌فرض به «${f.name}» تغییر کرد`);
                      }}
                      className="accent-[color:var(--accent)]"
                    />
                    {f.is_default_origin === 1 ? (
                      <>
                        مبدأ پیش‌فرض <Icon name="check" size="sm" />
                      </>
                    ) : (
                      "انتخاب به‌عنوان مبدأ"
                    )}
                  </label>

                  <div className="mr-auto flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setPicker({ mode: "edit", facility: f })}
                      disabled={isBusy}
                      className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent disabled:opacity-50"
                    >
                      <Icon name="edit" size="sm" />
                      ویرایش موقعیت
                    </button>
                    {/* No confirmation step: the toast carries an undo instead, so the
                        common case (a delete that was meant) costs one tap and the rare
                        mistake costs two -- the reverse of the dialog's trade. */}
                    <button
                      onClick={() => remove(f.id)}
                      disabled={isBusy}
                      className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-crit hover:text-crit disabled:opacity-50"
                    >
                      <Icon name="trash" size="sm" />
                      {isBusy ? "در حال حذف…" : "حذف"}
                    </button>
                  </div>
                </div>

                {picker?.mode === "edit" && picker.facility.id === f.id && (
                  <div className="mt-3">
                    <LocationPinPicker
                      initial={isPlaced(f) ? { lat: f.lat, lng: f.lng } : null}
                      onCancel={() => setPicker(null)}
                      onConfirm={(lat, lng) => {
                        setPicker(null);
                        patch(f.id, { lat, lng }, "موقعیت به‌روزرسانی شد");
                      }}
                    />
                  </div>
                )}
              </article>
            );
          })}
        </section>

        <section className="rounded-[var(--radius-lg)] border border-border bg-surface p-4">
          <h2 className="sechead__title mb-3">
            افزودن مکان
          </h2>
          <div className="flex flex-wrap gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="نام مکان"
              className="min-w-40 flex-1 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-sm)] text-text outline-none transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] focus:border-accent"
            />
            <select
              value={newKind}
              onChange={(e) => {
                const k = e.target.value as FacilityKind;
                setNewKind(k);
                setNewIconKey(defaultIconFor(k));
              }}
              className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-sm)] text-text outline-none focus:border-accent"
            >
              {FACILITY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_NAME[k]}
                </option>
              ))}
            </select>
            {/* The icon is the person's choice, not the kind's. Two warehouses can look
                different because they hold different things, and adding a kind later must
                not change what every existing place of that kind looks like -- which is why
                this picks from the kind's options rather than showing one fixed shape.
                Changing the kind above resets the choice to that kind's first option. */}
            <div className="flex items-center gap-1.5" role="radiogroup" aria-label="شکل مکان">
              {FACILITY_ICONS[newKind].map((key) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={newIconKey === key}
                  aria-label={key}
                  title={key}
                  onClick={() => setNewIconKey(key)}
                  className={`rounded-[var(--radius-md)] border p-1 transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                    newIconKey === key
                      ? "border-accent bg-accent/10"
                      : "border-border hover:border-text-faint"
                  }`}
                  dangerouslySetInnerHTML={{ __html: facilityMarkerHtml(key, newKind) }}
                />
              ))}
            </div>
            <button
              onClick={() => setPicker(picker?.mode === "create" ? null : { mode: "create" })}
              className="rounded-[var(--radius-md)] border border-accent bg-accent px-3 py-2 text-[length:var(--text-sm)] font-medium text-accent-ink transition-[filter,transform] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:brightness-110 active:scale-[0.98]"
            >
              <Icon name="map-pin" size="sm" />
              {picker?.mode === "create" ? "بستن نقشه" : "انتخاب موقعیت روی نقشه"}
            </button>
          </div>

          {picker?.mode === "create" && (
            <div className="mt-3">
              <LocationPinPicker onCancel={() => setPicker(null)} onConfirm={createFacility} />
            </div>
          )}
        </section>
      </div>
    </div>    </>
  );
}

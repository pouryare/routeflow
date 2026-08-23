"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { FACILITY_KINDS, FACILITY_LABEL, FacilityKind, FacilityRow } from "@/lib/facilityTypes";
import { facilityMarkerHtml } from "@/components/facilityArt";
import { distanceKm } from "@/lib/geo";
import { useToast } from "@/components/ToastProvider";

// Leaflet touches window on import, so the picker can't be server-rendered.
const LocationPinPicker = dynamic(() => import("@/components/LocationPinPicker"), { ssr: false });

const KIND_NAME: Record<FacilityKind, string> = {
  warehouse: "انبار",
  home_base: "خانه / مبدأ",
  other: "مکان دیگر",
};

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
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const toast = useToast();

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

  useEffect(() => {
    load();
  }, [load]);

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
        body: JSON.stringify({ name, kind: newKind, lat, lng }),
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

  async function remove(id: number) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/facilities/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "خطا در حذف مکان");
      toast("مکان حذف شد", "success");
      setConfirmingDelete(null);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "خطا در حذف مکان", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div dir="rtl" className="min-h-screen bg-bg p-4 sm:p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.12em] text-accent">
              Our Sites
            </div>
            <h1 className="text-[length:var(--text-xl)] font-bold text-text">مکان‌های ما</h1>
          </div>
          <Link
            href="/"
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
          {loading && <p className="text-[length:var(--text-sm)] text-text-muted">در حال بارگذاری…</p>}

          {facilities.map((f) => {
            const isBusy = busyId === f.id;
            const nearest = facilities
              .filter((x) => x.id !== f.id)
              .map((other) => ({ other, km: distanceKm(f, other) }))
              .sort((a, b) => a.km - b.km)[0];

            return (
              <article
                key={f.id}
                className={`rounded-[var(--radius-lg)] border bg-surface-raised p-4 transition-[border-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-out)] ${
                  f.is_default_origin === 1 ? "border-border-strong elevate-accent" : "border-border"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="mt-0.5 shrink-0"
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{ __html: facilityMarkerHtml(f.kind) }}
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
                          className="rounded-[var(--radius-sm)] border border-accent bg-accent px-2 py-1 text-[length:var(--text-xs)] font-medium text-[#04191c]"
                        >
                          ذخیره
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenamingId(null)}
                          className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted hover:border-crit hover:text-crit"
                        >
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
                    <p
                      dir="ltr"
                      className="mt-1.5 text-right font-mono text-[length:var(--text-xs)] text-text-faint"
                    >
                      {f.lat.toFixed(6)}, {f.lng.toFixed(6)}
                    </p>
                    {nearest && (
                      <p className="mt-1 font-mono text-[length:var(--text-xs)] text-text-faint">
                        {nearest.km.toFixed(1)} کیلومتر تا {nearest.other.name} — خط مستقیم
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
                    {f.is_default_origin === 1 ? "مبدأ پیش‌فرض ✓" : "انتخاب به‌عنوان مبدأ"}
                  </label>

                  <div className="mr-auto flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setPicker({ mode: "edit", facility: f })}
                      disabled={isBusy}
                      className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent disabled:opacity-50"
                    >
                      ویرایش موقعیت
                    </button>
                    {confirmingDelete === f.id ? (
                      <>
                        <button
                          onClick={() => remove(f.id)}
                          disabled={isBusy}
                          className="rounded-[var(--radius-sm)] border border-crit bg-crit px-2 py-1 text-[length:var(--text-xs)] font-medium text-[#1a0206] disabled:opacity-50"
                        >
                          {isBusy ? "در حال حذف…" : "حذف قطعی"}
                        </button>
                        <button
                          onClick={() => setConfirmingDelete(null)}
                          className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted hover:border-accent hover:text-accent"
                        >
                          انصراف
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmingDelete(f.id)}
                        disabled={isBusy}
                        className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-crit hover:text-crit disabled:opacity-50"
                      >
                        حذف
                      </button>
                    )}
                  </div>
                </div>

                {picker?.mode === "edit" && picker.facility.id === f.id && (
                  <div className="mt-3">
                    <LocationPinPicker
                      initial={{ lat: f.lat, lng: f.lng }}
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
          <h2 className="mb-3 font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted">
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
              onChange={(e) => setNewKind(e.target.value as FacilityKind)}
              className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-sm)] text-text outline-none focus:border-accent"
            >
              {FACILITY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_NAME[k]}
                </option>
              ))}
            </select>
            <button
              onClick={() => setPicker(picker?.mode === "create" ? null : { mode: "create" })}
              className="rounded-[var(--radius-md)] border border-accent bg-accent px-3 py-2 text-[length:var(--text-sm)] font-medium text-[#04191c] transition-[filter,transform] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:brightness-110 active:scale-[0.98]"
            >
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
    </div>
  );
}

"use client";

import { useCallback, useState } from "react";
import { friendlyError } from "@/lib/userMessage";

import { Icon } from "@/components/meridian/Icon";
import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { faJalaliDate } from "@/lib/jalali";
import JalaliDateInput from "@/components/meridian/JalaliDateInput";

interface StoredHoliday {
  iso_date: string;
  title_fa: string;
  kind: "official" | "commemorative";
  is_lunar: number;
  note: string | null;
  created_at: string;
}

/** Record the lunar holidays an algorithm cannot know.
 *
 *  Eid al-Fitr, Eid al-Adha, Tasua, Ashura and Mawlid are Lunar Hijri. They move against
 *  the Gregorian calendar every year and Iran sets them by moon sighting, so nothing offline
 *  can compute them — hence this screen rather than a seed. That is not a workaround; it is
 *  how every Iranian HR system does it.
 *
 *  The copy says plainly that a date here is the owner's word, not a computation: a seed that
 *  lands on the wrong day of Eid is worse than an empty one, because it looks authoritative. */
export default function AdminHolidaysPage() {
  const [rows, setRows] = useState<StoredHoliday[] | null>(null);
  const [iso, setIso] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/holidays");
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setRows(data.holidays ?? []);
      setError(null);
    } else {
      setError(friendlyError(data.error, "فهرست تعطیلی‌ها بارگذاری نشد؛ دوباره تلاش کنید"));
    }
  }, []);

  useRunAfterMount(load);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/admin/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ iso, title_fa: title }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(friendlyError(data.error, "تعطیلی ثبت نشد؛ دوباره تلاش کنید"));
        return;
      }
      setError(null);
      setIso("");
      setTitle("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(isoDate: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/holidays/${encodeURIComponent(isoDate)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(friendlyError(data.error, "تعطیلی حذف نشد؛ دوباره تلاش کنید"));
        return;
      }
      setError(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-[var(--space-4)]">
        {error && (
          <p role="alert" className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-sm text-crit">
            {error}
          </p>
        )}

        <p className="rounded-lg border border-border bg-surface p-3 text-xs text-text-muted">
          تعطیلات قمری (عید فطر، عید قربان، تاسوعا، عاشورا، میلاد) هر سال جابه‌جا می‌شوند و با
          رؤیت ماه تعیین می‌گردند؛ هیچ برنامه‌ای نمی‌تواند آن‌ها را حساب کند. تاریخی که اینجا
          ثبت می‌کنید، تأیید خودِ شماست — پس اگر تاریخ رسمی اعلام شد و فرق داشت، همین‌جا اصلاح
          کنید. تعطیلات شمسی مثل نوروز خودکار نمایش داده می‌شوند و نیازی به ثبت ندارند.
        </p>

        <form onSubmit={add} className="rounded-lg border border-border bg-surface p-4">
          <h2 className="sechead__title mb-3">ثبت تعطیل قمری</h2>
          <div className="flex flex-wrap items-end gap-2">
            {/* JalaliDateInput rather than a native date field: the browser's picker is
                Gregorian, so an owner hunting for عید فطر would be reading the wrong
                calendar entirely while the field looked Persian. This component shows and
                returns Jalali while speaking ISO underneath. tests/no-gregorian-dates.test.ts
                enforces that no rendered file reaches for the native picker. */}
            <label className="flex flex-col gap-1 text-xs text-text-muted">
              تاریخ
              <JalaliDateInput
                value={iso}
                onChange={setIso}
                required
                aria-label="تاریخ تعطیل"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs text-text-muted">
              عنوان
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="عید فطر"
                required
                className="rounded-md border border-border bg-surface-raised px-2 py-1 text-sm text-text outline-none placeholder:text-text-faint focus:border-accent"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="flex cursor-pointer items-center gap-1 rounded-md border border-border px-3 py-1 text-sm text-text transition-colors hover:border-accent disabled:opacity-50"
            >
              <Icon name="plus" size="md" />
              ثبت تعطیلی
            </button>
          </div>
        </form>

        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="sechead__title mb-3">ثبت‌شده‌ها</h2>
          {rows === null ? (
            <p className="text-sm text-text-muted">در حال بارگذاری…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-text-muted">
              هنوز تعطیل قمری‌ای ثبت نشده. تقویم فقط تعطیلات شمسی خودکار را نشان می‌دهد.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {rows.map((r) => (
                <li
                  key={r.iso_date}
                  className="flex items-center justify-between gap-2 border-b border-border py-1 text-sm last:border-b-0"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={`calflag calflag--${r.kind}`}
                      title={r.kind === "official" ? "تعطیل رسمی" : "یادبود"}
                    />
                    <span className="text-text">{r.title_fa}</span>
                    {/* The stored ISO, shown as the exact value the API holds. It is a
                        machine identifier, not a date for a reader — the Jalali date beside
                        it is that. */}
                    <span
                      className="font-mono text-xs text-text-faint"
                      dir="ltr"
                      title="شناسهٔ ذخیره‌شده (میلادی)"
                    >
                      {r.iso_date}
                    </span>
                    <span className="text-xs text-text-faint">{faJalaliDate(r.iso_date)}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void remove(r.iso_date)}
                    disabled={busy}
                    aria-label={`حذف ${r.title_fa}`}
                    className="flex cursor-pointer items-center gap-1 text-xs text-text-muted transition-colors hover:text-crit disabled:opacity-50"
                  >
                    <Icon name="trash" size="sm" />
                    حذف این تعطیلی
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-text-faint">
            حذف یک تعطیلِ ثبت‌شده، آن روز را از تقویم برمی‌دارد. اگر آن روز تعطیل شمسی هم باشد،
            تعطیل شمسی خودکار برمی‌گردد.
          </p>
        </section>
      </div>
    </>
  );
}

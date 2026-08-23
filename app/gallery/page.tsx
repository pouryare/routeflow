"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { faDate, faNum } from "@/lib/format";
import { parseIdParam } from "@/lib/deepLink";
import CopyButton from "@/components/CopyButton";
import { SkeletonLabel, SkeletonThumbs } from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";

interface PhotoItem {
  id: number;
  entity_type: "district" | "customer";
  entity_id: number;
  caption: string | null;
  taken_at: string;
  label: string;
}

export default function GalleryPage() {
  const [photos, setPhotos] = useState<PhotoItem[] | null>(null);
  const [lightbox, setLightbox] = useState<PhotoItem | null>(null);

  // /gallery?p=8 -- a link to one photo. Read once on mount, then applied when the list
  // lands, since the photo it names does not exist until then.
  const [linkedId] = useState<number | undefined>(() =>
    typeof window === "undefined" ? undefined : parseIdParam(window.location.search, "p")
  );
  const linkAppliedRef = useRef(false);

  useEffect(() => {
    if (linkedId === undefined || linkAppliedRef.current || !photos) return;
    const hit = photos.find((x) => x.id === linkedId);
    if (!hit) return;
    linkAppliedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLightbox(hit);
  }, [photos, linkedId]);

  async function load() {
    const res = await fetch("/api/photos");
    const data = await res.json();
    setPhotos(data.photos ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function remove(id: number) {
    await fetch(`/api/photos/${id}`, { method: "DELETE" });
    setLightbox(null);
    load();
  }

  return (
    <div dir="rtl" className="min-h-screen bg-bg p-4 sm:p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.12em] text-accent">
              Gallery
            </div>
            <h1 className="text-[length:var(--text-xl)] font-bold text-text">
              گالری تصاویر{photos && photos.length > 0 ? ` (${faNum(photos.length)})` : ""}
            </h1>
          </div>
          <Link
            href="/"
            className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-sm)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent"
          >
            بازگشت به نقشه ←
          </Link>
        </div>

        {photos === null ? (
          <>
            <SkeletonThumbs count={9} className="sm:grid-cols-4" />
            <SkeletonLabel>در حال بارگذاری تصاویر…</SkeletonLabel>
          </>
        ) : photos.length === 0 ? (
          <EmptyState
            icon="🖼"
            title="هنوز عکسی ثبت نشده"
            hint="عکس‌ها از پنل هر مشتری یا منطقه روی نقشه اضافه می‌شوند و بعد همه‌شان اینجا جمع می‌شوند."
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {photos.map((p) => (
              <button
                key={p.id}
                onClick={() => setLightbox(p)}
                className="group flex flex-col overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface-raised text-right transition-[border-color] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent"
              >
                <div className="aspect-square w-full overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element -- dynamic per-photo API route, format-negotiated via <picture> */}
                  <picture>
                    <source srcSet={`/api/photos/${p.id}/file?format=avif`} type="image/avif" />
                    <img
                      src={`/api/photos/${p.id}/file?format=webp`}
                      alt={p.caption ?? ""}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-[var(--dur-slow)] ease-[var(--ease-out)] group-hover:scale-[1.03]"
                    />
                  </picture>
                </div>
                <div className="p-2">
                  <div className="truncate text-[length:var(--text-sm)] text-text">{p.label}</div>
                  <div dir="ltr" className="mt-0.5 inline-block font-mono text-[length:var(--text-xs)] text-text-faint">
                    {faDate(p.taken_at)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element -- dynamic per-photo API route, format-negotiated via <picture> */}
            <picture>
              <source srcSet={`/api/photos/${lightbox.id}/file?format=avif`} type="image/avif" />
              <img
                src={`/api/photos/${lightbox.id}/file?format=webp`}
                alt={lightbox.caption ?? ""}
                className="max-h-[80vh] max-w-full rounded-[var(--radius-md)]"
              />
            </picture>
            <div dir="rtl" className="mt-2 flex items-center justify-between">
              <div className="text-[length:var(--text-sm)] text-text">
                {lightbox.label}{" "}
                <span dir="ltr" className="font-mono text-[length:var(--text-xs)] text-text-faint">
                  {faDate(lightbox.taken_at)}
                </span>
              </div>
              <div className="flex gap-2">
                <CopyButton
                  value={() => `${window.location.origin}/gallery?p=${lightbox.id}`}
                  label="پیوند"
                  what="کپی پیوند این عکس"
                  className="px-3 py-1.5 text-[length:var(--text-sm)]"
                />
                <button
                  onClick={() => setLightbox(null)}
                  className="rounded-[var(--radius-sm)] border border-border bg-surface-raised px-3 py-1.5 text-[length:var(--text-sm)] text-text"
                >
                  بستن
                </button>
                <button
                  onClick={() => remove(lightbox.id)}
                  className="rounded-[var(--radius-sm)] border border-crit px-3 py-1.5 text-[length:var(--text-sm)] text-crit"
                >
                  حذف عکس
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

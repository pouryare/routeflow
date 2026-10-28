"use client";

import { useUndoableAction } from "@/components/tapflow/useUndoableAction";
import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { Icon } from "@/components/meridian/Icon";
import { useState, useCallback } from "react";
import Link from "next/link";
import { faNum } from "@/lib/format";
import { parseIdParam } from "@/lib/deepLink";
import CopyButton from "@/components/CopyButton";
import { SkeletonLabel, SkeletonThumbs } from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";
import { faJalaliDate } from "@/lib/jalali";
import dynamic from "next/dynamic";

// Cast back to the generic component: dynamic() drops the type parameter.
const PhotoLightbox = dynamic(() => import("@/components/PhotoLightbox"), { ssr: false }) as typeof import("@/components/PhotoLightbox").default;

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
  // The viewer's code loads with the first photo opened and then stays, so it can animate out.
  const [viewerUsed, setViewerUsed] = useState(false);
  if (lightbox && !viewerUsed) setViewerUsed(true);

  // /gallery?p=8 -- a link to one photo. Read once on mount, then applied when the list
  // lands, since the photo it names does not exist until then.
  const [linkedId] = useState<number | undefined>(() =>
    typeof window === "undefined" ? undefined : parseIdParam(window.location.search, "p")
  );
  const [linkApplied, setLinkApplied] = useState(false);
  if (linkedId !== undefined && !linkApplied && photos) {
    const hit = photos.find((x) => x.id === linkedId);
    if (hit) {
      setLinkApplied(true);
      setLightbox(hit);
    }
  }

  const load = useCallback(async () => {
    const res = await fetch("/api/photos");
    const data = await res.json();
    setPhotos(data.photos ?? []);
  }, []);

  useRunAfterMount(load);

  const undoable = useUndoableAction();
  function remove(id: number) {
    setLightbox(null);
    undoable.run({
      message: "عکس حذف شد",
      send: async () => {
        const res = await fetch(`/api/photos/${id}`, { method: "DELETE" });
        return res.ok ? { ok: true } : { ok: false };
      },
      failure: "عکس حذف نشد؛ دوباره تلاش کنید",
      onDone: () => load(),
    });
  }

  return (
    <>
    <div dir="rtl" className="pagewrap">
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
            href="/map"
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
            icon="image"
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
                    {faJalaliDate(p.taken_at)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {viewerUsed && (
        <PhotoLightbox
          photos={photos ?? []}
          index={lightbox && photos ? photos.indexOf(lightbox) : -1}
          onClose={() => setLightbox(null)}
          actions={(p) => (
            <>
              <span className="photo-lightbox__label">
                {p.label}{" "}
                <span dir="ltr" className="font-mono text-[length:var(--text-xs)]">{faJalaliDate(p.taken_at)}</span>
              </span>
              <CopyButton
                value={() => `${window.location.origin}/gallery?p=${p.id}`}
                label="لینک"
                what="کپی لینک این عکس"
                className="px-3 py-1.5 text-[length:var(--text-sm)]"
              />
              <button type="button" onClick={() => remove(p.id)} className="photo-lightbox__delete">
                <Icon name="trash" size="sm" />
                حذف عکس
              </button>
            </>
          )}
        />
      )}
    </div>    </>
  );
}

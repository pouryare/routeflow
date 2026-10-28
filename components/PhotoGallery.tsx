"use client";

import { useUndoableAction } from "@/components/tapflow/useUndoableAction";
import { useRunAfterMount } from "@/lib/useRunAfterMount";
import { friendlyError } from "@/lib/userMessage";
import { Icon } from "@/components/meridian/Icon";
import { useRef, useState, useCallback } from "react";
import { useToast } from "./ToastProvider";
import { faNum } from "@/lib/format";
import { SkeletonLabel, SkeletonThumbs } from "./Skeleton";
import EmptyState from "./EmptyState";
import dynamic from "next/dynamic";

// Cast back to the generic component: dynamic() drops the type parameter.
const PhotoLightbox = dynamic(() => import("@/components/PhotoLightbox"), { ssr: false }) as typeof import("@/components/PhotoLightbox").default;

interface PhotoItem {
  id: number;
  file_stem: string;
  caption: string | null;
  taken_at: string;
}

export default function PhotoGallery({
  entityType,
  entityId,
}: {
  entityType: "district" | "customer";
  entityId: number;
}) {
  const [photos, setPhotos] = useState<PhotoItem[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState<PhotoItem | null>(null);
  // The viewer's code loads with the first photo opened and then stays, so it can animate out.
  const [viewerUsed, setViewerUsed] = useState(false);
  if (lightbox && !viewerUsed) setViewerUsed(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  /* Only the newest request may write: opening another customer while this one's photos
     are still loading must not let the slower, older answer land on the new customer. */
  const latest = useRef(0);
  const load = useCallback(async () => {
    const ticket = ++latest.current;
    const res = await fetch(`/api/photos?entity_type=${entityType}&entity_id=${entityId}`);
    const data = await res.json();
    if (ticket === latest.current) setPhotos(data.photos ?? []);
  }, [entityType, entityId]);

  useRunAfterMount(load);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("entity_type", entityType);
      fd.append("entity_id", String(entityId));
      const res = await fetch("/api/photos", { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(friendlyError(data?.error, "عکس بارگذاری نشد؛ دوباره تلاش کنید"));
      }
      toast("عکس اضافه شد.", "success");
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "عکس بارگذاری نشد؛ دوباره تلاش کنید", "error");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

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
    <div className="mt-4 border-t border-border pt-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="sechead__title sechead__title--minor">
          گالری تصاویر{photos && photos.length > 0 ? ` (${faNum(photos.length)})` : ""}
        </h3>
        <label className="cursor-pointer rounded-[var(--radius-sm)] border border-border px-2 py-1 text-[length:var(--text-xs)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent">
          {uploading ? "در حال بارگذاری…" : "+ عکس"}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
        </label>
      </div>

      {photos === null ? (
        <>
          <SkeletonThumbs count={3} />
          <SkeletonLabel>در حال بارگذاری تصاویر…</SkeletonLabel>
        </>
      ) : photos.length === 0 ? (
        <EmptyState icon="image" title="هنوز عکسی ثبت نشده" className="py-4" />
      ) : (
        <div className="grid grid-cols-4 gap-1.5">
          {photos.map((p) => (
            <button
              key={p.id}
              onClick={() => setLightbox(p)}
              className="aspect-square overflow-hidden rounded-[var(--radius-sm)] border border-border transition-[border-color] duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent"
            >
              <picture>
                <source srcSet={`/api/photos/${p.id}/file?format=avif`} type="image/avif" />
                <img
                  src={`/api/photos/${p.id}/file?format=webp`}
                  alt={p.caption ?? ""}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </picture>
            </button>
          ))}
        </div>
      )}

      {viewerUsed && (
        <PhotoLightbox
          photos={photos ?? []}
          index={lightbox && photos ? photos.indexOf(lightbox) : -1}
          onClose={() => setLightbox(null)}
          actions={(p) => (
            <button type="button" onClick={() => remove(p.id)} className="photo-lightbox__delete">
              <Icon name="trash" size="sm" />
              حذف عکس
            </button>
          )}
        />
      )}
    </div>
  );
}

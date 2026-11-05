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
import PhotoCropSheet from "@/components/mobile/PhotoCropSheet";
import { photoProblem } from "@/lib/photoCrop";
import { useDropFile } from "@/lib/useDropFile";
import { postWithProgress } from "@/lib/uploadProgress";
import UploadTile from "@/components/UploadTile";

// Cast back to the generic component: dynamic() drops the type parameter.
import PhotoBrowser from "@/components/PhotoBrowser";
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
  // The chosen file waits in the crop sheet until the person confirms the frame.
  const [framing, setFraming] = useState<File | null>(null);
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

  /** A chosen or dropped file: refuse what cannot be a photo, otherwise let the person frame it. */
  function choose(file: File) {
    const problem = photoProblem(file);
    if (problem) toast(problem, "error");
    else setFraming(file);
    if (inputRef.current) inputRef.current.value = "";
  }

  const drop = useDropFile(choose);

  /* The photo being sent, shown as a tile with a % ring; it stays, red with «دوباره», if sending fails. */
  const [sending, setSending] = useState<{ file: File; src: string; percent: number; state: "sending" | "done" | "failed" } | null>(null);

  async function handleFile(file: File) {
    setUploading(true);
    const src = sending?.file === file ? sending.src : URL.createObjectURL(file);
    setSending({ file, src, percent: 0, state: "sending" });
    const fd = new FormData();
    fd.append("file", file);
    fd.append("entity_type", entityType);
    fd.append("entity_id", String(entityId));
    const res = await postWithProgress("/api/photos", fd, (percent) => setSending((s) => s && { ...s, percent }));
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
    if (res.status >= 200 && res.status < 300) {
      setSending((s) => s && { ...s, percent: 100, state: "done" });
      toast("عکس اضافه شد.", "success");
      await load();
      window.setTimeout(() => {
        URL.revokeObjectURL(src);
        setSending((s) => (s?.src === src ? null : s));
      }, 700);
      return;
    }
    setSending((s) => s && { ...s, state: "failed" });
    const err = (res.json as { error?: string } | null)?.error;
    toast(res.status === 0 ? "عکس بارگذاری نشد؛ اینترنت را بررسی کنید و «دوباره» را بزنید" : friendlyError(err, "عکس بارگذاری نشد؛ دوباره تلاش کنید"), "error");
  }

  function dismissSending() {
    if (sending) URL.revokeObjectURL(sending.src);
    setSending(null);
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
    <div
      className={`mt-4 border-t border-border pt-3${drop.over ? " dropzone--over" : ""}`}
      {...drop.props}
    >
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
              if (f) choose(f);
            }}
          />
        </label>
      </div>

      {sending ? (
        <div className="mb-2">
          <UploadTile src={sending.src} percent={sending.percent} state={sending.state} onRetry={() => void handleFile(sending.file)} onDismiss={dismissSending} />
        </div>
      ) : null}

      {photos === null ? (
        <>
          <SkeletonThumbs count={3} />
          <SkeletonLabel>در حال بارگذاری تصاویر…</SkeletonLabel>
        </>
      ) : photos.length === 0 ? (
        <EmptyState icon="image" title="هنوز عکسی ثبت نشده" className="py-4" />
      ) : (
        <PhotoBrowser photos={photos} onView={(id) => setLightbox(photos.find((p) => p.id === id) ?? null)} />
      )}

      <PhotoCropSheet file={framing} onCancel={() => setFraming(null)} onDone={(f) => { setFraming(null); void handleFile(f); }} />

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

"use client";

import { useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import PhotoThumbs from "@/components/PhotoAccordion";
import PhotoCompare from "@/components/PhotoCompare";

/** A place's photos plus «مقایسهٔ دو عکس»: tap it, pick any two photos, and a sheet lays them over each other with
 *  a draggable line. Outside that mode a tap views the photo (`onView`). */
export default function PhotoBrowser({
  photos,
  onView,
}: {
  photos: { id: number; caption: string | null }[];
  onView: (id: number) => void;
}) {
  /* `picked` while choosing (null = not choosing); `pair` once two are chosen. */
  const [picked, setPicked] = useState<number[] | null>(null);
  const [pair, setPair] = useState<[number, number] | null>(null);

  function tap(id: number) {
    if (!picked) return onView(id);
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    if (next.length === 2) {
      setPair([next[0], next[1]]);
      setPicked(null);
    } else setPicked(next);
  }

  return (
    <>
      {photos.length >= 2 && (
        <button
          type="button"
          className="touch mb-[var(--space-2)] inline-flex min-h-[44px] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--foreground)]"
          onClick={() => setPicked((p) => (p ? null : []))}
        >
          <Icon name={picked ? "x" : "arrow-swap"} size="sm" />
          {picked ? "لغو مقایسه" : "مقایسهٔ دو عکس"}
        </button>
      )}
      {picked && <p className="m-0 mb-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--muted)]">دو عکس را انتخاب کنید ({picked.length} از ۲)</p>}
      <PhotoThumbs photos={photos} picked={picked ?? undefined} onView={tap} />
      <PhotoCompare ids={pair} onClose={() => setPair(null)} />
    </>
  );
}

"use client";

import type { ReactNode } from "react";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";
import { useBackToClose } from "@/lib/useBackToClose";

export type LightboxPhoto = { id: number; caption?: string | null };

/** The photo viewer (yet-another-react-lightbox, docs/roadmap.md §10): swipe down or tap the
 *  backdrop to close, pinch or double-tap to zoom (receipts and cheques are read here), swipe
 *  between photos. The phone's back button closes it like a sheet. Loaded through next/dynamic
 *  by its callers, so its code arrives with the first photo opened, not with the page. */
export default function PhotoLightbox<P extends LightboxPhoto>({ photos, index, onClose, actions }: {
  photos: P[];
  /** The photo shown, or -1 when closed. */
  index: number;
  onClose: () => void;
  /** The row under the photo: copy link, delete. */
  actions?: (photo: P) => ReactNode;
}) {
  const open = index >= 0;
  useBackToClose(open, onClose);
  const slides = photos.map((p) => ({ src: `/api/photos/${p.id}/file?format=webp`, alt: p.caption ?? "" }));
  return (
    <Lightbox
      open={open}
      index={Math.max(index, 0)}
      close={onClose}
      slides={slides}
      plugins={[Zoom]}
      className="scrim photo-lightbox"
      // Drawn in the .meridian root, like the sheets, so the theme tokens reach its buttons.
      portal={{ root: () => document.querySelector(".meridian") }}
      carousel={{ finite: true }}
      // See-through, so the blur every overlay shares (.scrim) shows the page behind.
      styles={{ container: { backgroundColor: "rgba(0, 0, 0, .8)" } }}
      animation={{ fade: 300, swipe: 300 }}
      controller={{ closeOnPullDown: true, closeOnBackdropClick: true }}
      labels={{
        Previous: "عکس قبلی", Next: "عکس بعدی", Close: "بستن عکس", Lightbox: "نمایش عکس",
        "Photo gallery": "عکس‌ها", Slide: "عکس", Carousel: "عکس‌ها", "{index} of {total}": "{index} از {total}",
        "Zoom in": "بزرگ‌نمایی", "Zoom out": "کوچک‌نمایی",
      }}
      render={actions ? { slideFooter: ({ slide }) => {
        const photo = photos[slides.findIndex((s) => s.src === (slide as { src?: string }).src)];
        return photo ? <div dir="rtl" className="photo-lightbox__actions">{actions(photo)}</div> : null;
      } } : undefined}
    />
  );
}

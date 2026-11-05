"use client";

import { useState } from "react";
import BottomSheet from "@/components/mobile/BottomSheet";

/** Two of a place's photos on top of each other with a draggable line between them: drag it to see one photo
 *  turn into the other (a shelf before and after a delivery, say). The first photo shows on the right of the
 *  line, the second on the left, as the page reads right to left. The slider is a real range input, so
 *  the arrow keys and screen readers move it too. */
export default function PhotoCompare({ ids, onClose }: { ids: [number, number] | null; onClose: () => void }) {
  const [at, setAt] = useState(50);
  const src = (id: number) => `/api/photos/${id}/file?format=webp`;
  return (
    <BottomSheet open={ids !== null} title="مقایسهٔ دو عکس" onClose={onClose} closeLabel="بستن مقایسه" bodyClassName="photocmp-sheet">
      {ids && (
        <div className="photocmp" dir="ltr" style={{ "--at": `${at}%` } as React.CSSProperties}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="photocmp__img" src={src(ids[0])} alt="عکس اول" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="photocmp__img photocmp__top" src={src(ids[1])} alt="عکس دوم" />
          <span className="photocmp__line" aria-hidden="true" />
          <input
            className="photocmp__range"
            type="range"
            min={0}
            max={100}
            value={at}
            aria-label="جابه‌جایی خط مقایسه"
            onChange={(e) => setAt(Number(e.target.value))}
          />
        </div>
      )}
    </BottomSheet>
  );
}

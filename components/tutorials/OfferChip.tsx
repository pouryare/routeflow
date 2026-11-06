"use client";

import { Button } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import type { Tutorial } from "@/lib/tutorials/types";

/** The just-in-time offer (idea I1): the first time a screen opens, a small chip above the bottom bar
 *  asks «۳۰ ثانیه آموزش؟». «بعداً» hides it; it asks once more on a later day, then only the
 *  «آموزش برنامه» list and the (i) panel offer it. */
export default function OfferChip({ t, onStart, onLater }: { t: Tutorial; onStart: () => void; onLater: () => void }) {
  return (
    <div className="tourchip" data-react-aria-top-layer="true" role="region" aria-label="پیشنهاد آموزش">
      <span className="tourchip__text">
        <Icon name="sparkle" size="sm" /> ۳۰ ثانیه آموزش «{t.title}»؟
      </span>
      <Button size="sm" className="tourchip__yes" onPress={onStart}>
        <Icon name="play" size="sm" /> بله
      </Button>
      <Button size="sm" variant="ghost" onPress={onLater}>
        <Icon name="x" size="sm" /> بعداً
      </Button>
    </div>
  );
}

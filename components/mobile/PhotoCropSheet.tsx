"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@heroui/react";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import { AnswerButton } from "@/components/tapflow/Answer";
import { CROP_ASPECTS } from "@/lib/photoCrop";
import { shrinkPhoto } from "@/lib/shrinkPhoto";

/** Frame a photo before it uploads: pick a shape (as taken, 4:3, 1:1 or 3:4), see it, and confirm. The
 *  crop is always the centre of the picture. shortcut: no dragging the frame to another spot; add pan only
 *  if people ask. «اصلی» keeps the whole picture (still made small before it is sent). */
export default function PhotoCropSheet({ file, onDone, onCancel }: { file: File | null; onDone: (f: File) => void; onCancel: () => void }) {
  const [aspect, setAspect] = useState<(typeof CROP_ASPECTS)[number]["id"]>("orig");
  const [busy, setBusy] = useState(false);
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const ratio = CROP_ASPECTS.find((a) => a.id === aspect)?.ratio ?? null;

  async function frame() {
    if (!file) return;
    setBusy(true);
    try {
      onDone(await shrinkPhoto(file, { ratio })); // frame it and make it small enough for a slow line
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={file !== null} title="قاب عکس" onClose={onCancel} closeLabel="بستن قاب عکس">
      <div className="photocrop" style={{ aspectRatio: ratio ? String(ratio) : undefined }}>
        {url ? <img src={url} alt="پیش‌نمایش عکس" className="photocrop__img" /> : null}
      </div>
      <div className="photocrop__aspects" role="radiogroup" aria-label="شکل قاب">
        {CROP_ASPECTS.map((a) => (
          <AnswerButton key={a.id} selected={aspect === a.id} onPress={() => setAspect(a.id)}>
            {a.label}
          </AnswerButton>
        ))}
      </div>
      <Button variant="primary" size="lg" fullWidth isDisabled={busy} onPress={() => void frame()}>
        <Icon name="upload" size="md" />
        {busy ? "در حال آماده‌سازی…" : "بارگذاری عکس"}
      </Button>
    </BottomSheet>
  );
}

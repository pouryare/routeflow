"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import SkinToggle from "@/components/kargah/SkinToggle";
import FontPicker from "@/components/FontPicker";
import AccentPicker from "@/components/AccentPicker";
import Avatar from "@/components/kargah/Avatar";

/** The one control at the end of the top bar: the viewer's avatar, opening a dropdown
 *  that holds everything that used to sit loose beside it -- the map link and the
 *  appearance controls (skin / font / accent). Same click-outside + Esc dismissal as
 *  AccentPicker.
 */
export default function ProfileMenu({
  userId,
  name,
  roleLabel,
}: {
  userId: number;
  name: string;
  roleLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="pm">
      <button
        type="button"
        className="pm__trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${name} — ${roleLabel}`}
        title={`${name} · ${roleLabel}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar userId={userId} name={name} size={34} />
      </button>

      {open && (
        <div dir="rtl" role="dialog" aria-label="حساب و ظاهر" className="pm__panel">
          <div className="pm__who">
            <Avatar userId={userId} name={name} size={38} />
            <div>
              <div className="pm__name">{name}</div>
              <div className="pm__role">{roleLabel}</div>
            </div>
          </div>

          <Link className="pm__link" href="/map" onClick={() => setOpen(false)}>
            ↗ نقشهٔ پوشش
          </Link>

          <Link className="pm__link" href="/settings/notifications" onClick={() => setOpen(false)}>
            ↗ تنظیمات اعلان‌ها
          </Link>

          <div className="pm__sep" />

          <div className="pm__row">
            <span>پوسته</span>
            <SkinToggle />
          </div>
          <div className="pm__row">
            <span>قلم</span>
            <FontPicker />
          </div>
          <div className="pm__row">
            <span>رنگ</span>
            <AccentPicker />
          </div>
        </div>
      )}
    </div>
  );
}

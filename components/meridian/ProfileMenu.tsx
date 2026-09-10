"use client";

import SyncRow from "@/components/meridian/SyncRow";
import { Icon } from "@/components/meridian/Icon";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import SkinToggle from "@/components/meridian/SkinToggle";
import FontPicker from "@/components/FontPicker";
import AccentPicker from "@/components/AccentPicker";
import Avatar from "@/components/meridian/Avatar";

/** The one control at the end of the top bar: the viewer's avatar, opening a dropdown
 *  that holds everything that used to sit loose beside it -- the map link and the
 *  appearance controls (skin / font / accent).
 *
 *  Opens on HOVER where hovering is real, matching the nav pill beside it: a pointer
 *  that arrives here is asking for the menu, and making it click reads as one gesture
 *  too many. Closing is delayed so a diagonal move from the avatar down into the panel
 *  does not dismiss it mid-travel.
 *
 *  On a touch screen pointerenter fires on the tap that was meant to activate the
 *  trigger, so hover is gated behind matchMedia("(hover: hover)") and the click toggle
 *  stays as the touch path. Click-outside and Esc dismissal are unchanged.
 */
const CLOSE_DELAY_MS = 180;
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
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canHover = () =>
    typeof matchMedia === "function" ? matchMedia("(hover: hover)").matches : false;

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, [cancelClose]);

  useEffect(() => cancelClose, [cancelClose]);

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
    <div
      ref={root}
      className="pm"
      onPointerEnter={() => {
        if (!canHover()) return;
        cancelClose();
        setOpen(true);
      }}
      onPointerLeave={() => {
        if (canHover()) scheduleClose();
      }}
    >
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
            <Icon name="arrow-up-right" size="sm" /> نقشهٔ پوشش
          </Link>

          <Link className="pm__link" href="/settings/notifications" onClick={() => setOpen(false)}>
            <Icon name="arrow-up-right" size="sm" /> تنظیمات اعلان‌ها
          </Link>

          <div className="pm__sep" />

          <SyncRow />

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

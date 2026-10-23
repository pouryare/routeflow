"use client";

import { useDismissOnOutside } from "@/lib/useDismissOnOutside";
import SyncRow from "@/components/meridian/SyncRow";
import { Icon } from "@/components/meridian/Icon";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import SkinToggle from "@/components/meridian/SkinToggle";
import FontPicker from "@/components/FontPicker";
import AccentPicker from "@/components/AccentPicker";
import Avatar from "@/components/meridian/Avatar";
import type { AccountLink } from "@/lib/accountLinks";

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
  links,
}: {
  userId: number;
  name: string;
  roleLabel: string;
  /** From lib/accountLinks: only what this role can open. */
  links: AccountLink[];
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

  const dismiss = useCallback(() => setOpen(false), []);
  useDismissOnOutside(open, dismiss, root);

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
        className="inline-flex items-center justify-center gap-[var(--space-2)] pm__trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${name} — ${roleLabel}`}
        title={`${name} · ${roleLabel}`}
        onClick={() => setOpen((v) => !v)}
      >
        {/* No person glyph beside the picture. The Avatar IS the person, and a generic
            silhouette next to an actual face says the same thing twice — worse, the trigger
            is a GRID, so the icon took a whole row and the avatar was pushed underneath it,
            stacking a symbol on top of the photograph it was meant to label. */}
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

          {/* The switcher (owners only) is a RARE, deliberate, consequential action, so it lives
              here among "things about this account" rather than as a nav tab. */}
          {links.map((l) => (
            <Link key={l.href} className="pm__link" href={l.href} onClick={() => setOpen(false)}>
              <Icon name={l.icon} size="sm" /> {l.label}
            </Link>
          ))}

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

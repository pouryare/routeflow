"use client";

import SyncRow from "@/components/meridian/SyncRow";
import { Icon } from "@/components/meridian/Icon";
import { useState } from "react";
import { Button, Popover } from "@heroui/react";
import Link from "next/link";
import SkinToggle from "@/components/meridian/SkinToggle";
import FontPicker from "@/components/FontPicker";
import AccentPicker from "@/components/AccentPicker";
import Avatar from "@/components/meridian/Avatar";
import type { AccountLink } from "@/lib/accountLinks";

/** The one control at the end of the top bar: the viewer's avatar, opening a HeroUI Popover
 *  that holds everything that used to sit loose beside it -- the account links and the
 *  appearance controls (skin / font / accent).
 *
 *  Opens on a tap or click, like the bell beside it and CardHelp. It used to open on hover
 *  where hovering is real; a modal popover covers its trigger with an underlay, so hover-open
 *  would close the moment the pointer moved, and one gesture that works everywhere beat two.
 *  React Aria brings outside-tap and Escape dismissal, focus return and staying on screen. */
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

  return (
    <div className="pm">
      <Popover isOpen={open} onOpenChange={setOpen}>
        <Button
          variant="ghost"
          isIconOnly
          className="pm__trigger"
          aria-label={`${name} — ${roleLabel}`}
        >
          {/* No person glyph beside the picture. The Avatar IS the person, and a generic
              silhouette next to an actual face says the same thing twice. */}
          <Avatar userId={userId} name={name} size={34} />
        </Button>
        <Popover.Content placement="bottom end" offset={8} className="pm__panel">
          <Popover.Dialog aria-label="حساب و ظاهر" className="pm__dialog">
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
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </div>
  );
}

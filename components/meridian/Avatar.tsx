/** One user, one squircle.
 *
 *  A real photo when the account has one (users.avatar_url); initials on a coloured
 *  ground -- honest about exactly what the system knows. The colour is seeded from the
 *  user id (not the name, not the name's length), so the same person is the same colour
 *  everywhere they appear, and it does not shuffle when they change their display name.
 *
 *  The initials are deliberate, not provisional: a missing photo is a fact about
 *  the record, and inventing a face for it would be a lie the UI then repeats.
 *  It replaces the ~6 ad-hoc `AV_TONE[...name.length % 4]` copies across /sales.
 */
"use client";

import { Avatar as HeroAvatar } from "@heroui/react";
import { faNum } from "@/lib/format";

const TONES = ["plum", "sage", "sky", "amber"] as const;

function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return Math.abs(h);
}

/** Seed the tone from the user id when we have one (stable across name changes), else
 *  from the name -- never from `name.length`, which the old ad-hoc copies used and which
 *  collides constantly. */
function toneFor(seed: number | string): (typeof TONES)[number] {
  const n =
    typeof seed === "number"
      ? Math.abs(Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b))
      : hashString(seed);
  return TONES[n % TONES.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "؟";
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] ?? "") + (parts[1][0] ?? "");
}

export default function Avatar({
  userId,
  name,
  src,
  size = 28,
  title,
  count,
  className = "",
}: {
  /** The user's id when the caller has it -- keeps the colour stable if they rename. */
  userId?: number;
  name: string;
  /** A real photo (users.avatar_url). Falls back to initials when absent or broken. */
  src?: string | null;
  size?: number;
  title?: string;
  /** A small corner badge, e.g. a per-person count. Omitted when 0 or undefined. */
  count?: number;
  className?: string;
}) {
  const tone = toneFor(userId ?? name);
  const box = { width: size, height: size, borderRadius: "35%", flex: "none" } as const;
  /* HeroUI's Avatar: the initials show until the photo has loaded, and stay if it fails,
     so a photo that 404s never leaves a broken-image glyph in the middle of a picker. */
  const chip = (
    <HeroAvatar aria-hidden="true" title={title ?? name} className={`av ${className}`.trim()} style={box}>
      {src ? <HeroAvatar.Image src={src} alt="" style={{ objectFit: "cover" }} /> : null}
      <HeroAvatar.Fallback
        style={{
          fontSize: Math.round(size * 0.4),
          fontWeight: 600,
          lineHeight: 1,
          background: `var(--${tone}-soft)`,
          color: `var(--${tone})`,
        }}
      >
        {initials(name)}
      </HeroAvatar.Fallback>
    </HeroAvatar>
  );
  if (!count) return chip;
  return (
    <span style={{ position: "relative", display: "inline-flex", flex: "none" }}>
      {chip}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          insetInlineEnd: -4,
          bottom: -4,
          minWidth: 14,
          padding: "0 3px",
          borderRadius: 999,
          border: "1px solid var(--surface)",
          background: `var(--${tone})`,
          color: "var(--surface)",
          fontFamily: "var(--font-num)",
          fontSize: Math.max(9, Math.round(size * 0.3)),
          lineHeight: "14px",
          textAlign: "center",
          fontWeight: 700,
        }}
      >
        {faNum(count)}
      </span>
    </span>
  );
}

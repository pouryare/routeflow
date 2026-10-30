"use client";

import { useState } from "react";
import { ToggleButton } from "@heroui/react";
import SectionHead from "@/components/meridian/SectionHead";
import { Icon } from "@/components/meridian/Icon";
import ToggleSwitch from "@/components/ToggleSwitch";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { configureSound, playSound, soundOn, type SoundSwitch } from "@/lib/sound";
import { SKINS, SKIN_LABELS, type Skin } from "@/lib/soundRecipes";

/** What each skin sounds like, in words, for someone choosing before they listen. */
const SKIN_HINT: Record<Skin, string> = {
  bubble: "نرم و آرام، مثل قطرهٔ آب",
  mech: "تقه‌ای و روشن، مثل کلید پلاستیکی",
  press: "بم و چوبی، مثل کیبورد",
};

/** F117 settings: this person's sound switch and, for the owner, the company's skin. The switch is
 *  this person's own (preferences blob, so it follows them to another phone); the skin is the
 *  company's, heard by everyone in it. A choice is played the moment it is made, so the person
 *  hears what they picked. */
export default function SoundSettings({
  initialChoice,
  initialSkin,
  canPickSkin,
}: {
  initialChoice: SoundSwitch;
  initialSkin: Skin;
  canPickSkin: boolean;
}) {
  const [choice, setChoice] = useState<SoundSwitch>(initialChoice);
  const [skin, setSkin] = useState<Skin>(initialSkin);
  const [error, setError] = useState<string | null>(null);
  // Unset follows reduced motion (lib/sound.ts soundOn); the server cannot see that, so it is read here.
  const on = soundOn(choice, usePrefersReducedMotion());

  async function flip() {
    const next = on ? "off" : "on";
    setError(null);
    const res = await fetch("/api/prefs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sound: next }),
    }).catch(() => null);
    if (!res?.ok) {
      setError("ذخیره نشد؛ دوباره تلاش کنید");
      return;
    }
    setChoice(next);
    configureSound({ choice: next });
    if (next === "on") playSound("settings.saved");
  }

  async function pick(next: Skin) {
    if (next === skin) {
      playSound("action.done", { skin: next, force: true });
      return;
    }
    setError(null);
    const res = await fetch("/api/admin/sound-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skin: next }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!data?.ok) {
      setError(data?.error ?? "ذخیره نشد؛ دوباره تلاش کنید");
      return;
    }
    setSkin(next);
    configureSound({ skin: next });
    playSound("action.done", { skin: next, force: true });
  }

  return (
    <div className="flex flex-col gap-[var(--space-4)]" dir="rtl">
      <section className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" aria-label="صدای برنامه">
        <SectionHead title="صدای برنامه" />
        <div className="flex min-h-11 items-center justify-between gap-[var(--space-3)]">
          <p className="m-0 text-[length:var(--text-sm)] text-[var(--text)]">
            {on ? "روشن است: ثبت، خطا و دکمه‌ها صدای کوتاه دارند." : "خاموش است: برنامه بی‌صداست."}
          </p>
          <ToggleSwitch on={on} onChange={() => void flip()} label="صدای برنامه" />
        </div>
        <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
          این انتخاب فقط برای شماست و روی همهٔ دستگاه‌هایتان می‌ماند. وقتی گوشی آیفون روی بی‌صداست، صدایی پخش نمی‌شود.
          {" اگر در تنظیمات گوشی «کاهش حرکت» روشن است، صدا تا وقتی خودتان روشنش نکنید خاموش می‌ماند."}
        </p>
        <button
          type="button"
          onClick={() => playSound("sound.try", { force: true })}
          className="touch inline-flex min-h-11 items-center justify-center gap-[var(--space-2)] self-start rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)]"
        >
          <Icon name="play" size="sm" />
          شنیدن یک نمونه
        </button>
      </section>

      <section className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" aria-label="صدای شرکت">
        <SectionHead title="صدای شرکت" />
        <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
          {canPickSkin
            ? "همهٔ کارکنان شرکت همین صدا را می‌شنوند. با زدن هر گزینه، صدای «ثبت شد» آن پخش می‌شود."
            : `صدای شرکت «${SKIN_LABELS[skin]}» است. فقط مالک شرکت می‌تواند آن را عوض کند.`}
        </p>
        {canPickSkin && (
          <div className="flex flex-col gap-[var(--space-2)]" role="group" aria-label="صدای شرکت">
            {SKINS.map((s) => (
              <ToggleButton
                key={s}
                isSelected={s === skin}
                onChange={() => void pick(s)}
                className={`filterchip min-h-11 justify-start${s === skin ? " filterchip--on" : ""}`}
              >
                <Icon name={s === skin ? "check" : "volume"} size="sm" />
                <span className="font-medium">{SKIN_LABELS[s]}</span>
                {/* On the lit chip the muted grey sinks into the accent; the chip's own ink reads there. */}
                <span className={s === skin ? "opacity-85" : "text-[var(--text-muted)]"}>{SKIN_HINT[s]}</span>
              </ToggleButton>
            ))}
          </div>
        )}
      </section>
      {error && <p role="alert" className="m-0 text-[length:var(--text-sm)] text-[var(--crit)]">{error}</p>}
    </div>
  );
}

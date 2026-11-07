"use client";

import { useState } from "react";
import SectionHead from "@/components/meridian/SectionHead";
import ToggleSwitch from "@/components/ToggleSwitch";
import type { CompanyFx, PersonFx } from "@/lib/fx";

/** Decorative effects (coin turn, ticket edge, light on a card): this person's own switch, and the owner's switch
 *  for the whole company. Off wins from either side; by default they also stay off on weak phones.
 *  Both save at once; the page picks the change up on the next load. */
export default function EffectsSettings({
  initialPerson,
  initialCompany,
  canSetCompany,
}: {
  initialPerson: PersonFx;
  initialCompany: CompanyFx;
  canSetCompany: boolean;
}) {
  const [person, setPerson] = useState<PersonFx>(initialPerson);
  const [company, setCompany] = useState<CompanyFx>(initialCompany);
  const [error, setError] = useState<string | null>(null);

  async function send(url: string, method: string, body: unknown): Promise<boolean> {
    setError(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (!res?.ok) setError("ذخیره نشد؛ دوباره تلاش کنید");
    return !!res?.ok;
  }

  const personOn = person !== "off";
  const companyOn = company !== "off";
  return (
    <section className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" aria-label="جلوه‌های تصویری" dir="rtl">
      <SectionHead title="جلوه‌های تصویری" />
      <div className="flex min-h-11 items-center justify-between gap-[var(--space-3)]">
        <p className="m-0 text-[length:var(--text-sm)] text-[var(--foreground)]">
          {personOn ? "برای شما روشن است." : "برای شما خاموش است."}
        </p>
        <ToggleSwitch
          on={personOn}
          label="جلوه‌های تصویری برای من"
          onChange={async () => {
            const next = personOn ? "off" : "on";
            if (await send("/api/prefs", "PATCH", { effects: next })) setPerson(next);
          }}
        />
      </div>
      <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">
        سکه، لبهٔ رسید، نور روی کارت و مانند آن. روی گوشی‌های ضعیف و وقتی «کاهش حرکت» روشن است، خودکار خاموش‌اند.
      </p>
      {canSetCompany ? (
        <div className="flex min-h-11 items-center justify-between gap-[var(--space-3)]">
          <p className="m-0 text-[length:var(--text-sm)] text-[var(--foreground)]">
            {companyOn ? "برای همهٔ کارکنان شرکت مجازند." : "برای همهٔ کارکنان شرکت خاموش است."}
          </p>
          <ToggleSwitch
            on={companyOn}
            label="جلوه‌های تصویری برای شرکت"
            onChange={async () => {
              const next = companyOn ? "off" : "auto";
              if (await send("/api/admin/effects-settings", "PUT", { effects: next })) setCompany(next);
            }}
          />
        </div>
      ) : null}
      {error && <p role="alert" className="m-0 text-[length:var(--text-sm)] text-[var(--danger)]">{error}</p>}
    </section>
  );
}

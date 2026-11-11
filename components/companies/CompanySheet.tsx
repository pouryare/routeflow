"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button } from "@heroui/react";
import BottomSheet from "@/components/mobile/BottomSheet";
import { GoButton } from "@/components/tapflow/Answer";
import { FieldInput } from "@/components/FieldInput";
import { Icon } from "@/components/meridian/Icon";
import SectionHead from "@/components/meridian/SectionHead";
import { friendlyError } from "@/lib/userMessage";
import { generatePassword } from "@/lib/credentials";
import { suggestOwnerUsername } from "@/lib/companyInput";
import { logoFromFile } from "./logo";
import type { CompanyRow } from "@/lib/repo/companies";

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-text-muted">
      {label}
      {children}
      {hint ? <span className="text-text-faint">{hint}</span> : null}
    </label>
  );
}

/** Create a company (name, logo, address, first owner) or, with `editing`, change its name and logo. */
export default function CompanySheet({ editing, onClose, onSaved, onAddAddress }: {
  editing: CompanyRow | null;
  onClose: () => void;
  onSaved: () => void;
  /** Editing only: opens the new-address sheet for this company (the card's own button is only for a company with no address). */
  onAddAddress?: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [hostname, setHostname] = useState("");
  // The first owner's login is offered, not asked for: «taminodis.admin», «مدیر <نام شرکت>» and a strong
  // password made here. Each stays the offer until the person types in it.
  const [typedUser, setTypedUser] = useState<string | null>(null);
  const [typedDisplay, setTypedDisplay] = useState<string | null>(null);
  const [password, setPassword] = useState(() => (editing ? "" : generatePassword(undefined, 14)));
  const username = typedUser ?? suggestOwnerUsername(hostname, name);
  const displayName = typedDisplay ?? (name.trim() ? `مدیر ${name.trim()}` : "");
  // undefined: logo untouched; null: remove it; string: a new one
  const [logo, setLogo] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty = !!(name !== (editing?.name ?? "") || hostname || typedUser !== null || typedDisplay !== null || logo !== undefined);
  const shown = logo === undefined ? null : logo;
  const ready = name.trim() && (editing || (username.trim() && displayName.trim() && password.length >= 8));

  async function pick(file: File | undefined) {
    if (!file) return;
    try {
      setLogo(await logoFromFile(file));
      setError(null);
    } catch {
      setError("این فایل تصویر نیست؛ یک PNG یا JPEG انتخاب کنید");
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = editing
        ? { name: name.trim(), ...(logo !== undefined ? { logo } : {}) }
        : { name: name.trim(), hostname: hostname.trim(), logo: logo ?? undefined, username: username.trim(), display_name: displayName.trim(), password };
      const res = await fetch(editing ? `/api/admin/companies/${editing.id}` : "/api/admin/companies", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(friendlyError(data.error, "ذخیره نشد؛ دوباره تلاش کنید"));
        return;
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open onClose={onClose} title={editing ? `ویرایش «${editing.name}»` : "افزودن شرکت"} closeLabel="بستن فرم شرکت" dirty={dirty} expandable>
      <div className="flex flex-col gap-[var(--space-3)]">
        <Field label="نام شرکت">
          <FieldInput value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="تامینو" data-tour="company-name" />
        </Field>

        <div className="flex items-center gap-[var(--space-3)]" data-tour="company-logo">
          {shown ? (
            <span role="img" aria-label="پیش‌نمایش لوگو" className="block h-14 w-14 rounded-md border border-border bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url(${shown})` }} />
          ) : (
            <span className="grid h-14 w-14 place-items-center rounded-md border border-dashed border-border text-text-faint">
              <Icon name="image" size="md" />
            </span>
          )}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void pick(e.target.files?.[0])} />
          <Button variant="secondary" className="min-h-[44px]" onPress={() => fileRef.current?.click()}>
            <Icon name="upload" size="sm" />
            {shown || editing?.has_logo ? "عوض کردن لوگو" : "انتخاب لوگو"}
          </Button>
          {(shown || (editing?.has_logo && logo === undefined)) && (
            <Button variant="secondary" className="min-h-[44px]" onPress={() => setLogo(null)}>
              <Icon name="trash" size="sm" />
              حذف
            </Button>
          )}
        </div>

        {!editing && (
          <>
            <Field label="نشانی شرکت (اختیاری)" hint="مثلاً app.example.ir. مراحل آروان بعد از ذخیره در صفحه نشان داده می‌شود.">
              <FieldInput dir="ltr" value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="app.example.ir" autoCapitalize="off" data-tour="company-host" />
            </Field>
            <SectionHead as="h3" title="مدیر اول شرکت" />
            <Field label="نام نمایشی">
              <FieldInput value={displayName} onChange={(e) => setTypedDisplay(e.target.value)} maxLength={80} />
            </Field>
            <Field label="نام کاربری">
              <FieldInput dir="ltr" value={username} onChange={(e) => setTypedUser(e.target.value)} autoComplete="off" autoCapitalize="off" />
            </Field>
            <Field label="رمز موقت" hint="رمز قوی آماده است؛ بعد از ساخت شرکت دیگر دیده نمی‌شود، پس همین‌جا کپی کنید. در اولین ورود باید رمز را عوض کند.">
              <div className="flex items-center gap-[var(--space-2)]">
                <FieldInput dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} />
                <Button variant="secondary" className="min-h-[44px]" aria-label="رمز تازه" onPress={() => setPassword(generatePassword(undefined, 14))}>
                  <Icon name="refresh" size="sm" />
                </Button>
              </div>
            </Field>
          </>
        )}

        {error && (
          <p role="alert" className="rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-sm text-crit">
            {error}
          </p>
        )}
        {onAddAddress && (
          <Button variant="secondary" className="min-h-[44px]" onPress={onAddAddress}>
            <Icon name="plus" size="sm" />
            افزودن نشانی دیگر
          </Button>
        )}
        <GoButton icon="save" isDisabled={busy || !ready} onPress={save}>
          {busy ? "در حال ذخیره…" : editing ? "ذخیره" : "ساخت شرکت"}
        </GoButton>
      </div>
    </BottomSheet>
  );
}

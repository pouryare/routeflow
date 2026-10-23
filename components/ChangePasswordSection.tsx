"use client";

import { useState } from "react";
import PasswordForm from "@/components/PasswordForm";

/** «تغییر رمز» on /settings/security: a change by choice, so it asks for the current password
 *  (the API requires it). Saving ends every other session, which the success line says, so
 *  nobody is surprised when the tablet in the warehouse asks them to sign in again. */
export default function ChangePasswordSection() {
  const [saved, setSaved] = useState(false);
  return (
    <section className="card mt-[var(--space-4)] flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl">
      <h2 className="sechead__title">تغییر رمز</h2>
      <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
        رمز فعلی را وارد کنید و رمز تازه را دو بار بنویسید. با ذخیره، از همهٔ دستگاه‌های دیگر خارج می‌شوید.
      </p>
      {saved && (
        <p role="status" className="m-0 text-[length:var(--text-sm)] text-[var(--good)]">
          رمز عوض شد و دستگاه‌های دیگر خارج شدند. این دستگاه وارد مانده است.
        </p>
      )}
      <PasswordForm askCurrent submitLabel="ذخیرهٔ رمز تازه" onSaved={() => setSaved(true)} />
    </section>
  );
}

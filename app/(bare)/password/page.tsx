"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components/meridian/Icon";
import PasswordForm from "@/components/PasswordForm";

/** F35: the first sign-in with a password an owner chose lands here (proxy.ts sends every page to
 *  it), and nothing else opens until a new one is saved. Signing out stays possible. */
export default function NewPasswordPage() {
  const router = useRouter();

  async function signOut() {
    await fetch("/api/logout", { method: "POST" }).catch(() => null);
    router.push("/login");
  }

  return (
    <div className="meridian min-h-screen flex items-center justify-center p-[var(--space-4)]">
      <main className="w-full max-w-sm">
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-raised)] p-[var(--space-6)]">
          <h1 className="mb-[var(--space-1)] text-center text-[length:var(--text-xl)] font-bold text-[var(--text)]">
            رمز عبور تازه
          </h1>
          <p className="mb-[var(--space-5)] text-center text-[length:var(--text-sm)] text-[var(--text-muted)]">
            این رمز را مدیر برایتان گذاشته است. پیش از ادامه، رمزی انتخاب کنید که فقط خودتان می‌دانید.
          </p>
          <PasswordForm
            askCurrent={false}
            autoFocus
            submitLabel="ذخیره و ادامه"
            onSaved={() => {
              router.push("/");
              router.refresh();
            }}
          />
          <button
            type="button"
            onClick={signOut}
            className="mt-[var(--space-3)] inline-flex min-h-11 w-full items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text-muted)]"
          >
            <Icon name="logout" size="md" />
            خروج
          </button>
        </div>
      </main>
    </div>
  );
}

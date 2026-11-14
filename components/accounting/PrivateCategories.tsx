"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SectionHead from "@/components/meridian/SectionHead";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import { friendlyError } from "@/lib/userMessage";

/** Z11 «دسته‌های خصوصی»: the owner ticks the expense categories whose amounts others see as dots. Example: «حقوق» ticked → the
 *  group manager sees «••••••» for salary lines and the totals they see leave it out. */
export default function PrivateCategories({ categories, initial }: { categories: { id: number; nameFa: string }[]; initial: number[] }) {
  const router = useRouter();
  const [on, setOn] = useState<string[]>(initial.map(String));
  const [error, setError] = useState<string | null>(null);

  async function change(next: string[]) {
    const id = [...next.filter((x) => !on.includes(x)), ...on.filter((x) => !next.includes(x))][0];
    if (!id) return;
    setError(null);
    const res = await fetch("/api/accounting/private-categories", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account_id: Number(id), on: next.includes(id) }) }).catch(() => null);
    if (res?.ok) {
      setOn(next);
      router.refresh();
    } else setError(friendlyError(((await res?.json().catch(() => ({}))) as { error?: string } | undefined)?.error, "ذخیره نشد؛ دوباره تلاش کنید"));
  }

  return (
    <section className="mb-6" data-tour="private-categories">
      <SectionHead title="دسته‌های خصوصی" as="h3" sub="مبلغ این دسته‌ها برای مدیر گروه نقطه‌چین دیده می‌شود و در جمع‌های او نمی‌آید." />
      <ChipGroup wrap group={{ id: "private", label: "دسته‌های خصوصی", mode: "multi", value: on, onChange: (v) => void change(v as string[]), options: categories.map((c) => ({ id: String(c.id), label: c.nameFa })) }} />
      {error ? <p className="m-0 mt-2 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
    </section>
  );
}

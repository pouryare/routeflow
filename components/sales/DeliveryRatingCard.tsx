"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import { GoButton } from "@/components/tapflow/Answer";
import { faNum } from "@/lib/format";
import { friendlyError } from "@/lib/userMessage";
import { RATING_REASONS, isLowRating } from "@/lib/deliveryRating";
import type { RatingRow } from "@/lib/repo/deliveryRatings";

/** F45 on a delivered order: «تحویل چطور بود؟». The rep asks the customer on the next visit or call and taps the answer; 1 or 2 stars
 *  makes a follow-up call task. */
export default function DeliveryRatingCard({ orderId, rating }: { orderId: number; rating: RatingRow | null }) {
  const router = useRouter();
  const [stars, setStars] = useState(rating ? String(rating.stars) : "");
  const [reason, setReason] = useState(rating?.reason ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/sales/orders/${orderId}/rating`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stars: Number(stars), reason: reason || null }) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (res?.ok) router.refresh();
    else setError(friendlyError(j?.error, "ثبت نشد؛ دوباره تلاش کنید"));
  }
  return (
    <section className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl" data-tour="delivery-rating" aria-label="امتیاز تحویل">
      <h3 className="sechead__title m-0">تحویل چطور بود؟</h3>
      <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">در بازدید یا تماس بعدی از مشتری بپرسید و جوابش را بزنید. امتیاز ۱ یا ۲ یک کار پیگیری می‌سازد.</p>
      <ChipGroup wrap group={{ id: "stars", label: "امتیاز", mode: "single", value: stars, onChange: (v) => setStars(v as string), options: [1, 2, 3, 4, 5].map((n) => ({ id: String(n), label: `${faNum(n)} ستاره` })) }} />
      {stars !== "" && Number(stars) <= 3 ? (
        <ChipGroup wrap group={{ id: "why", label: "دلیل", mode: "single", value: reason, onChange: (v) => setReason(v as string), options: RATING_REASONS.map((r) => ({ id: r, label: r })) }} />
      ) : null}
      {error ? <p className="m-0 text-[length:var(--text-sm)]" style={{ color: "var(--danger)" }}>{error}</p> : null}
      {rating && isLowRating(rating.stars) ? <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">برای امتیاز پایین، کار پیگیری ساخته شده است.</p> : null}
      <GoButton icon="check" isDisabled={busy || stars === ""} onPress={() => void save()}>{rating ? "عوض کردن امتیاز" : "ثبت امتیاز"}</GoButton>
    </section>
  );
}

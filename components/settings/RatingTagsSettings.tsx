"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SectionHead from "@/components/meridian/SectionHead";
import ActiveTags from "@/components/mobile/ActiveTags";
import StickyAction from "@/components/mobile/StickyAction";
import { TextInput } from "@/components/TextInput";
import { Icon } from "@/components/meridian/Icon";
import { RATING_TAG_LEN, RATING_TAG_MAX, type RatingTags } from "@/lib/ratingTags";
import { faNum } from "@/lib/format";

const LISTS = [
  { key: "good", title: "برای امتیاز خوب", sub: "وقتی میانگین ستاره‌ها ۴ یا بیشتر است." },
  { key: "low", title: "برای امتیاز کم", sub: "وقتی میانگین ستاره‌ها ۲ یا کمتر است. امتیاز میانه هر دو فهرست را نشان می‌دهد." },
] as const;

/** The owner's two lists of rating tags (lib/ratingTags.ts): a driver taps them after the stars of a lead visit.
 *  Add with the field, take off with a tag's ×, one save bar at the bottom. */
export default function RatingTagsSettings({ initial }: { initial: RatingTags }) {
  const router = useRouter();
  const [tags, setTags] = useState<RatingTags>(initial);
  const [draft, setDraft] = useState<Record<keyof RatingTags, string>>({ good: "", low: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(tags) !== JSON.stringify(initial);

  const add = (k: keyof RatingTags) => {
    const t = draft[k].trim().replace(/\s+/g, " ");
    if (!t || tags[k].includes(t) || tags[k].length >= RATING_TAG_MAX || t.length > RATING_TAG_LEN || /[,،]/.test(t)) return;
    setTags({ ...tags, [k]: [...tags[k], t] });
    setDraft({ ...draft, [k]: "" });
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/admin/rating-tags", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tags),
    }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { error?: string } | null;
    setBusy(false);
    if (res?.ok) {
      setMsg({ ok: true, text: "ذخیره شد" });
      router.refresh();
    } else setMsg({ ok: false, text: j?.error ?? "ذخیره نشد؛ دوباره تلاش کنید" });
  };

  return (
    <>
      {LISTS.map(({ key, title, sub }) => {
        const d = draft[key].trim();
        const why =
          d.length > RATING_TAG_LEN ? `حداکثر ${faNum(RATING_TAG_LEN)} حرف` : /[,،]/.test(d) ? "ویرگول نگذارید" : tags[key].includes(d) ? "این برچسب هست" : null;
        const full = tags[key].length >= RATING_TAG_MAX;
        return (
          <section key={key} className="card flex flex-col gap-[var(--space-3)] p-[var(--space-4)]" dir="rtl">
            <SectionHead title={title} as="h3" />
            <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">{sub}</p>
            {tags[key].length === 0 ? (
              <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-faint)]">برچسبی نیست؛ این قدم برای این امتیاز پرسیده نمی‌شود.</p>
            ) : (
              <ActiveTags
                label={title}
                items={tags[key].map((t) => ({ id: t, label: t }))}
                onRemove={(id) => setTags({ ...tags, [key]: tags[key].filter((t) => t !== id) })}
              />
            )}
            <form
              className="flex items-center gap-[var(--space-2)]"
              onSubmit={(e) => {
                e.preventDefault();
                add(key);
              }}
            >
              <TextInput
                className="min-w-0 flex-1"
                label={full ? `حداکثر ${faNum(RATING_TAG_MAX)} برچسب` : "برچسب تازه"}
                value={draft[key]}
                onChange={(v) => setDraft({ ...draft, [key]: v })}
                error={why}
              />
              <button
                type="submit"
                disabled={!d || !!why || full}
                className="touch inline-flex min-h-11 shrink-0 items-center gap-[var(--space-1)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] text-[length:var(--text-sm)] disabled:opacity-40"
              >
                <Icon name="plus" size="sm" />
                افزودن برچسب
              </button>
            </form>
          </section>
        );
      })}
      {msg && (
        <p role="status" className="m-0 px-[var(--space-4)] text-[length:var(--text-sm)]" style={{ color: msg.ok ? "var(--good)" : "var(--crit)" }}>
          {msg.text}
        </p>
      )}
      <div className="sticky-action-gap" aria-hidden />
      <StickyAction icon="save" label="ذخیرهٔ برچسب‌ها" busy={busy ? "در حال ذخیره…" : undefined} onClick={save} disabled={busy || !dirty} />
    </>
  );
}

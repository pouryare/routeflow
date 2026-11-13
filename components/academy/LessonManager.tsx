"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/meridian/Icon";
import BottomSheet from "@/components/mobile/BottomSheet";
import { ChipGroup } from "@/components/mobile/ChipGroup";
import CheckField from "@/components/CheckField";
import { FieldArea, FieldInput } from "@/components/FieldInput";
import { roleLabel } from "@/lib/roles";

interface Category { id: number; title: string }
interface Lesson {
  id: number; title: string; category_id: number | null; body: string; roles: string;
  required: boolean; due_days: number | null; status: "draft" | "published";
}
interface Person { id: number; name: string; role: string; can_teach: boolean }

const BLANK: Lesson = { id: 0, title: "", category_id: null, body: "", roles: "", required: false, due_days: null, status: "draft" };

async function call(url: string, method: string, body?: unknown): Promise<{ ok: boolean; error?: string; id?: number }> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
  const j = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string; id?: number } | null;
  return { ok: Boolean(res?.ok && j?.ok), error: j?.error ?? (res ? undefined : "ارتباط برقرار نشد"), id: j?.id };
}

/** The editor for company lessons (AC3): a list, a sheet to write one, categories, and for the owner the
 *  «مربی» switches. Text is plain: «## » makes a heading, «- » a bullet, a picture is inserted as [[img:12]]. */
export default function LessonManager({ lessons, categories, roles, people, isOwner }: {
  lessons: Lesson[]; categories: Category[]; roles: string[]; people: Person[]; isOwner: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Lesson | null>(null);
  const [reread, setReread] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [trainers, setTrainers] = useState(() => new Set(people.filter((p) => p.can_teach).map((p) => p.id)));
  const fileRef = useRef<HTMLInputElement>(null);
  const catTitle = (id: number | null) => categories.find((c) => c.id === id)?.title ?? "بدون دسته";

  const open = (l: Lesson) => { setDraft(l); setReread(false); setMsg(""); };

  async function save(publish: boolean) {
    if (!draft) return;
    setBusy(true); setMsg("");
    const r = await call("/api/sales/academy/company-lessons", "POST", {
      id: draft.id || undefined, title: draft.title, category_id: draft.category_id, body: draft.body,
      roles: draft.roles ? draft.roles.split(",") : [], required: draft.required, due_days: draft.due_days,
      publish, reread: reread && publish,
    });
    setBusy(false);
    if (!r.ok) { setMsg(r.error ?? "ذخیره نشد"); return; }
    setDraft(null);
    router.refresh();
  }

  async function remove() {
    if (!draft?.id) return;
    setBusy(true);
    const r = await call(`/api/sales/academy/company-lessons?id=${draft.id}`, "DELETE");
    setBusy(false);
    if (!r.ok) { setMsg(r.error ?? "پاک نشد"); return; }
    setDraft(null);
    router.refresh();
  }

  async function addPicture(file: File | undefined) {
    if (!file || !draft) return;
    setBusy(true); setMsg("");
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/content-images", { method: "POST", body: form }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { ok?: boolean; id?: number; error?: string } | null;
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!res?.ok || !j?.id) { setMsg(j?.error ?? "تصویر بارگذاری نشد"); return; }
    setDraft((d) => d && { ...d, body: `${d.body}${d.body && !d.body.endsWith("\n") ? "\n" : ""}[[img:${j.id}]]\n` });
  }

  async function addCategory() {
    const r = await call("/api/sales/academy/categories", "POST", { title: newCat });
    if (!r.ok) { setMsg(r.error ?? "دسته ساخته نشد"); return; }
    setNewCat(""); setMsg("");
    router.refresh();
  }

  async function toggleTrainer(p: Person) {
    const on = !trainers.has(p.id);
    const r = await call("/api/sales/academy/trainers", "POST", { user_id: p.id, on });
    if (r.ok) setTrainers((t) => { const n = new Set(t); if (on) n.add(p.id); else n.delete(p.id); return n; });
  }

  return (
    <div className="acad" dir="rtl">
      <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid" data-tour="lesson-new" onClick={() => open(BLANK)}>
        <Icon name="plus" size="md" /> درس تازه
      </button>

      {lessons.length === 0 ? (
        <p className="acad__muted">هنوز درسی ننوشته‌اید. «درس تازه» را بزنید.</p>
      ) : (
        <ul className="acad__steps" aria-label="درس‌های شرکت">
          {lessons.map((l) => (
            <li key={l.id} className="acad__step">
              <button type="button" className="acad__edit" onClick={() => open(l)}>
                <Icon name="edit" size="sm" />
                <b>{l.title}</b>
                <span className="acad__chip acad__chip--quiet">{catTitle(l.category_id)}</span>
                <span className="acad__chip">{l.status === "published" ? "منتشر شده" : "پیش‌نویس"}</span>
                {l.required ? <span className="acad__chip">اجباری</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="cat-title">
        <h3 id="cat-title" className="sechead__title sechead__title--minor">دسته‌ها</h3>
        {categories.length > 0 && (
          <p className="acad__muted">{categories.map((c) => c.title).join("، ")}</p>
        )}
        <div className="acad__library-head">
          <FieldInput value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="نام دستهٔ تازه، مثلاً «قوانین تحویل ما»" aria-label="نام دستهٔ تازه" />
          <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" disabled={!newCat.trim()} onClick={() => void addCategory()}>
            <Icon name="plus" size="md" /> افزودن دسته
          </button>
        </div>
      </section>

      {isOwner && (
        <section aria-labelledby="trainer-title">
          <h3 id="trainer-title" className="sechead__title sechead__title--minor">مربی‌ها</h3>
          <p className="acad__muted">مربی می‌تواند درس بنویسد و ویرایش کند. مثلاً یک راننده باتجربه.</p>
          <ul className="acad__steps">
            {people.map((p) => (
              <li key={p.id} className="acad__step">
                <span className="acad__step-text"><b>{p.name}</b><span className="acad__chip acad__chip--quiet">{roleLabel(p.role)}</span></span>
                <CheckField checked={trainers.has(p.id)} onChange={() => void toggleTrainer(p)} label={`مربی بودن ${p.name}`}>مربی</CheckField>
              </li>
            ))}
          </ul>
        </section>
      )}

      <BottomSheet open={draft !== null} onClose={() => setDraft(null)} title={draft?.id ? "ویرایش درس" : "درس تازه"} closeLabel="بستن ویرایشگر درس" dirty expandable>
        {draft && (
          <div className="flex flex-col gap-[var(--space-3)]" dir="rtl">
            <FieldInput value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="عنوان درس" aria-label="عنوان درس" maxLength={120} />
            <ChipGroup wrap group={{
              id: "cat", label: "دسته", mode: "single", value: draft.category_id ? String(draft.category_id) : "",
              options: categories.map((c) => ({ id: String(c.id), label: c.title })),
              onChange: (v) => setDraft({ ...draft, category_id: v ? Number(v) : null }),
            }} />
            <ChipGroup wrap group={{
              id: "roles", label: "برای چه نقش‌هایی", mode: "multi", value: draft.roles ? draft.roles.split(",") : [],
              options: roles.map((r) => ({ id: r, label: roleLabel(r) })),
              onChange: (v) => setDraft({ ...draft, roles: (v as string[]).join(",") }),
            }} />
            <p className="acad__muted">اگر نقشی انتخاب نکنید، درس برای همه است.</p>
            <FieldArea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={10} aria-label="متن درس"
              placeholder={"متن درس. «## » سرتیتر می‌سازد و «- » یک نکته."} maxLength={20000} />
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void addPicture(e.target.files?.[0])} />
            <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Icon name="plus" size="md" /> افزودن تصویر
            </button>
            <CheckField checked={draft.required} onChange={(v) => setDraft({ ...draft, required: v })}>خواندن این درس اجباری است</CheckField>
            {draft.required && (
              <FieldInput inputMode="numeric" value={draft.due_days === null ? "" : String(draft.due_days)} aria-label="مهلت به روز"
                placeholder="مهلت به روز پس از شروع کار (اختیاری)"
                onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, "")); setDraft({ ...draft, due_days: n > 0 ? n : null }); }} />
            )}
            {draft.id > 0 && draft.status === "published" && (
              <CheckField checked={reread} onChange={setReread}>همه دوباره بخوانند (برای تغییر مهم)</CheckField>
            )}
            {msg && <p className="acad__muted" role="alert">{msg}</p>}
            <div className="flex gap-[var(--space-2)] flex-wrap">
              <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid" disabled={busy} onClick={() => void save(true)}>
                <Icon name="check" size="md" /> انتشار
              </button>
              <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" disabled={busy} onClick={() => void save(false)}>
                <Icon name="save" size="md" /> ذخیره به‌عنوان پیش‌نویس
              </button>
              {draft.id > 0 && (
                <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" disabled={busy} onClick={() => void remove()}>
                  <Icon name="x" size="md" /> پاک کردن درس
                </button>
              )}
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

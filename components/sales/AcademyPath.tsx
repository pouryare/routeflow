"use client";

import { FieldInput } from "@/components/FieldInput";
import { useMemo, useState } from "react";
import { Icon } from "@/components/meridian/Icon";
import { faNum } from "@/lib/format";
import { outcomeLabel } from "@/lib/tasks/labels";
import { CUSTOMER_TYPE_LABEL, type CustomerType } from "@/lib/types";
import { matchesQuery } from "@/lib/persian";

interface Card {
  id: number;
  outcome_code: string;
  customer_type: string | null;
  title_fa: string;
  script_fa: string;
}
interface Module {
  slug: string;
  title_fa: string;
  status: string;
}

/** /sales/academy as a learning path (item 23, the `onboarding` block family).
 *
 *  It was a flat list of modules with a «تمام کردم» button each and, below it, a wall of
 *  objection cards that printed their machine codes («PRICE_OBJECTION», «RESTAURANT»)
 *  beside Persian titles. Academy is a path, so it now reads as one: how far along you
 *  are, the next thing to do, the modules as numbered steps; then the objection library
 *  as expandable cards, labelled in Persian, searchable with the same normaliser as the
 *  rest of the app. */
export default function AcademyPath({ cards, modules, done }: { cards: Card[]; modules: Module[]; done: string[] }) {
  const [q, setQ] = useState("");
  const [complete, setComplete] = useState<string[]>(done);
  const [busy, setBusy] = useState<string | null>(null);

  async function mark(slug: string) {
    setBusy(slug);
    const res = await fetch("/api/sales/academy/lessons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lesson_slug: slug }),
    }).catch(() => null);
    setBusy(null);
    if (res?.ok) setComplete((c) => [...new Set([...c, slug])]);
  }

  const doneCount = modules.filter((m) => complete.includes(m.slug)).length;
  const next = modules.find((m) => !complete.includes(m.slug)) ?? null;
  const pct = modules.length ? Math.round((doneCount / modules.length) * 100) : 0;

  const filtered = useMemo(
    () =>
      cards.filter(
        (c) =>
          !q.trim() ||
          matchesQuery(
            [c.title_fa, c.script_fa, outcomeLabel(c.outcome_code), c.customer_type ? CUSTOMER_TYPE_LABEL[c.customer_type as CustomerType] ?? "" : ""].join(" "),
            q,
          ),
      ),
    [cards, q],
  );

  return (
    <div className="acad" dir="rtl">
      <section className="acad__progress" aria-labelledby="acad-progress">
        <div className="acad__progress-text">
          <h3 id="acad-progress" className="sechead__title sechead__title--minor">
            مسیر یادگیری
          </h3>
          <p className="acad__muted">
            {modules.length === 0
              ? "هنوز درسی تعریف نشده است."
              : `${faNum(doneCount)} از ${faNum(modules.length)} درس تمام شده`}
          </p>
          <div className="acad__bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="پیشرفت در مسیر">
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
        {next ? (
          <div className="acad__next">
            <span className="acad__muted">درس بعدی</span>
            <b>{next.title_fa}</b>
            <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn solid" disabled={busy === next.slug} onClick={() => void mark(next.slug)}>
              <Icon name="check" size="sm" /> تمام کردم
            </button>
          </div>
        ) : modules.length > 0 ? (
          <div className="acad__next acad__next--done">
            <Icon name="flag" size="md" />
            <b>همهٔ درس‌ها تمام شده است.</b>
          </div>
        ) : null}
      </section>

      {modules.length > 0 ? (
        <ol className="acad__steps" aria-label="درس‌ها">
          {modules.map((m, i) => {
            const isDone = complete.includes(m.slug);
            const isNext = next?.slug === m.slug;
            return (
              <li key={m.slug} className={`acad__step${isDone ? " acad__step--done" : ""}${isNext ? " acad__step--next" : ""}`}>
                <span className="acad__dot" aria-hidden="true">
                  {isDone ? <Icon name="check" size="sm" /> : faNum(i + 1)}
                </span>
                <span className="acad__step-text">
                  <b>{m.title_fa}</b>
                  {m.status === "stub" ? <span className="acad__chip">در حال تدوین</span> : null}
                </span>
                {isDone ? (
                  <span className="acad__muted">تمام شد</span>
                ) : (
                  <button type="button" className="inline-flex items-center justify-center gap-[var(--space-2)] btn ghost" disabled={busy === m.slug} onClick={() => void mark(m.slug)}>
                    <Icon name="palette" size="md" />
                    تمام کردم
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      ) : null}

      <section className="acad__library" aria-labelledby="acad-library">
        <div className="acad__library-head">
          <h3 id="acad-library" className="sechead__title sechead__title--minor">
            پاسخ به مخالفت مشتری
          </h3>
          <label className="acad__search">
            <Icon name="search" size="sm" />
            <FieldInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو در پاسخ‌ها…" aria-label="جستجو در پاسخ‌ها" />
          </label>
        </div>
        {filtered.length === 0 ? (
          <p className="acad__muted">پاسخی با این عبارت پیدا نشد.</p>
        ) : (
          <ul className="acad__cards">
            {filtered.map((c) => (
              <li key={c.id}>
                <details className="acard">
                  <summary>
                    <span className="acard__title">{c.title_fa}</span>
                    <span className="acad__chip">{outcomeLabel(c.outcome_code)}</span>
                    {c.customer_type ? (
                      <span className="acad__chip acad__chip--quiet">
                        {CUSTOMER_TYPE_LABEL[c.customer_type as CustomerType] ?? "همهٔ مشتری‌ها"}
                      </span>
                    ) : null}
                    <Icon name="chevron-down" size="sm" />
                  </summary>
                  <div className="acard__body">
                    <p>{c.script_fa}</p>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
